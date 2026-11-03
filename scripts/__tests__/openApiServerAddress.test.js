'use strict';

/**
 * Tests for the address check of the OpenAPI description (`scripts/lib/openApiServerAddress.js`), which
 * `sync-openapi.js` and `check-openapi-drift.js` run before they look at anything else.
 *
 * Run with: node --test scripts/__tests__/openApiServerAddress.test.js
 *
 * Each answer is shown: a check that has only ever passed proves nothing, so the description a laptop writes
 * (API_URL=http://localhost:3000 in its .env) is given to it on purpose and its exact message is asserted.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  HOW_TO_WRITE_FOR_PRODUCTION,
  PRODUCTION_SERVER_URL,
  checkProductionServer,
} = require('../lib/openApiServerAddress');

/** A description with the servers given, as the gateway writes them (the first one is what the SDKs and the docs use). */
function descriptionWithServers(...urls) {
  return { openapi: '3.0.0', servers: urls.map((url) => ({ url })) };
}

test('the production address is the API with its version prefix', () => {
  assert.equal(PRODUCTION_SERVER_URL, 'https://api.widgetic.com/v1');
});

test('a description whose first server is production is accepted, with a slash at its end or without one', () => {
  assert.deepEqual(checkProductionServer(descriptionWithServers(PRODUCTION_SERVER_URL)), []);
  assert.deepEqual(checkProductionServer(descriptionWithServers(`${PRODUCTION_SERVER_URL}/`)), []);
});

test('a description written on a laptop whose .env says API_URL=http://localhost:3000 is refused, and both addresses are named', () => {
  assert.deepEqual(checkProductionServer(descriptionWithServers('http://localhost:3000/v1')), [
    `the description's first server is http://localhost:3000/v1; the docs have to show ${PRODUCTION_SERVER_URL}`,
  ]);
});

test('only the first server counts, as it does for the SDKs', () => {
  assert.equal(checkProductionServer(descriptionWithServers('http://localhost:3000/v1', PRODUCTION_SERVER_URL)).length, 1);
  assert.deepEqual(checkProductionServer(descriptionWithServers(PRODUCTION_SERVER_URL, 'http://localhost:3000/v1')), []);
});

test('a description with no server, or no description at all, says the address cannot be checked', () => {
  const noServer = ['the description names no server, so the address the docs show cannot be checked'];

  assert.deepEqual(checkProductionServer({ openapi: '3.0.0' }), noServer);
  assert.deepEqual(checkProductionServer({ servers: [] }), noServer);
  assert.deepEqual(checkProductionServer({ servers: [{}] }), noServer);
  assert.deepEqual(checkProductionServer(null), noServer);
  assert.deepEqual(checkProductionServer(undefined), noServer);
});

test('the lines a script prints after the problems name the command that writes the description for production', () => {
  assert.ok(HOW_TO_WRITE_FOR_PRODUCTION.some((line) => line.includes('API_URL=https://api.widgetic.com API_VERSION=/v1 npm run generate-schema-docs')));
});

test('the copy of the description in the docs names production, as the check asks of what is synced to it', () => {
  const docsCopy = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../openapi/widgetic-api-public.json'), 'utf8'));

  assert.deepEqual(checkProductionServer(docsCopy), []);
});
