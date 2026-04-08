/**
 * CLI entry point for Harden build attestation.
 *
 * For CI/CD providers other than GitHub Actions (GitLab, ADO, CircleCI, etc.).
 * The customer obtains the OIDC token from their CI provider and passes it
 * as an argument or environment variable.
 *
 * Usage:
 *   harden-attest --client-id ID --client-secret SECRET \
 *     --service-id svc_xxxx --oidc-token TOKEN --commit-sha SHA
 *
 *   # Or via environment variables:
 *   HARDEN_CLIENT_ID=... HARDEN_CLIENT_SECRET=... harden-attest \
 *     --service-id svc_xxxx --oidc-token $CI_JOB_JWT --commit-sha $CI_COMMIT_SHA
 *
 * Output (default):
 *   HARDEN_BUILD_KEY=abc123...
 *   HARDEN_COMMIT_SHA=def456...
 *
 * Output (--json):
 *   {"buildKey":"abc123...","commitSha":"def456..."}
 */
export {};
