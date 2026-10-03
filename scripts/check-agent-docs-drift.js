#!/usr/bin/env node

/**
 * Fail if the "AI agents (MCP)" pages say something the gateway no longer does.
 *
 * The tools reference repeats the tool contract (permission, credits, flags) and the
 * authentication page repeats the words of the consent page. Both are owned by the
 * api-gateway-service repository; this check compares the docs with them, and checks that
 * the two addresses the gateway sends people to (the OAuth metadata's documentation page and
 * the redirect of the bare MCP host) are the pages of this site they are meant to open.
 *
 * Run it whenever a tool's metadata or a permission's wording changes there, and in CI next to
 * `check-openapi-drift`. The rules are in `scripts/lib/agentDocsDrift.js`.
 *
 * Usage:
 *   npm run check-agent-docs-drift
 *   GATEWAY_ROOT=/path/to/api-gateway-service npm run check-agent-docs-drift
 */

const fs = require('fs');
const path = require('path');
const { checkAgentDocs } = require('./lib/agentDocsDrift');

const DOCS_ROOT = path.resolve(__dirname, '..');

// Same sibling-checkout layout `check-openapi-drift` relies on.
const GATEWAY_ROOT = process.env.GATEWAY_ROOT
  ? path.resolve(process.env.GATEWAY_ROOT)
  : path.resolve(__dirname, '../../../Services/api-gateway-service');

const TOOL_SNAPSHOT_PATH = path.join(GATEWAY_ROOT, 'tests/fixtures/mcpToolContract.snapshot.json');
const SCOPE_SOURCE_PATH = path.join(GATEWAY_ROOT, 'src/services/mcpOAuth/oauthConstants.ts');
const MCP_PUBLIC_HOST_SOURCE_PATH = path.join(GATEWAY_ROOT, 'src/config/mcpPublicHost.ts');

function readFileOrThrow(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

function main() {
  const problems = checkAgentDocs({
    toolSnapshotText: readFileOrThrow(TOOL_SNAPSHOT_PATH),
    scopeSourceText: readFileOrThrow(SCOPE_SOURCE_PATH),
    mcpPublicHostText: readFileOrThrow(MCP_PUBLIC_HOST_SOURCE_PATH),
    toolsPage: readFileOrThrow(path.join(DOCS_ROOT, 'docs/agents/tools.mdx')),
    authenticationPage: readFileOrThrow(path.join(DOCS_ROOT, 'docs/agents/authentication.mdx')),
    navigationText: readFileOrThrow(path.join(DOCS_ROOT, 'docs.json')),
    pageExists: (relativePath) => fs.existsSync(path.join(DOCS_ROOT, relativePath)),
  });

  if (problems.length > 0) {
    console.error('The AI agents (MCP) docs have drifted from the gateway:\n');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('\nUpdate the docs pages (never the gateway sources) so they say what the gateway does.');
    process.exit(1);
  }

  console.log('AI agents (MCP) docs match the tool contract and the consent page wording, and the gateway links to them.');
}

try {
  main();
} catch (error) {
  console.error(`Could not check the AI agents (MCP) docs: ${error.message}`);
  process.exit(1);
}
