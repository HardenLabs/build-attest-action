/**
 * GitHub Action entry point for Harden build attestation.
 *
 * Requests a GitHub Actions OIDC token, authenticates with Harden,
 * and calls the build attestation endpoint. Outputs the build key
 * and commit SHA for downstream steps.
 */

import * as core from '@actions/core';
import * as fs from 'fs';
import { attest } from './attest';

async function run(): Promise<void> {
  try {
    // Read inputs
    const clientId = core.getInput('client-id', { required: true });
    const clientSecret = core.getInput('client-secret', { required: true });
    const serviceId = core.getInput('service-id', { required: true });
    const apiEndpoint = core.getInput('api-endpoint') || 'https://api.hardenapi.com';
    const tokenEndpoint = core.getInput('token-endpoint') || undefined;
    const maxRetries = parseInt(core.getInput('max-retries') || '3', 10);

    // Determine commit SHA
    let commitSha = core.getInput('commit-sha');
    if (!commitSha) {
      commitSha = resolveCommitSha();
    }
    if (!commitSha) {
      core.setFailed('Could not determine commit SHA. Set the commit-sha input explicitly.');
      return;
    }

    // Request OIDC token LAST — right before the API call to maximize the ~5min window
    core.info('Requesting OIDC token...');
    let oidcToken: string;
    try {
      oidcToken = await core.getIDToken('https://api.hardenapi.com');
    } catch (error) {
      core.setFailed(
        'Failed to get OIDC token. Ensure your workflow has:\n' +
        '  permissions:\n' +
        '    id-token: write\n\n' +
        'See: https://docs.hardenapi.com/build-attestation/setup'
      );
      return;
    }

    core.info(`Attesting build for service ${serviceId} (commit: ${commitSha.substring(0, 7)})`);

    const result = await attest({
      clientId,
      clientSecret,
      serviceId,
      apiEndpoint,
      tokenEndpoint,
      oidcToken,
      commitSha,
      maxRetries,
    });

    // Mask the build key in all future log output
    core.setSecret(result.buildKey);

    // Set outputs
    core.setOutput('build-key', result.buildKey);
    core.setOutput('commit-sha', result.commitSha);

    core.info('Build attestation successful');
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('Build attestation failed with an unknown error');
    }
  }
}

/**
 * Resolve the commit SHA from the GitHub Actions environment.
 * For PR builds, uses the head SHA (not the ephemeral merge ref).
 */
function resolveCommitSha(): string {
  const eventName = process.env.GITHUB_EVENT_NAME;

  // For pull_request events, GITHUB_SHA is the merge commit — use head SHA instead
  if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    const eventPath = process.env.GITHUB_EVENT_PATH;
    if (eventPath) {
      try {
        const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
        const headSha = event?.pull_request?.head?.sha;
        if (headSha) {
          core.info(`PR build detected - using head SHA ${headSha.substring(0, 7)} (not merge ref)`);
          return headSha;
        }
      } catch {
        // Fall through to GITHUB_SHA
      }
    }
  }

  return process.env.GITHUB_SHA || '';
}

run();
