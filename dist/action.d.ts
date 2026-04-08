/**
 * GitHub Action entry point for Harden build attestation.
 *
 * Requests a GitHub Actions OIDC token, authenticates with Harden,
 * and calls the build attestation endpoint. Outputs the build key
 * and commit SHA for downstream steps.
 */
export {};
