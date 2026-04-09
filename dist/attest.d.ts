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
    tokenEndpoint?: string;
    oidcToken: string;
    commitSha: string;
    maxRetries: number;
}
export interface AttestResult {
    buildKey: string;
    commitSha: string;
    registrationId?: string;
}
export declare class AttestError extends Error {
    readonly statusCode?: number;
    readonly errorCode?: string;
    constructor(message: string, statusCode?: number, errorCode?: string);
}
/**
 * Authenticate with Harden and request a build attestation key.
 */
export declare function attest(options: AttestOptions): Promise<AttestResult>;
