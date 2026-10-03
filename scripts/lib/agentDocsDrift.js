'use strict';

/**
 * Drift checks for the "AI agents (MCP)" pages.
 *
 * What those pages say about the tools and the permissions is not written freely: the tools
 * reference repeats the gateway's tool contract (permission, credits, the read-only / changes /
 * outside-world flags) and the authentication page repeats, word for word, what the consent page
 * tells a person they are approving. Both sources live in the api-gateway-service repository, so
 * a change there that is not followed here would leave the docs promising something the server
 * no longer does. This module compares the two and returns every difference as a sentence.
 *
 * It is pure: it takes the file contents and returns a list of problems, so it can be tested
 * without a checkout of the gateway. `scripts/check-agent-docs-drift.js` reads the files.
 *
 * Sources of truth (gateway repository):
 *   tests/fixtures/mcpToolContract.snapshot.json   the tool contract snapshot (every public tool)
 *   src/services/mcpOAuth/oauthConstants.ts        MCP_SCOPE_DESCRIPTIONS (the consent page words) and
 *                                                  MCP_AUTHENTICATION_DOCS_URL (the page the OAuth metadata names)
 *   src/config/mcpPublicHost.ts                    DEFAULT_MCP_DOCS_URL (where the bare MCP host redirects)
 */

/** Pages the navigation must list, in the "AI agents (MCP)" group. */
const AGENT_NAVIGATION_GROUP = 'AI agents (MCP)';
const AGENT_PAGES = [
  'docs/agents/overview',
  'docs/agents/connect',
  'docs/agents/tools',
  'docs/agents/authentication',
];

/** A row of the "At a glance" table: | `tool` | what it does | `scope` | credits |. */
const AT_A_GLANCE_ROW = /^\|\s*`([a-z_]+)`\s*\|[^|]*\|\s*`(widgetic\.[a-z]+)`\s*\|\s*(\d+)\s*\|\s*$/;

/**
 * A row of the flags table: | `tool`, `tool` | reads only | can change | outside world |, each flag
 * cell starting with yes or no (a note may follow in brackets).
 */
const FLAGS_ROW = /^\|\s*((?:`[a-z_]+`(?:,\s*)?)+)\s*\|\s*(yes|no)\b[^|]*\|\s*(yes|no)\b[^|]*\|\s*(yes|no)\b[^|]*\|\s*$/;

/** A row of the permissions table: | `scope` | what the consent page says |. */
const PERMISSION_ROW = /^\|\s*`([a-z_.]+)`\s*\|\s*(.+?)\s*\|\s*$/;

/** The title of every per-tool section on the tools page. */
const ACCORDION_TITLE = /<Accordion title="([a-z_]+)"/g;

/**
 * The tools of the contract snapshot, reduced to what the docs repeat.
 *
 * `credits` comes from the description, which states the cost of a call that has one ("uses 1
 * credit", "uses 20 credits"); a tool whose description names no cost is free.
 */
function readToolContract(snapshotText) {
  const snapshot = JSON.parse(snapshotText);
  if (!snapshot || !Array.isArray(snapshot.tools) || snapshot.tools.length === 0) {
    throw new Error('The tool contract snapshot has no tools.');
  }
  return snapshot.tools.map((tool) => {
    const schemes = Array.isArray(tool.securitySchemes) ? tool.securitySchemes : [];
    const scopes = schemes.flatMap((scheme) => (Array.isArray(scheme.scopes) ? scheme.scopes : []));
    const annotations = tool.annotations || {};
    // "uses 20 credits" or, for the price of one generation, "uses 1 credit"; also at the start of a
    // sentence ("Uses 20 credits").
    const cost = /uses (\d+) credits?\b/i.exec(tool.description || '');
    return {
      name: tool.name,
      scopes,
      readOnly: annotations.readOnlyHint === true,
      changes: annotations.destructiveHint === true,
      outsideWorld: annotations.openWorldHint === true,
      credits: cost ? Number(cost[1]) : 0,
    };
  });
}

/** MCP_SCOPE_DESCRIPTIONS from the gateway source, as { scope: words }. */
function readScopeDescriptions(sourceText) {
  const start = sourceText.indexOf('export const MCP_SCOPE_DESCRIPTIONS = {');
  if (start === -1) throw new Error('MCP_SCOPE_DESCRIPTIONS was not found in the gateway source.');
  const end = sourceText.indexOf('} as const', start);
  if (end === -1) throw new Error('The end of MCP_SCOPE_DESCRIPTIONS was not found in the gateway source.');
  const entries = {};
  const line = /^\s*(?:'([^']+)'|([A-Za-z_]+)):\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"),?\s*$/;
  for (const raw of sourceText.slice(start, end).split('\n')) {
    const match = line.exec(raw);
    if (!match) continue;
    const scope = match[1] !== undefined ? match[1] : match[2];
    const words = match[3] !== undefined ? match[3] : match[4];
    entries[scope] = words.replace(/\\(['"\\])/g, '$1');
  }
  if (Object.keys(entries).length === 0) {
    throw new Error('No scope descriptions could be read from MCP_SCOPE_DESCRIPTIONS.');
  }
  return entries;
}

/** The tools page checked against the tool contract. */
function checkToolsPage(toolsPage, tools) {
  const problems = [];
  const lines = toolsPage.split('\n');

  // Permission and credits, per tool.
  const glance = new Map();
  for (const line of lines) {
    const match = AT_A_GLANCE_ROW.exec(line);
    if (match) glance.set(match[1], { scope: match[2], credits: Number(match[3]) });
  }
  const contractNames = new Set(tools.map((tool) => tool.name));
  for (const tool of tools) {
    const row = glance.get(tool.name);
    if (!row) {
      problems.push(`tools.mdx: the "At a glance" table has no row for ${tool.name}.`);
      continue;
    }
    // A tool that needs several permissions is documented with them side by side.
    const scope = tool.scopes.join(' ');
    if (row.scope !== scope) {
      problems.push(`tools.mdx: ${tool.name} needs ${scope} in the contract but the table says ${row.scope}.`);
    }
    if (row.credits !== tool.credits) {
      problems.push(`tools.mdx: ${tool.name} costs ${tool.credits === 1 ? '1 credit' : `${tool.credits} credits`} in the contract but the table says ${row.credits}.`);
    }
  }
  for (const name of glance.keys()) {
    if (!contractNames.has(name)) {
      problems.push(`tools.mdx: the "At a glance" table lists ${name}, which is not in the contract.`);
    }
  }

  // The three flags, per tool.
  const flagged = new Map();
  for (const line of lines) {
    const match = FLAGS_ROW.exec(line);
    if (!match) continue;
    const flags = { readOnly: match[2] === 'yes', changes: match[3] === 'yes', outsideWorld: match[4] === 'yes' };
    for (const name of match[1].match(/[a-z_]+/g)) flagged.set(name, flags);
  }
  for (const tool of tools) {
    const flags = flagged.get(tool.name);
    if (!flags) {
      problems.push(`tools.mdx: the flags table has no row for ${tool.name}.`);
      continue;
    }
    for (const [key, label] of [['readOnly', 'reads only'], ['changes', 'can change or replace'], ['outsideWorld', 'interacts with the outside world']]) {
      if (flags[key] !== tool[key]) {
        problems.push(`tools.mdx: ${tool.name} is "${label}: ${tool[key] ? 'yes' : 'no'}" in the contract but the flags table says ${flags[key] ? 'yes' : 'no'}.`);
      }
    }
  }
  for (const name of flagged.keys()) {
    if (!contractNames.has(name)) {
      problems.push(`tools.mdx: the flags table lists ${name}, which is not in the contract.`);
    }
  }

  // One section per tool.
  const sections = Array.from(toolsPage.matchAll(ACCORDION_TITLE), (title) => title[1]);
  for (const tool of tools) {
    const count = sections.filter((name) => name === tool.name).length;
    if (count === 0) problems.push(`tools.mdx: there is no section for ${tool.name}.`);
    if (count > 1) problems.push(`tools.mdx: ${tool.name} has ${count} sections.`);
  }
  for (const name of new Set(sections)) {
    if (!contractNames.has(name)) problems.push(`tools.mdx: there is a section for ${name}, which is not in the contract.`);
  }
  return problems;
}

/** The lines under a heading, up to the next heading of any level. */
function linesUnderHeading(page, heading) {
  const lines = page.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return null;
  const following = lines.slice(start + 1);
  const next = following.findIndex((line) => /^#{1,6}\s/.test(line));
  return next === -1 ? following : following.slice(0, next);
}

/** The permissions table of the authentication page checked against what the consent page says. */
function checkAuthenticationPage(authenticationPage, scopeDescriptions) {
  const section = linesUnderHeading(authenticationPage, '### Permissions');
  if (section === null) return ['authentication.mdx: there is no "### Permissions" section.'];
  const problems = [];
  const documented = new Map();
  for (const line of section) {
    const match = PERMISSION_ROW.exec(line);
    if (match) documented.set(match[1], match[2]);
  }
  for (const [scope, words] of Object.entries(scopeDescriptions)) {
    if (!documented.has(scope)) {
      problems.push(`authentication.mdx: the permissions table has no row for ${scope}.`);
    } else if (documented.get(scope) !== words) {
      problems.push(`authentication.mdx: ${scope} is described as "${words}" on the consent page but the table says "${documented.get(scope)}".`);
    }
  }
  for (const scope of documented.keys()) {
    if (!Object.prototype.hasOwnProperty.call(scopeDescriptions, scope)) {
      problems.push(`authentication.mdx: the permissions table lists ${scope}, which the gateway does not offer.`);
    }
  }
  return problems;
}

/** The navigation lists the agent pages in their group, and every one of them exists. */
function checkNavigation(navigationText, pageExists) {
  const problems = [];
  let docsConfig;
  try {
    docsConfig = JSON.parse(navigationText);
  } catch (error) {
    return ['docs.json: it is not valid JSON.'];
  }
  const tabs = (docsConfig.navigation && docsConfig.navigation.tabs) || [];
  const groups = tabs.flatMap((tab) => tab.groups || []).filter((group) => group.group === AGENT_NAVIGATION_GROUP);
  if (groups.length !== 1) {
    problems.push(`docs.json: expected one navigation group named "${AGENT_NAVIGATION_GROUP}", found ${groups.length}.`);
    return problems;
  }
  const listed = groups[0].pages || [];
  for (const page of AGENT_PAGES) {
    if (!listed.includes(page)) problems.push(`docs.json: the "${AGENT_NAVIGATION_GROUP}" group does not list ${page}.`);
    if (!pageExists(`${page}.mdx`)) problems.push(`docs.json: ${page} is a page of the group but ${page}.mdx does not exist.`);
  }
  return problems;
}

/** The origin the developer docs are published at; the pages of this site are served under `/docs/`. */
const DOCS_ORIGIN = 'https://docs.widgetic.com';

/**
 * One address the gateway sends people to, as a constant of its source, and the page it is meant to
 * open. The first sits in the OAuth metadata documents (`resource_documentation`,
 * `service_documentation`), the second is where a browser that opens the bare MCP host is redirected.
 * A constant that names a page which does not exist, or a path that is not where this site serves the
 * page, is a dead link in a document a client reads.
 */
const GATEWAY_LINKS = [
  { constant: 'MCP_AUTHENTICATION_DOCS_URL', file: 'oauthConstants.ts', page: 'docs/agents/authentication' },
  { constant: 'DEFAULT_MCP_DOCS_URL', file: 'mcpPublicHost.ts', page: 'docs/agents/overview' },
];

/** The value of `export const NAME = '…';` in a source text, or null when it is not there. */
function readExportedString(sourceText, constant) {
  const match = new RegExp(`export const ${constant} = '([^']*)';`).exec(sourceText);
  return match ? match[1] : null;
}

/** The addresses the gateway sends people to, each against the page it is meant to open. */
function checkGatewayLinks({ oauthConstantsText, mcpPublicHostText }) {
  const sources = { 'oauthConstants.ts': oauthConstantsText, 'mcpPublicHost.ts': mcpPublicHostText };
  const problems = [];
  for (const link of GATEWAY_LINKS) {
    const value = readExportedString(sources[link.file], link.constant);
    const expected = `${DOCS_ORIGIN}/${link.page}`;
    if (value === null) {
      problems.push(`${link.file}: ${link.constant} was not found, so the page it opens cannot be checked.`);
    } else if (value !== expected) {
      problems.push(`${link.file}: ${link.constant} is "${value}" but the page it opens is "${expected}".`);
    }
  }
  return problems;
}

/** Every difference between the agent pages and their sources of truth. */
function checkAgentDocs({
  toolSnapshotText,
  scopeSourceText,
  mcpPublicHostText,
  toolsPage,
  authenticationPage,
  navigationText,
  pageExists,
}) {
  return [
    ...checkToolsPage(toolsPage, readToolContract(toolSnapshotText)),
    ...checkAuthenticationPage(authenticationPage, readScopeDescriptions(scopeSourceText)),
    ...checkNavigation(navigationText, pageExists),
    // `scopeSourceText` is `oauthConstants.ts`, which also holds the first link.
    ...checkGatewayLinks({ oauthConstantsText: scopeSourceText, mcpPublicHostText }),
  ];
}

module.exports = {
  AGENT_NAVIGATION_GROUP,
  AGENT_PAGES,
  DOCS_ORIGIN,
  checkAgentDocs,
  checkAuthenticationPage,
  checkGatewayLinks,
  checkNavigation,
  checkToolsPage,
  readScopeDescriptions,
  readToolContract,
};
