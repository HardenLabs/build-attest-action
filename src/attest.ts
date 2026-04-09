/**
 * Shared core logic for Harden build attestation.
 *
 * Authenticates via OAuth client credentials, then calls the build attestation
 * endpoint with a CI/CD OIDC token to obtain a build key. The build key is
 * HMAC-SHA256(service_salt, commit_sha) — computed server-side and returned once.
 *
 * Used by both the GitHub Action (src/action.ts) and the CLI (src/cli.ts).
 */

export interface AttestOptions {
  clientId: string;
  clientSecret: string;
  serviceId: string;
  apiEndpoint: string;
  tokenEndpoint?: string; // Override OAuth token endpoint (e.g., direct Cognito URL)
  oidcToken: string;
  commitSha: string;
  maxRetries: number;
}

export interface AttestResult {
  buildKey: string;
  commitSha: string;
  registrationId?: string;
}

interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface AttestResponse {
  build_key: string;
  commit_sha: string;
  registration_id?: string;
}

interface ErrorResponse {
  error?: string;
  message?: string;
  detail?: string;
}

export class AttestError extends Error {
  public readonly statusCode?: number;
  public readonly errorCode?: string;

  constructor(message: string, statusCode?: number, errorCode?: string) {
    super(message);
    this.name = 'AttestError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

/**
 * Authenticate with Harden and request a build attestation key.
 */
export async function attest(options: AttestOptions): Promise<AttestResult> {
  validateOptions(options);

  // Step 1: OAuth client credentials flow
  const accessToken = await authenticate(options);

  // Step 2: Call attestation endpoint with retries
  return await callAttestEndpoint(options, accessToken);
}

function validateOptions(options: AttestOptions): void {
  if (!options.clientId) throw new AttestError('client-id is required');
  if (!options.clientSecret) throw new AttestError('client-secret is required');
  if (!options.serviceId) throw new AttestError('service-id is required');
  if (!options.oidcToken) throw new AttestError('oidc-token is required');
  if (!options.commitSha) throw new AttestError('commit-sha is required');
  if (!options.apiEndpoint) throw new AttestError('api-endpoint is required');

  if (!options.serviceId.match(/^svc_[a-z0-9_]+$/)) {
    throw new AttestError('service-id must match format svc_xxxx');
  }
}

async function authenticate(options: AttestOptions): Promise<string> {
  const tokenUrl = options.tokenEndpoint || `${options.apiEndpoint.replace(/\/$/, '')}/v1/oauth/token`;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: options.clientId,
    client_secret: options.clientSecret,
  });

  let response: Response;
  try {
    response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (error) {
    throw new AttestError(
      `Failed to connect to Harden OAuth endpoint at ${tokenUrl}. ` +
      'Check that api-endpoint is correct and the service is reachable.'
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    if (response.status === 401) {
      throw new AttestError(
        'OAuth authentication failed (401). Check that client-id and client-secret are correct.',
        401
      );
    }
    throw new AttestError(
      `OAuth authentication failed with status ${response.status}: ${text}`,
      response.status
    );
  }

  const data = (await response.json()) as OAuthTokenResponse;
  if (!data.access_token) {
    throw new AttestError('OAuth response missing access_token');
  }

  return data.access_token;
}

async function callAttestEndpoint(
  options: AttestOptions,
  accessToken: string
): Promise<AttestResult> {
  const attestUrl = `${options.apiEndpoint.replace(/\/$/, '')}/v1/build/attest`;

  const requestBody = JSON.stringify({
    oidc_token: options.oidcToken,
    commit_sha: options.commitSha,
    service_id: options.serviceId,
  });

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff with jitter: 1s, 2s, 4s + random 0-500ms
      const delayMs = Math.pow(2, attempt - 1) * 1000 + Math.random() * 500;
      await sleep(delayMs);
    }

    let response: Response;
    try {
      response = await fetch(attestUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: requestBody,
      });
    } catch (error) {
      lastError = new AttestError(
        `Network error calling attestation endpoint: ${error instanceof Error ? error.message : 'unknown'}. ` +
        `Attempt ${attempt + 1}/${options.maxRetries + 1}.`
      );
      continue;
    }

    // 5xx — retryable
    if (response.status >= 500) {
      const text = await response.text().catch(() => '');
      lastError = new AttestError(
        `Attestation endpoint returned ${response.status}: ${text}. ` +
        `Attempt ${attempt + 1}/${options.maxRetries + 1}.`,
        response.status
      );
      continue;
    }

    // 4xx — not retryable, fail immediately
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({} as ErrorResponse));
      const errorResponse = errorBody as ErrorResponse;
      const errorMessage = errorResponse.message || errorResponse.detail || `Status ${response.status}`;
      const errorCode = errorResponse.error;

      if (response.status === 403) {
        throw new AttestError(
          `Attestation rejected (403): ${errorMessage}. ` +
          'Check that the service has build attestation enabled, an OIDC registration exists ' +
          'matching this repository, and the branch pattern allows this ref.',
          403,
          errorCode
        );
      }

      if (response.status === 404) {
        throw new AttestError(
          `Service not found (404): ${errorMessage}. Check that service-id is correct.`,
          404,
          errorCode
        );
      }

      throw new AttestError(
        `Attestation failed (${response.status}): ${errorMessage}`,
        response.status,
        errorCode
      );
    }

    // Success
    const data = (await response.json()) as AttestResponse;
    if (!data.build_key) {
      throw new AttestError('Attestation response missing build_key');
    }

    return {
      buildKey: data.build_key,
      commitSha: data.commit_sha,
      registrationId: data.registration_id,
    };
  }

  throw lastError || new AttestError('Attestation failed after all retries');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
