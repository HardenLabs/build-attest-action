/**
 * GitHub Action entry point for Harden build attestation.
 *
 * Requests a GitHub Actions OIDC token, authenticates with Harden,
 * and calls the build attestation endpoint. Outputs the build key
 * and commit SHA for downstream steps.
 */

import * as core from '@actions/core';
import * as fs from 'fs';
import * as path from 'path';
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

    // Auto-inject build key into SDK source files
    const inject = core.getInput('inject') !== 'false';
    if (inject) {
      const searchPath = core.getInput('search-path') || '.';
      const injectedCount = injectBuildKey(searchPath, result.buildKey, result.commitSha);
      core.setOutput('injected-files', injectedCount.toString());
      if (injectedCount > 0) {
        core.info(`Injected build key into ${injectedCount} file(s)`);
      } else {
        core.info('No SDK placeholder files found (this is normal for C# — .targets handles injection via MSBuild)');
      }
    }

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

/**
 * Search for SDK source files containing %%HARDEN_BUILD_KEY%% placeholders
 * and replace them with actual values. This handles TypeScript and Python SDKs.
 * C# uses MSBuild .targets (no placeholder replacement needed).
 */
function injectBuildKey(searchPath: string, buildKey: string, commitSha: string): number {
  const placeholder_build_key = '%%HARDEN_BUILD_KEY%%';
  const placeholder_commit_sha = '%%HARDEN_COMMIT_SHA%%';
  let injectedCount = 0;

  const filesToCheck = findFilesWithPlaceholder(searchPath, placeholder_build_key);

  for (const filePath of filesToCheck) {
    try {
      let content = fs.readFileSync(filePath, 'utf8');
      const hadBuildKey = content.includes(placeholder_build_key);
      const hadCommitSha = content.includes(placeholder_commit_sha);

      if (hadBuildKey || hadCommitSha) {
        content = content.replace(new RegExp(escapeRegex(placeholder_build_key), 'g'), buildKey);
        content = content.replace(new RegExp(escapeRegex(placeholder_commit_sha), 'g'), commitSha);
        fs.writeFileSync(filePath, content, 'utf8');
        injectedCount++;
        // Log the filename but NOT the build key value (already masked by core.setSecret)
        core.info(`  Injected: ${path.relative(searchPath, filePath)}`);
      }
    } catch (err) {
      core.warning(`Failed to inject into ${filePath}: ${err}`);
    }
  }

  return injectedCount;
}

/**
 * Recursively find files containing the placeholder string.
 * Searches .ts, .js, .py, .mjs, .cjs files. Skips node_modules, dist, __pycache__, .git.
 */
function findFilesWithPlaceholder(dir: string, placeholder: string): string[] {
  const results: string[] = [];
  const skipDirs = new Set(['node_modules', 'dist', '__pycache__', '.git', 'bin', 'obj', 'build', '.venv', 'venv']);
  const extensions = new Set(['.ts', '.js', '.py', '.mjs', '.cjs']);

  function walk(currentDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) {
          walk(path.join(currentDir, entry.name));
        }
      } else if (entry.isFile() && extensions.has(path.extname(entry.name))) {
        const filePath = path.join(currentDir, entry.name);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          if (content.includes(placeholder)) {
            results.push(filePath);
          }
        } catch {
          // Can't read file — skip
        }
      }
    }
  }

  walk(path.resolve(dir));
  return results;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

run();
