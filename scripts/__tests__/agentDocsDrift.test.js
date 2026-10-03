'use strict';

/**
 * Tests for the drift checks of the "AI agents (MCP)" pages (`scripts/lib/agentDocsDrift.js`).
 *
 * Run with: node --test scripts/__tests__/agentDocsDrift.test.js
 *
 * Each rule is shown to fail: a check that has only ever passed proves nothing, so every kind of
 * difference the checker promises to report is introduced here on purpose and its exact message
 * is asserted.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const {
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
} = require('../lib/agentDocsDrift');

// ---------------------------------------------------------------------------------------------
// Fixtures: a three-tool contract and the pages that agree with it.
// ---------------------------------------------------------------------------------------------

/** A tool as the contract snapshot stores it. */
function contractTool(name, scope, annotations, description) {
  return {
    name,
    description,
    annotations,
    securitySchemes: [{ type: 'oauth2', scopes: [scope] }],
  };
}

const READ_TOOL = contractTool(
  'get_thing',
  'widgetic.read',
  { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  'Use this to read a thing. It uses no credits.',
);
const WRITE_TOOL = contractTool(
  'make_thing',
  'widgetic.write',
  { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  'Use this to make a thing. Each call uses 20 credits, charged up front.',
);
const PUBLISH_TOOL = contractTool(
  'publish_thing',
  'widgetic.publish',
  { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  'Use this to publish a thing.',
);

const snapshotText = (tools = [READ_TOOL, WRITE_TOOL, PUBLISH_TOOL]) => JSON.stringify({ tools });

/** A tools page that agrees with the three tools above. */
const TOOLS_PAGE = [
  '---',
  'title: Tools reference',
  '---',
  '',
  '## At a glance',
  '',
  '| Tool | What it does | Permission | Credits |',
  '|---|---|---|---|',
  '| `get_thing` | Reads a thing | `widgetic.read` | 0 |',
  '| `make_thing` | Makes a thing | `widgetic.write` | 20 |',
  '| `publish_thing` | Publishes a thing | `widgetic.publish` | 0 |',
  '',
  '<Accordion title="get_thing" icon="eye">',
  '  Reads.',
  '</Accordion>',
  '<Accordion title="make_thing" icon="pen">',
  '  Makes.',
  '</Accordion>',
  '<Accordion title="publish_thing" icon="rocket">',
  '  Publishes.',
  '</Accordion>',
  '',
  '## What the tool flags mean',
  '',
  '| Tool | Reads only | Can change or replace | Interacts with the outside world |',
  '|---|---|---|---|',
  '| `get_thing` | yes | no | no |',
  '| `make_thing` | no | no (it adds a draft) | no |',
  '| `publish_thing` | no | yes (it replaces what embeds show) | yes (it is public) |',
  '',
].join('\n');

const SCOPE_DESCRIPTIONS = {
  openid: 'Confirm that you are signed in to Widgetic',
  'widgetic.read': 'See your things',
  'widgetic.write': "Make things. It uses your plan's credits",
};

/** The gateway source the scope descriptions are read from. */
const SCOPE_SOURCE = [
  'export const MCP_SCOPE_DESCRIPTIONS = {',
  "  openid: 'Confirm that you are signed in to Widgetic',",
  "  'widgetic.read': 'See your things',",
  '  \'widgetic.write\': "Make things. It uses your plan\'s credits",',
  '} as const satisfies Record<string, string>;',
  '',
  '/** The page that explains to a developer how a client connects to Widgetic. */',
  "export const MCP_AUTHENTICATION_DOCS_URL = 'https://docs.widgetic.com/docs/agents/authentication';",
  '',
].join('\n');

/** The gateway source the address the bare MCP host redirects to is read from. */
const HOST_SOURCE = [
  '/** Where a browser that opens the bare MCP host lands. */',
  "export const DEFAULT_MCP_DOCS_URL = 'https://docs.widgetic.com/docs/agents/overview';",
  '',
].join('\n');

/** An authentication page that agrees with the descriptions above. */
const AUTHENTICATION_PAGE = [
  '## Sign in with Widgetic',
  '',
  '### Permissions',
  '',
  '| Permission | What you are told you are approving |',
  '|---|---|',
  '| `openid` | Confirm that you are signed in to Widgetic |',
  '| `widgetic.read` | See your things |',
  "| `widgetic.write` | Make things. It uses your plan's credits |",
  '',
  '## Errors',
  '',
  '| Status | Meaning | What to do |',
  '|---|---|---|',
  '| `403 forbidden` | Not on the plan | Change plan |',
  '',
].join('\n');

const NAVIGATION = JSON.stringify({
  navigation: {
    tabs: [
      {
        tab: 'Documentation',
        groups: [
          { group: 'Getting Started', pages: ['docs/introduction'] },
          { group: AGENT_NAVIGATION_GROUP, pages: [...AGENT_PAGES] },
        ],
      },
    ],
  },
});

const everyPageExists = () => true;

// ---------------------------------------------------------------------------------------------
// readToolContract
// ---------------------------------------------------------------------------------------------

test('readToolContract reduces each tool to what the docs repeat', () => {
  assert.deepEqual(readToolContract(snapshotText()), [
    { name: 'get_thing', scopes: ['widgetic.read'], readOnly: true, changes: false, outsideWorld: false, credits: 0 },
    { name: 'make_thing', scopes: ['widgetic.write'], readOnly: false, changes: false, outsideWorld: false, credits: 20 },
    { name: 'publish_thing', scopes: ['widgetic.publish'], readOnly: false, changes: true, outsideWorld: true, credits: 0 },
  ]);
});

test('readToolContract reads the cost from the description and treats a tool that names none as free', () => {
  const [tool] = readToolContract(
    snapshotText([contractTool('other', 'widgetic.write', {}, 'It uses 5 credits for each file.')]),
  );
  assert.equal(tool.credits, 5);
  const [free] = readToolContract(snapshotText([contractTool('other', 'widgetic.write', {}, 'Charged nothing.')]));
  assert.equal(free.credits, 0);
  const [sentenceStart] = readToolContract(snapshotText([contractTool('other', 'widgetic.write', {}, 'Make it. Uses 7 credits.')]));
  assert.equal(sentenceStart.credits, 7);
});

test('readToolContract reads the price of one generation, written in the singular: "uses 1 credit"', () => {
  const [tool] = readToolContract(
    snapshotText([contractTool('other', 'widgetic.write', {}, 'Each call starts a separate widget and uses 1 credit, charged up front.')]),
  );
  assert.equal(tool.credits, 1);
  const [sentenceStart] = readToolContract(snapshotText([contractTool('other', 'widgetic.write', {}, 'Make it. Uses 1 credit.')]));
  assert.equal(sentenceStart.credits, 1);
});

test('readToolContract keeps every scope of a tool and tolerates a tool with no security scheme or annotations', () => {
  const [tool] = readToolContract(
    JSON.stringify({
      tools: [
        {
          name: 'two',
          description: '',
          annotations: {},
          securitySchemes: [{ type: 'oauth2', scopes: ['widgetic.read', 'widgetic.write'] }],
        },
      ],
    }),
  );
  assert.deepEqual(tool.scopes, ['widgetic.read', 'widgetic.write']);
  const [bare] = readToolContract(JSON.stringify({ tools: [{ name: 'bare' }] }));
  assert.deepEqual(bare, { name: 'bare', scopes: [], readOnly: false, changes: false, outsideWorld: false, credits: 0 });
});

test('readToolContract refuses a snapshot with no tools', () => {
  assert.throws(() => readToolContract(JSON.stringify({ tools: [] })), /no tools/);
  assert.throws(() => readToolContract(JSON.stringify({})), /no tools/);
  assert.throws(() => readToolContract('null'), /no tools/);
});

// ---------------------------------------------------------------------------------------------
// readScopeDescriptions
// ---------------------------------------------------------------------------------------------

test('readScopeDescriptions reads bare and quoted names and both quote styles', () => {
  assert.deepEqual(readScopeDescriptions(SCOPE_SOURCE), SCOPE_DESCRIPTIONS);
});

test('readScopeDescriptions unescapes quotes and backslashes in the words', () => {
  const source = [
    'export const MCP_SCOPE_DESCRIPTIONS = {',
    "  a: 'It\\'s here',",
    '  b: "Say \\"hi\\"",',
    "  c: 'back\\\\slash',",
    '} as const;',
  ].join('\n');
  assert.deepEqual(readScopeDescriptions(source), { a: "It's here", b: 'Say "hi"', c: 'back\\slash' });
});

test('readScopeDescriptions ignores what comes before and after the block', () => {
  const source = [
    "const OTHER = { x: 'not a scope' };",
    SCOPE_SOURCE,
    "const AFTER = { y: 'not a scope either' } as const;",
  ].join('\n');
  assert.deepEqual(readScopeDescriptions(source), SCOPE_DESCRIPTIONS);
});

test('readScopeDescriptions reads the block the declaration opens, not an earlier mention of its name', () => {
  const source = [
    '// See MCP_SCOPE_DESCRIPTIONS below.',
    'const EARLIER = {',
    "  z: 'not ours',",
    '} as const;',
    'export const MCP_SCOPE_DESCRIPTIONS = {',
    "  a: 'x',",
    '} as const;',
  ].join('\n');
  assert.deepEqual(readScopeDescriptions(source), { a: 'x' });
});

test('readScopeDescriptions does not end the block at a brace inside the words', () => {
  const source = [
    'export const MCP_SCOPE_DESCRIPTIONS = {',
    "  a: 'Use {braces} freely',",
    "  b: 'second',",
    '} as const;',
  ].join('\n');
  assert.deepEqual(readScopeDescriptions(source), { a: 'Use {braces} freely', b: 'second' });
});

test('readScopeDescriptions says so when the block is missing, unterminated or empty', () => {
  assert.throws(() => readScopeDescriptions('const nothing = 1;'), /MCP_SCOPE_DESCRIPTIONS was not found/);
  assert.throws(
    () => readScopeDescriptions("export const MCP_SCOPE_DESCRIPTIONS = {\n  a: 'x',\n"),
    /end of MCP_SCOPE_DESCRIPTIONS was not found/,
  );
  assert.throws(
    () => readScopeDescriptions('export const MCP_SCOPE_DESCRIPTIONS = {\n} as const;'),
    /No scope descriptions could be read/,
  );
});

// ---------------------------------------------------------------------------------------------
// checkToolsPage
// ---------------------------------------------------------------------------------------------

const TOOLS = readToolContract(snapshotText());

/** The tools page with one text replaced; the replaced text must exist, so a typo here fails loudly. */
function toolsPageWith(from, to) {
  assert.ok(TOOLS_PAGE.includes(from), `fixture does not contain: ${from}`);
  return TOOLS_PAGE.replace(from, to);
}

test('checkToolsPage accepts a page that agrees with the contract', () => {
  assert.deepEqual(checkToolsPage(TOOLS_PAGE, TOOLS), []);
});

test('checkToolsPage reports a tool with no "At a glance" row', () => {
  const page = toolsPageWith('| `make_thing` | Makes a thing | `widgetic.write` | 20 |\n', '');
  assert.deepEqual(checkToolsPage(page, TOOLS), ['tools.mdx: the "At a glance" table has no row for make_thing.']);
});

test('checkToolsPage reports an "At a glance" row for a tool the contract does not have', () => {
  const page = toolsPageWith(
    '| `publish_thing` | Publishes a thing | `widgetic.publish` | 0 |\n',
    '| `publish_thing` | Publishes a thing | `widgetic.publish` | 0 |\n| `old_thing` | Gone | `widgetic.read` | 0 |\n',
  );
  assert.deepEqual(checkToolsPage(page, TOOLS), [
    'tools.mdx: the "At a glance" table lists old_thing, which is not in the contract.',
  ]);
});

test('checkToolsPage reports a different permission', () => {
  const page = toolsPageWith('| `get_thing` | Reads a thing | `widgetic.read` | 0 |', '| `get_thing` | Reads a thing | `widgetic.write` | 0 |');
  assert.deepEqual(checkToolsPage(page, TOOLS), [
    'tools.mdx: get_thing needs widgetic.read in the contract but the table says widgetic.write.',
  ]);
});

test('checkToolsPage reports different credits, in both directions', () => {
  const dearer = toolsPageWith('`widgetic.write` | 20 |', '`widgetic.write` | 25 |');
  assert.deepEqual(checkToolsPage(dearer, TOOLS), [
    'tools.mdx: make_thing costs 20 credits in the contract but the table says 25.',
  ]);
  const free = toolsPageWith('`widgetic.read` | 0 |', '`widgetic.read` | 3 |');
  assert.deepEqual(checkToolsPage(free, TOOLS), [
    'tools.mdx: get_thing costs 0 credits in the contract but the table says 3.',
  ]);
});

test('checkToolsPage says "1 credit" for a tool that costs one, and reports a table that says another number', () => {
  const oneCredit = readToolContract(
    snapshotText([contractTool('make_thing', 'widgetic.write', { readOnlyHint: false, destructiveHint: false, openWorldHint: false }, 'Each call uses 1 credit, charged up front.')]),
  );
  const page = [
    '| Tool | What it does | Permission | Credits |',
    '|---|---|---|---|',
    '| `make_thing` | Makes a thing | `widgetic.write` | 2 |',
    '',
    '<Accordion title="make_thing" icon="pen">',
    '  Makes.',
    '</Accordion>',
    '',
    '| Tool | Reads only | Can change or replace | Outside world |',
    '|---|---|---|---|',
    '| `make_thing` | no | no | no |',
  ].join('\n');
  assert.deepEqual(checkToolsPage(page, oneCredit), ['tools.mdx: make_thing costs 1 credit in the contract but the table says 2.']);
});

test('checkToolsPage joins the scopes of a tool that needs several', () => {
  const tools = readToolContract(
    JSON.stringify({
      tools: [{ name: 'both', description: '', annotations: {}, securitySchemes: [{ scopes: ['widgetic.read', 'widgetic.write'] }] }],
    }),
  );
  const page = [
    '| `both` | Both | `widgetic.read` | 0 |',
    '<Accordion title="both">',
    '| `both` | no | no | no |',
  ].join('\n');
  assert.ok(checkToolsPage(page, tools).includes('tools.mdx: both needs widgetic.read widgetic.write in the contract but the table says widgetic.read.'));
});

test('checkToolsPage reports a tool with no flags row', () => {
  const page = toolsPageWith('| `make_thing` | no | no (it adds a draft) | no |\n', '');
  assert.deepEqual(checkToolsPage(page, TOOLS), ['tools.mdx: the flags table has no row for make_thing.']);
});

test('checkToolsPage reports each flag that differs, naming the flag', () => {
  const readsOnly = toolsPageWith('| `make_thing` | no | no (it adds a draft) | no |', '| `make_thing` | yes | no (it adds a draft) | no |');
  assert.deepEqual(checkToolsPage(readsOnly, TOOLS), [
    'tools.mdx: make_thing is "reads only: no" in the contract but the flags table says yes.',
  ]);
  const changes = toolsPageWith('| `get_thing` | yes | no | no |', '| `get_thing` | yes | yes | no |');
  assert.deepEqual(checkToolsPage(changes, TOOLS), [
    'tools.mdx: get_thing is "can change or replace: no" in the contract but the flags table says yes.',
  ]);
  const outside = toolsPageWith('| `get_thing` | yes | no | no |', '| `get_thing` | yes | no | yes |');
  assert.deepEqual(checkToolsPage(outside, TOOLS), [
    'tools.mdx: get_thing is "interacts with the outside world: no" in the contract but the flags table says yes.',
  ]);
  const publishQuiet = toolsPageWith('| `publish_thing` | no | yes (it replaces what embeds show) | yes (it is public) |', '| `publish_thing` | no | no | no |');
  assert.deepEqual(checkToolsPage(publishQuiet, TOOLS), [
    'tools.mdx: publish_thing is "can change or replace: yes" in the contract but the flags table says no.',
    'tools.mdx: publish_thing is "interacts with the outside world: yes" in the contract but the flags table says no.',
  ]);
});

test('checkToolsPage reads a flags row that names several tools and a flag followed by a note', () => {
  const page = toolsPageWith(
    '| `get_thing` | yes | no | no |\n| `make_thing` | no | no (it adds a draft) | no |',
    '| `get_thing`, `make_thing` | yes | no | no |',
  );
  assert.deepEqual(checkToolsPage(page, TOOLS), [
    'tools.mdx: make_thing is "reads only: no" in the contract but the flags table says yes.',
  ]);
});

test('checkToolsPage does not take a word that only begins with yes or no for a flag', () => {
  // Each of the three flag cells, in turn, holds "none": the row is not a flags row, so the tool has none.
  for (const row of ['| `get_thing` | none | no | no |', '| `get_thing` | yes | nope | no |', '| `get_thing` | yes | no | nobody |']) {
    const page = toolsPageWith('| `get_thing` | yes | no | no |', row);
    assert.deepEqual(checkToolsPage(page, TOOLS), ['tools.mdx: the flags table has no row for get_thing.'], row);
  }
});

test('checkToolsPage reports a flags row for a tool the contract does not have', () => {
  const page = toolsPageWith('| `get_thing` | yes | no | no |', '| `get_thing`, `old_thing` | yes | no | no |');
  assert.deepEqual(checkToolsPage(page, TOOLS), ['tools.mdx: the flags table lists old_thing, which is not in the contract.']);
});

test('checkToolsPage reports a tool with no section, a duplicated section and a section for an unknown tool', () => {
  const missing = toolsPageWith('<Accordion title="make_thing" icon="pen">', '<Accordion title="renamed_thing" icon="pen">');
  assert.deepEqual(checkToolsPage(missing, TOOLS), [
    'tools.mdx: there is no section for make_thing.',
    'tools.mdx: there is a section for renamed_thing, which is not in the contract.',
  ]);
  const twice = toolsPageWith('<Accordion title="get_thing" icon="eye">', '<Accordion title="get_thing" icon="eye">\n</Accordion>\n<Accordion title="get_thing" icon="eye">');
  assert.deepEqual(checkToolsPage(twice, TOOLS), ['tools.mdx: get_thing has 2 sections.']);
});

test('checkToolsPage can be run more than once on pages with sections (the title pattern keeps no state)', () => {
  assert.deepEqual(checkToolsPage(TOOLS_PAGE, TOOLS), []);
  assert.deepEqual(checkToolsPage(TOOLS_PAGE, TOOLS), []);
});

// ---------------------------------------------------------------------------------------------
// checkAuthenticationPage
// ---------------------------------------------------------------------------------------------

function authenticationPageWith(from, to) {
  assert.ok(AUTHENTICATION_PAGE.includes(from), `fixture does not contain: ${from}`);
  return AUTHENTICATION_PAGE.replace(from, to);
}

test('checkAuthenticationPage accepts a table with exactly the consent page words', () => {
  assert.deepEqual(checkAuthenticationPage(AUTHENTICATION_PAGE, SCOPE_DESCRIPTIONS), []);
});

test('checkAuthenticationPage reports a permission with no row', () => {
  const page = authenticationPageWith('| `widgetic.read` | See your things |\n', '');
  assert.deepEqual(checkAuthenticationPage(page, SCOPE_DESCRIPTIONS), [
    'authentication.mdx: the permissions table has no row for widgetic.read.',
  ]);
});

test('checkAuthenticationPage reports words that differ from the consent page', () => {
  const page = authenticationPageWith('See your things', 'See all your things');
  assert.deepEqual(checkAuthenticationPage(page, SCOPE_DESCRIPTIONS), [
    'authentication.mdx: widgetic.read is described as "See your things" on the consent page but the table says "See all your things".',
  ]);
});

test('checkAuthenticationPage reports a permission the gateway does not offer', () => {
  const page = authenticationPageWith(
    '| `widgetic.read` | See your things |',
    '| `widgetic.read` | See your things |\n| `widgetic.admin` | Do anything |',
  );
  assert.deepEqual(checkAuthenticationPage(page, SCOPE_DESCRIPTIONS), [
    'authentication.mdx: the permissions table lists widgetic.admin, which the gateway does not offer.',
  ]);
});

test('checkAuthenticationPage only reads the table under the Permissions heading', () => {
  // A row of the right shape under another heading is not a permission.
  const page = `${AUTHENTICATION_PAGE}\n| \`widgetic.admin\` | Under no heading of its own |\n`;
  assert.deepEqual(checkAuthenticationPage(page, SCOPE_DESCRIPTIONS), []);
  // And the section ends at the next heading, so a row below it does not stand in for a missing one.
  const missingRow = authenticationPageWith('| `widgetic.read` | See your things |\n', '').replace(
    '## Errors',
    '## Errors\n\n| `widgetic.read` | See your things |',
  );
  assert.deepEqual(checkAuthenticationPage(missingRow, SCOPE_DESCRIPTIONS), [
    'authentication.mdx: the permissions table has no row for widgetic.read.',
  ]);
});

test('checkAuthenticationPage ends the section at a heading of any level', () => {
  for (const heading of ['# A new top-level heading', '#### Notes on a permission']) {
    const page = `${AUTHENTICATION_PAGE.split('## Errors')[0]}${heading}\n\n| \`widgetic.old\` | A stale row |\n`;
    assert.deepEqual(checkAuthenticationPage(page, SCOPE_DESCRIPTIONS), [], heading);
  }
});

test('checkAuthenticationPage takes only the heading that is exactly "### Permissions"', () => {
  const page = [
    '### Permissions on the old page',
    '| `widgetic.old` | A stale row |',
    '',
    AUTHENTICATION_PAGE,
  ].join('\n');
  assert.deepEqual(checkAuthenticationPage(page, SCOPE_DESCRIPTIONS), []);
});

test('checkAuthenticationPage says so when there is no Permissions section', () => {
  assert.deepEqual(checkAuthenticationPage('## Sign in\n', SCOPE_DESCRIPTIONS), [
    'authentication.mdx: there is no "### Permissions" section.',
  ]);
});

test('checkAuthenticationPage reads the section when it is the last thing on the page', () => {
  const page = ['### Permissions', '', '| `openid` | Confirm that you are signed in to Widgetic |'].join('\n');
  assert.deepEqual(checkAuthenticationPage(page, { openid: 'Confirm that you are signed in to Widgetic' }), []);
});

// ---------------------------------------------------------------------------------------------
// checkNavigation
// ---------------------------------------------------------------------------------------------

test('checkNavigation accepts the group with its four pages, all present', () => {
  assert.deepEqual(checkNavigation(NAVIGATION, everyPageExists), []);
  assert.deepEqual(AGENT_PAGES, [
    'docs/agents/overview',
    'docs/agents/connect',
    'docs/agents/tools',
    'docs/agents/authentication',
  ]);
});

test('checkNavigation reports a page the group does not list', () => {
  const config = JSON.parse(NAVIGATION);
  config.navigation.tabs[0].groups[1].pages = AGENT_PAGES.filter((page) => page !== 'docs/agents/connect');
  assert.deepEqual(checkNavigation(JSON.stringify(config), everyPageExists), [
    'docs.json: the "AI agents (MCP)" group does not list docs/agents/connect.',
  ]);
});

test('checkNavigation treats a group with no pages as listing none of them', () => {
  const config = JSON.parse(NAVIGATION);
  delete config.navigation.tabs[0].groups[1].pages;
  assert.deepEqual(
    checkNavigation(JSON.stringify(config), everyPageExists),
    AGENT_PAGES.map((page) => `docs.json: the "AI agents (MCP)" group does not list ${page}.`),
  );
});

test('checkNavigation reports a page whose file is missing', () => {
  const pageExists = (relativePath) => relativePath !== 'docs/agents/tools.mdx';
  assert.deepEqual(checkNavigation(NAVIGATION, pageExists), [
    'docs.json: docs/agents/tools is a page of the group but docs/agents/tools.mdx does not exist.',
  ]);
});

test('checkNavigation asks the file check for the page with its .mdx extension', () => {
  const asked = [];
  checkNavigation(NAVIGATION, (relativePath) => {
    asked.push(relativePath);
    return true;
  });
  assert.deepEqual(asked, AGENT_PAGES.map((page) => `${page}.mdx`));
});

test('checkNavigation reports a missing or repeated group', () => {
  const none = JSON.parse(NAVIGATION);
  none.navigation.tabs[0].groups = [{ group: 'Getting Started', pages: [] }];
  assert.deepEqual(checkNavigation(JSON.stringify(none), everyPageExists), [
    'docs.json: expected one navigation group named "AI agents (MCP)", found 0.',
  ]);
  const twice = JSON.parse(NAVIGATION);
  twice.navigation.tabs[0].groups.push({ group: AGENT_NAVIGATION_GROUP, pages: [] });
  assert.deepEqual(checkNavigation(JSON.stringify(twice), everyPageExists), [
    'docs.json: expected one navigation group named "AI agents (MCP)", found 2.',
  ]);
});

test('checkNavigation finds the group in any tab and tolerates tabs without groups', () => {
  const config = JSON.parse(NAVIGATION);
  config.navigation.tabs.unshift({ tab: 'API Reference', openapi: 'x.json' });
  assert.deepEqual(checkNavigation(JSON.stringify(config), everyPageExists), []);
});

test('checkNavigation says so when docs.json is not JSON or has no navigation', () => {
  assert.deepEqual(checkNavigation('{not json', everyPageExists), ['docs.json: it is not valid JSON.']);
  assert.deepEqual(checkNavigation('{}', everyPageExists), [
    'docs.json: expected one navigation group named "AI agents (MCP)", found 0.',
  ]);
});

// ---------------------------------------------------------------------------------------------
// checkGatewayLinks
// ---------------------------------------------------------------------------------------------

const AUTHENTICATION_URL = 'https://docs.widgetic.com/docs/agents/authentication';
const OVERVIEW_URL = 'https://docs.widgetic.com/docs/agents/overview';

function linksFrom(overrides = {}) {
  return checkGatewayLinks({ oauthConstantsText: SCOPE_SOURCE, mcpPublicHostText: HOST_SOURCE, ...overrides });
}

test('the docs are published at docs.widgetic.com, and the fixtures use that origin', () => {
  assert.equal(DOCS_ORIGIN, 'https://docs.widgetic.com');
  assert.ok(SCOPE_SOURCE.includes(`'${AUTHENTICATION_URL}'`));
  assert.ok(HOST_SOURCE.includes(`'${OVERVIEW_URL}'`));
});

test('checkGatewayLinks finds nothing when each address opens the page it is meant to', () => {
  assert.deepEqual(linksFrom(), []);
});

const WRONG_ADDRESSES = [
  ['the path without the /docs/ segment this site is served under', (url) => url.replace('/docs/', '/')],
  ['another origin', (url) => url.replace('https://docs.widgetic.com', 'https://docs.other.example')],
  ['plain http', (url) => url.replace('https://', 'http://')],
  ['a trailing slash', (url) => `${url}/`],
  ['a fragment', (url) => `${url}#top`],
  ['the other page of the group', (url) => (url === AUTHENTICATION_URL ? OVERVIEW_URL : AUTHENTICATION_URL)],
  ['an empty address', () => ''],
];

for (const [what, wrong] of WRONG_ADDRESSES) {
  test(`checkGatewayLinks reports the authentication address when it is ${what}`, () => {
    const value = wrong(AUTHENTICATION_URL);
    assert.notEqual(value, AUTHENTICATION_URL);
    assert.deepEqual(linksFrom({ oauthConstantsText: SCOPE_SOURCE.replace(AUTHENTICATION_URL, value) }), [
      `oauthConstants.ts: MCP_AUTHENTICATION_DOCS_URL is "${value}" but the page it opens is "${AUTHENTICATION_URL}".`,
    ]);
  });

  test(`checkGatewayLinks reports the bare host's redirect when it is ${what}`, () => {
    const value = wrong(OVERVIEW_URL);
    assert.notEqual(value, OVERVIEW_URL);
    assert.deepEqual(linksFrom({ mcpPublicHostText: HOST_SOURCE.replace(OVERVIEW_URL, value) }), [
      `mcpPublicHost.ts: DEFAULT_MCP_DOCS_URL is "${value}" but the page it opens is "${OVERVIEW_URL}".`,
    ]);
  });
}

test('checkGatewayLinks reports both addresses, the authentication one first', () => {
  assert.deepEqual(
    linksFrom({
      oauthConstantsText: SCOPE_SOURCE.replace('/docs/agents/authentication', '/agents/authentication'),
      mcpPublicHostText: HOST_SOURCE.replace('/docs/agents/overview', '/overview'),
    }),
    [
      'oauthConstants.ts: MCP_AUTHENTICATION_DOCS_URL is "https://docs.widgetic.com/agents/authentication" but the page it opens is "https://docs.widgetic.com/docs/agents/authentication".',
      'mcpPublicHost.ts: DEFAULT_MCP_DOCS_URL is "https://docs.widgetic.com/overview" but the page it opens is "https://docs.widgetic.com/docs/agents/overview".',
    ]
  );
});

test('checkGatewayLinks says so when a constant is not there, instead of passing', () => {
  assert.deepEqual(linksFrom({ oauthConstantsText: 'nothing here', mcpPublicHostText: 'nothing here' }), [
    'oauthConstants.ts: MCP_AUTHENTICATION_DOCS_URL was not found, so the page it opens cannot be checked.',
    'mcpPublicHost.ts: DEFAULT_MCP_DOCS_URL was not found, so the page it opens cannot be checked.',
  ]);
});

test('checkGatewayLinks does not guess at a constant written another way', () => {
  const doubleQuoted = SCOPE_SOURCE.replace(`'${AUTHENTICATION_URL}'`, `"${AUTHENTICATION_URL}"`);
  assert.deepEqual(linksFrom({ oauthConstantsText: doubleQuoted }), [
    'oauthConstants.ts: MCP_AUTHENTICATION_DOCS_URL was not found, so the page it opens cannot be checked.',
  ]);
  const notExported = HOST_SOURCE.replace('export const', 'const');
  assert.deepEqual(linksFrom({ mcpPublicHostText: notExported }), [
    'mcpPublicHost.ts: DEFAULT_MCP_DOCS_URL was not found, so the page it opens cannot be checked.',
  ]);
});

test('checkGatewayLinks reads the string of the constant, not what a comment after it quotes', () => {
  const withComment = HOST_SOURCE.replace(`'${OVERVIEW_URL}';`, `'${OVERVIEW_URL}'; // not 'the-page';`);
  assert.notEqual(withComment, HOST_SOURCE);
  assert.deepEqual(linksFrom({ mcpPublicHostText: withComment }), []);
});

test('checkGatewayLinks does not read half of an address that is put together', () => {
  const joined = HOST_SOURCE.replace(`'${OVERVIEW_URL}';`, "'https://docs.widgetic.com' + '/docs/agents/overview';");
  assert.notEqual(joined, HOST_SOURCE);
  assert.deepEqual(linksFrom({ mcpPublicHostText: joined }), [
    'mcpPublicHost.ts: DEFAULT_MCP_DOCS_URL was not found, so the page it opens cannot be checked.',
  ]);
});

test('checkGatewayLinks reads a constant by its whole name, not as the tail of another', () => {
  const lookalike = HOST_SOURCE.replace('DEFAULT_MCP_DOCS_URL', 'LEGACY_DEFAULT_MCP_DOCS_URL');
  assert.deepEqual(linksFrom({ mcpPublicHostText: lookalike }), [
    'mcpPublicHost.ts: DEFAULT_MCP_DOCS_URL was not found, so the page it opens cannot be checked.',
  ]);
});

// ---------------------------------------------------------------------------------------------
// checkAgentDocs
// ---------------------------------------------------------------------------------------------

function checkAll(overrides = {}) {
  return checkAgentDocs({
    toolSnapshotText: snapshotText(),
    scopeSourceText: SCOPE_SOURCE,
    mcpPublicHostText: HOST_SOURCE,
    toolsPage: TOOLS_PAGE,
    authenticationPage: AUTHENTICATION_PAGE,
    navigationText: NAVIGATION,
    pageExists: everyPageExists,
    ...overrides,
  });
}

test('checkAgentDocs finds nothing when every page agrees with its source', () => {
  assert.deepEqual(checkAll(), []);
});

test('checkAgentDocs gathers the differences of every page, tools first, then permissions, then navigation', () => {
  const problems = checkAll({
    toolsPage: toolsPageWith('`widgetic.read` | 0 |', '`widgetic.read` | 1 |'),
    authenticationPage: authenticationPageWith('See your things', 'Look at things'),
    pageExists: (relativePath) => relativePath !== 'docs/agents/overview.mdx',
  });
  assert.deepEqual(problems, [
    'tools.mdx: get_thing costs 0 credits in the contract but the table says 1.',
    'authentication.mdx: widgetic.read is described as "See your things" on the consent page but the table says "Look at things".',
    'docs.json: docs/agents/overview is a page of the group but docs/agents/overview.mdx does not exist.',
  ]);
});

test('checkAgentDocs reports the links of the gateway last, from the file that holds each', () => {
  const problems = checkAll({
    toolsPage: toolsPageWith('`widgetic.read` | 0 |', '`widgetic.read` | 1 |'),
    pageExists: (relativePath) => relativePath !== 'docs/agents/overview.mdx',
    scopeSourceText: SCOPE_SOURCE.replace('/docs/agents/authentication', '/agents/authentication'),
    mcpPublicHostText: HOST_SOURCE.replace('/docs/agents/overview', '/overview'),
  });
  assert.deepEqual(problems, [
    'tools.mdx: get_thing costs 0 credits in the contract but the table says 1.',
    'docs.json: docs/agents/overview is a page of the group but docs/agents/overview.mdx does not exist.',
    'oauthConstants.ts: MCP_AUTHENTICATION_DOCS_URL is "https://docs.widgetic.com/agents/authentication" but the page it opens is "https://docs.widgetic.com/docs/agents/authentication".',
    'mcpPublicHost.ts: DEFAULT_MCP_DOCS_URL is "https://docs.widgetic.com/overview" but the page it opens is "https://docs.widgetic.com/docs/agents/overview".',
  ]);
});

test('checkAgentDocs lets an unreadable source stop the check instead of passing it', () => {
  assert.throws(() => checkAll({ toolSnapshotText: '{"tools": []}' }), /no tools/);
  assert.throws(() => checkAll({ scopeSourceText: 'nothing here' }), /MCP_SCOPE_DESCRIPTIONS was not found/);
});
