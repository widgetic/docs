#!/usr/bin/env node

/**
 * Fail if docs-site OpenAPI differs from generated public spec.
 *
 * This is meant to run in CI to prevent docs drift.
 *
 * Source of truth:
 *   Services/api-gateway-service/client-sdk/openapi-spec-public.json
 *
 * Docs copy:
 *   Frontend/docs-site/openapi/widgetic-api-public.json
 */

const fs = require('fs');
const path = require('path');
const { HOW_TO_WRITE_FOR_PRODUCTION, checkProductionServer } = require('./lib/openApiServerAddress');

const localSourcePath = path.resolve(
  __dirname,
  '../../../Services/api-gateway-service/client-sdk/openapi-spec-public.json'
);

const targetPath = path.resolve(
  __dirname,
  '../openapi/widgetic-api-public.json'
);

function readFileOrThrow(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  return fs.readFileSync(filePath, 'utf8');
}

async function readSourceOrThrow() {
  const remoteUrl = process.env.OPENAPI_SOURCE_URL;

  if (remoteUrl) {
    if (typeof fetch !== 'function') {
      throw new Error('Global fetch is not available in this Node runtime. Use Node 18+ or remove OPENAPI_SOURCE_URL.');
    }

    const response = await fetch(remoteUrl, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenAPI spec: HTTP ${response.status}`);
    }

    return await response.text();
  }

  return readFileOrThrow(localSourcePath);
}

// The docs add code samples to their copy after the sync (`npm run generate-code-samples`). They come from the
// description itself, so they are not drift: without this, the check failed on every copy that had samples.
const KEYS_THE_DOCS_ADD = ['x-codeSamples', 'x-code-samples'];

function withoutKeysTheDocsAdd(node) {
  if (Array.isArray(node)) return node.map(withoutKeysTheDocsAdd);
  if (node && typeof node === 'object') {
    const keptEntries = {};
    for (const [key, value] of Object.entries(node)) {
      if (KEYS_THE_DOCS_ADD.includes(key)) continue;
      keptEntries[key] = withoutKeysTheDocsAdd(value);
    }
    return keptEntries;
  }
  return node;
}

function normalizeJson(text) {
  // Normalize formatting only, and leave out what the docs add themselves; preserves content semantics
  return JSON.stringify(withoutKeysTheDocsAdd(JSON.parse(text)));
}

async function main() {
  const sourceRaw = await readSourceOrThrow();
  const targetRaw = readFileOrThrow(targetPath);

  // A description written for another machine (API_URL=http://localhost:3000 in a laptop's .env) is not one the docs can be
  // synced to, so "out of sync" would send the reader to a sync that refuses it: say what is wrong with the source first.
  const addressProblems = checkProductionServer(JSON.parse(sourceRaw));
  if (addressProblems.length > 0) {
    console.error('OpenAPI drift cannot be judged: the generated public spec is not written for production.');
    for (const problem of addressProblems) console.error(`  - ${problem}`);
    console.error('');
    for (const line of HOW_TO_WRITE_FOR_PRODUCTION) console.error(line);
    process.exit(1);
  }

  const source = normalizeJson(sourceRaw);
  const target = normalizeJson(targetRaw);

  if (source !== target) {
    console.error('OpenAPI drift detected: docs-site spec is out of sync.');
    console.error('');
    console.error('Fix by running:');
    console.error('  cd Frontend/docs-site');
    console.error('  npm run sync-openapi');
    process.exit(1);
  }

  console.log('OpenAPI spec is in sync.');
}

try {
  main().catch((error) => {
    console.error('OpenAPI drift check failed:', error && error.message ? error.message : String(error));
    process.exit(1);
  });
} catch (error) {
  console.error('OpenAPI drift check failed:', error.message);
  process.exit(1);
}

