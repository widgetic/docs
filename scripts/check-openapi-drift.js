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

const sourcePath = path.resolve(
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

function normalizeJson(text) {
  // Normalize formatting only; preserves content semantics
  return JSON.stringify(JSON.parse(text));
}

function main() {
  const sourceRaw = readFileOrThrow(sourcePath);
  const targetRaw = readFileOrThrow(targetPath);

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
  main();
} catch (error) {
  console.error('OpenAPI drift check failed:', error.message);
  process.exit(1);
}

