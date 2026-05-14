# Harden Build Attestation

GitHub Action for CI/CD build-time attestation. Proves that an SDK artifact was built by a registered CI/CD pipeline using OIDC or HMAC verification, generating a `harden.config` that the SDK reads at startup.

## GitHub Actions

```yaml
jobs:
  build:
    permissions:
      id-token: write  # Required for OIDC
      contents: read
    steps:
      - uses: actions/checkout@v4

      - name: Attest to Harden
        uses: HardenLabs/build-attest-action@v2
        with:
          connections: ${{ secrets.HARDEN_CONN_MY_SERVER }}
          environment: production

      - name: Build your application
        run: dotnet build  # harden.config is now available
```

### Multiple Connections

```yaml
      - uses: HardenLabs/build-attest-action@v2
        with:
          connections: |
            ${{ secrets.HARDEN_CONN_SERVICE_A }}
            ${{ secrets.HARDEN_CONN_SERVICE_B }}
          environment: production
```

### Named Connections (alias mapping)

```yaml
      - uses: HardenLabs/build-attest-action@v2
        with:
          connections: |
            my-api=${{ secrets.HARDEN_CONN_MY_API }}
            payments=${{ secrets.HARDEN_CONN_PAYMENTS }}
          environment: production
```

### Inputs

| Input | Required | Default | Description |
|-------|----------|---------|-------------|
| `connections` | Yes | | Connection values (one per line, `hc_...` or `alias=hc_...`) |
| `environment` | No | `production` | Harden environment: `production`, `sandbox`, `labs`, `development` |
| `auth` | No | `auto` | Auth mode: `oidc`, `hmac`, or `auto` (OIDC when available, HMAC fallback) |
| `config-path` | No | `harden.config` | Path to write the generated config file |
| `platform` | No | `github_actions` | CI platform identifier |
| `allowed-ips` | No | | Comma-separated allowed IPs for this build |
| `allowed-cidrs` | No | | Comma-separated allowed CIDR ranges for this build |

### Outputs

| Output | Description |
|--------|-------------|
| `build-id` | Build ID from the attestation response |
| `config-hash` | SHA-256 hash of the generated `harden.config` |
| `aliases` | Comma-separated list of connection aliases in the config |

## How it works

1. Authenticates with Harden via OIDC token (GitHub Actions) or HMAC challenge
2. Sends the connection value + platform context to the attestation endpoint
3. Harden verifies identity and returns a signed `harden.config`
4. The config is written to disk (default: `harden.config`, mode `0600`)
5. At runtime, the SDK reads `harden.config` to obtain ephemeral keys

If attestation fails, the step fails and no config is produced. The build cannot proceed without valid attestation.

## Migrating from v1

V1 used OAuth client credentials (`client-id`, `client-secret`, `service-id`). V2 uses connection values directly:

```yaml
# v1 (deprecated)
- uses: HardenLabs/build-attest-action@v1
  with:
    client-id: ${{ secrets.HARDEN_CLIENT_ID }}
    client-secret: ${{ secrets.HARDEN_CLIENT_SECRET }}
    service-id: svc_myapp_server_a1b2

# v2
- uses: HardenLabs/build-attest-action@v2
  with:
    connections: ${{ secrets.HARDEN_CONN_MY_SERVER }}
    environment: production
```

## Troubleshooting

**"Failed to get OIDC token"** - Add `permissions: id-token: write` to your workflow job.

**"No connection values provided"** - Set the `connections` input. The value should start with `hc_` or `hs_`.

**"Attestation failed: HTTP 403"** - Check that the connection is active and TOFU binding allows this repository.

**"Unknown environment"** - Must be one of: `production`, `sandbox`, `labs`, `development`.

## License

MIT
