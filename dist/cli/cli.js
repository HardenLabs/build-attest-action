"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
const attest_1 = require("./attest");
async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args['help'] || args['h']) {
        printUsage();
        process.exit(0);
    }
    if (args['version'] || args['v']) {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pkg = require('../package.json');
        console.log(pkg.version);
        process.exit(0);
    }
    // Resolve options from args, then environment variables
    const clientId = args['client-id'] || process.env.HARDEN_CLIENT_ID || '';
    const clientSecret = args['client-secret'] || process.env.HARDEN_CLIENT_SECRET || '';
    const serviceId = args['service-id'] || process.env.HARDEN_SERVICE_ID || '';
    const oidcToken = args['oidc-token'] || process.env.HARDEN_OIDC_TOKEN || '';
    const commitSha = args['commit-sha'] || process.env.CI_COMMIT_SHA || process.env.GITHUB_SHA || '';
    const apiEndpoint = args['api-endpoint'] || process.env.HARDEN_API_ENDPOINT || 'https://api.hardenapi.com';
    const maxRetries = parseInt(args['max-retries'] || '3', 10);
    const jsonOutput = args['json'] === 'true';
    // Validate required args
    const missing = [];
    if (!clientId)
        missing.push('--client-id or HARDEN_CLIENT_ID');
    if (!clientSecret)
        missing.push('--client-secret or HARDEN_CLIENT_SECRET');
    if (!serviceId)
        missing.push('--service-id or HARDEN_SERVICE_ID');
    if (!oidcToken)
        missing.push('--oidc-token or HARDEN_OIDC_TOKEN');
    if (!commitSha)
        missing.push('--commit-sha or CI_COMMIT_SHA');
    if (missing.length > 0) {
        console.error(`Error: Missing required arguments:\n  ${missing.join('\n  ')}\n`);
        printUsage();
        process.exit(1);
    }
    try {
        const result = await (0, attest_1.attest)({
            clientId,
            clientSecret,
            serviceId,
            apiEndpoint,
            oidcToken,
            commitSha,
            maxRetries,
        });
        if (jsonOutput) {
            console.log(JSON.stringify(result));
        }
        else {
            console.log(`HARDEN_BUILD_KEY=${result.buildKey}`);
            console.log(`HARDEN_COMMIT_SHA=${result.commitSha}`);
        }
    }
    catch (error) {
        if (error instanceof attest_1.AttestError) {
            console.error(`Error: ${error.message}`);
            if (error.statusCode) {
                console.error(`HTTP status: ${error.statusCode}`);
            }
        }
        else {
            console.error(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        process.exit(1);
    }
}
function parseArgs(argv) {
    const result = {};
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg.startsWith('--')) {
            const key = arg.substring(2);
            if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
                result[key] = argv[i + 1];
                i++;
            }
            else {
                result[key] = 'true';
            }
        }
        else if (arg === '-h') {
            result['help'] = 'true';
        }
        else if (arg === '-v') {
            result['version'] = 'true';
        }
    }
    return result;
}
function printUsage() {
    console.log(`
Harden Build Attestation CLI

Attest a CI/CD build with Harden using OIDC. Returns a build key that
proves the artifact was built by a registered CI/CD pipeline.

USAGE:
  harden-attest [OPTIONS]

OPTIONS:
  --client-id ID         Harden OAuth client ID (or HARDEN_CLIENT_ID)
  --client-secret SECRET Harden OAuth client secret (or HARDEN_CLIENT_SECRET)
  --service-id SVC       Harden service ID, svc_xxxx (or HARDEN_SERVICE_ID)
  --oidc-token TOKEN     CI provider OIDC JWT (or HARDEN_OIDC_TOKEN)
  --commit-sha SHA       Git commit SHA (or CI_COMMIT_SHA / GITHUB_SHA)
  --api-endpoint URL     Harden API URL (default: https://api.hardenapi.com)
  --max-retries N        Max retry attempts on 5xx (default: 3)
  --json                 Output as JSON instead of key=value
  --help, -h             Show this help
  --version, -v          Show version

EXAMPLES:
  # GitLab CI
  harden-attest --client-id $HARDEN_CLIENT_ID --client-secret $HARDEN_CLIENT_SECRET \\
    --service-id svc_myapp_server_a1b2 --oidc-token $CI_JOB_JWT --commit-sha $CI_COMMIT_SHA

  # Azure DevOps
  harden-attest --client-id $HARDEN_CLIENT_ID --client-secret $HARDEN_CLIENT_SECRET \\
    --service-id svc_myapp_server_a1b2 --oidc-token $SYSTEM_OIDCTOKEN --commit-sha $BUILD_SOURCEVERSION

  # Capture output for deployment
  eval $(harden-attest --client-id ... --service-id ... --oidc-token ... --commit-sha ...)
  echo "Build key: $HARDEN_BUILD_KEY"
`.trim());
}
main();
//# sourceMappingURL=cli.js.map