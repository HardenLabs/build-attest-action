# Harden Build Attestation

GitHub Action and CLI for CI/CD build-time attestation. Proves that an SDK artifact was built by a registered CI/CD pipeline using OIDC verification, making leaked credentials provably insufficient.

## GitHub Actions

```yaml
jobs:
  build:
    permissions:
      id-token: write  # Required for OIDC
    steps:
      - uses: actions/checkout@v4

      - uses: HardenLabs/build-attest-action@v1
        id: attest
        with:
          client-id: ${{ secrets.HARDEN_CLIENT_ID }}
          client-secret: ${{ secrets.HARDEN_CLIENT_SECRET }}
          service-id: svc_myapp_server_a1b2

      # Use the build key in your deployment
      - run: echo "HARDEN_BUILD_KEY=${{ steps.attest.outputs.build-key }}" >> deployment.env
```

### Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `client-id` | Yes | Harden OAuth client ID |
| `client-secret` | Yes | Harden OAuth client secret |
| `service-id` | Yes | Harden service ID (`svc_xxxx`) |
| `api-endpoint` | No | Harden API URL (default: `https://api.hardenapi.com`) |
| `commit-sha` | No | Override commit SHA (default: current commit) |
| `max-retries` | No | Max retry attempts on 5xx (default: `3`) |

### Outputs

| Output | Description |
|--------|-------------|
| `build-key` | The build attestation key (masked in logs) |
| `commit-sha` | The commit SHA used for attestation |

## CLI (for GitLab, Azure DevOps, CircleCI, etc.)

Install globally or use `npx`:

```bash
npx @hardenlabs/build-attest \
  --client-id $HARDEN_CLIENT_ID \
  --client-secret $HARDEN_CLIENT_SECRET \
  --service-id svc_myapp_server_a1b2 \
  --oidc-token $CI_JOB_JWT \
  --commit-sha $CI_COMMIT_SHA
```

Output:
```
HARDEN_BUILD_KEY=abc123...
HARDEN_COMMIT_SHA=def456...
```

Use `--json` for JSON output. Use `eval $(...)` to capture as environment variables.

All arguments can also be set via environment variables: `HARDEN_CLIENT_ID`, `HARDEN_CLIENT_SECRET`, `HARDEN_SERVICE_ID`, `HARDEN_OIDC_TOKEN`, `CI_COMMIT_SHA`.

## How it works

1. Authenticates with Harden via OAuth client credentials
2. Requests a CI/CD OIDC token (GitHub Action does this automatically; CLI takes it as input)
3. Sends the OIDC token + commit SHA to Harden's attestation endpoint
4. Harden verifies the OIDC token against the CI provider's JWKS public keys
5. Harden computes `build_key = HMAC-SHA256(service_salt, commit_sha)` and returns it
6. The build key is embedded in the deployment as an environment variable
7. At runtime, the SDK sends the build key to the Key API, which validates it

If attestation fails (OIDC mismatch, service not found, Harden unavailable after retries), the build fails. No artifact is produced without a valid build key.

## Troubleshooting

**"Failed to get OIDC token"** - Add `permissions: id-token: write` to your workflow job.

**"OAuth authentication failed (401)"** - Check that `client-id` and `client-secret` are correct.

**"Attestation rejected (403)"** - Check that:
- Build attestation is enabled on the service
- An OIDC registration exists matching this repository
- The branch pattern allows this ref

**Network errors** - The CLI retries 5xx errors with exponential backoff. 4xx errors fail immediately.

## License

MIT
