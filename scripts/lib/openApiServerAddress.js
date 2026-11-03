'use strict';

/**
 * The address the docs show the API at: the first server of the OpenAPI description (`servers[0].url`).
 *
 * `npm run sync-openapi` copies the gateway's description into the docs as it is, and the gateway builds its first server from
 * `API_URL` and `API_VERSION`. A description written on a machine whose `.env` says `API_URL=http://localhost:3000` names that
 * machine, and copied it puts localhost into the API reference, into its "try it" requests and into every code sample.
 *
 * Both `sync-openapi.js` and `check-openapi-drift.js` ask for this before they look at anything else, and the tests in
 * `scripts/__tests__/openApiServerAddress.test.js` show each answer.
 */

/** The address the docs have to show: the production API, with the version prefix every call carries. */
const PRODUCTION_SERVER_URL = 'https://api.widgetic.com/v1';

/**
 * What is wrong with the first server of a description, as sentences; none when it is the production address.
 *
 * @param {unknown} description the parsed OpenAPI description
 * @returns {string[]}
 */
function checkProductionServer(description) {
  const servers = description && Array.isArray(description.servers) ? description.servers : [];
  const firstServerUrl = servers[0] && servers[0].url;

  if (typeof firstServerUrl !== 'string') {
    return ['the description names no server, so the address the docs show cannot be checked'];
  }
  if (firstServerUrl.replace(/\/+$/, '') !== PRODUCTION_SERVER_URL) {
    return [`the description's first server is ${firstServerUrl}; the docs have to show ${PRODUCTION_SERVER_URL}`];
  }
  return [];
}

/** How to write the description for the production address, as the lines a script prints after the problems. */
const HOW_TO_WRITE_FOR_PRODUCTION = [
  'Write the description for production, then run this again:',
  '  cd Services/api-gateway-service',
  '  API_URL=https://api.widgetic.com API_VERSION=/v1 npm run generate-schema-docs',
];

module.exports = { HOW_TO_WRITE_FOR_PRODUCTION, PRODUCTION_SERVER_URL, checkProductionServer };
