'use strict';

/**
 * Tests for the checks of the agent quick start (`scripts/lib/agentQuickstart.js`): the copyable
 * prompts of `docs/quickstart.mdx` and the skill `skill.md`.
 *
 * Run with: node --test scripts/__tests__/agentQuickstart.test.js
 *
 * Each rule is shown to fail: a check that has only ever passed proves nothing, so every kind of
 * problem the checker promises to report is introduced here on purpose and its exact message is
 * asserted. The last section runs the checks on the real files, and then breaks a copy of each to
 * show that the check on the real files can fail too.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  QUICKSTART_PAGE,
  SKILL_FILE,
  checkAddresses,
  checkMentions,
  checkPromptCopyText,
  checkPromptSafety,
  checkQuickstartPrompts,
  checkSkill,
  checkSkillBody,
  checkSkillFrontmatter,
  readCliReference,
  readPrompts,
  readSkill,
} = require('../lib/agentQuickstart');

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

/** A small CLI reference: two REST groups, two MCP tools, three flags and one variable. */
const reference = readCliReference({
  indexPage: [
    '- `widgetic api <group> <command>`: the REST API',
    '- `widgetic mcp <command>`: the MCP tools',
    '- `widgetic auth`, `widgetic doctor`, `widgetic update`, `widgetic schema`: the rest',
    'Global flags: `--json`, `--dry-run`, `--yes`',
  ].join('\n'),
  apiPages: {
    'api-widgets.mdx': '## `widgetic api widgets create-widget`\n\n## `widgetic api widgets list-widgets`\n',
    'api-credits.mdx': '## `widgetic api credits get-balance`\n',
  },
  mcpPage: [
    '### `widgetic mcp create-widget`',
    '- Tool: `create_widget`',
    '  * `--widget-id`',
    '### `widgetic mcp get-profile`',
    '- Tool: `get_profile`',
  ].join('\n'),
  handwrittenCliPages: ['Pass `--wait` to wait for a build.'],
  documentationTexts: ['Set `WIDGETIC_API_KEY` to your key.'],
});

/** A quickstart page with one prompt whose lines are `lines`, indented as in the real page. */
function pageWithPrompt(lines, description = 'Does a thing.') {
  return [
    '<Tabs>',
    '  <Tab title="MCP server">',
    `    <Prompt description="${description}" icon="plug">`,
    ...lines.map((line) => (line === '' ? '' : `      ${line}`)),
    '    </Prompt>',
    '  </Tab>',
    '</Tabs>',
  ].join('\n');
}

/** A prompt as `readPrompts` returns it, written for copying: nothing in it breaks a rule. */
const goodPrompt = {
  line: 3,
  description: 'Does a thing.',
  text: [
    'Connect the server at `https://mcp.widgetic.com`.',
    '1. Add it:',
    '   * Claude Code: run `claude mcp add --transport http widgetic https://mcp.widgetic.com`',
    'Open Settings > API Keys.',
    '```markdown',
    '## Widgetic',
    '- Run `widgetic --help` first.',
    '```',
  ].join('\n'),
};

const goodSkillFrontmatter = {
  name: 'widgetic',
  description: 'Build widgets. Use when the user wants a widget.',
  compatibility: 'Needs network access.',
  metadata: { 'mintlify-proj': 'widgetic', version: '1.0' },
};

const PROMPT_WHERE = `The prompt at line ${goodPrompt.line} of ${QUICKSTART_PAGE}`;

// ---------------------------------------------------------------------------------------------
// Reading the prompts
// ---------------------------------------------------------------------------------------------

test('readPrompts: reads the line, the description and the text the button copies', () => {
  const page = pageWithPrompt(['Connect it.', '1. Run `widgetic doctor`.', '', 'Done.'], 'Connects it.');
  assert.deepEqual(readPrompts(page), [
    { line: 3, description: 'Connects it.', text: 'Connect it.\n1. Run `widgetic doctor`.\n\nDone.' },
  ]);
});

test('readPrompts: an opening tag over several lines, with ">" in an attribute and braces', () => {
  const page = [
    '<Prompt',
    '  description="Runs a > b and `x`."',
    '  icon="terminal"',
    '  actions={["copy", "cursor"]}',
    '>',
    '  Do it.',
    '</Prompt>',
  ].join('\n');
  assert.deepEqual(readPrompts(page), [{ line: 1, description: 'Runs a > b and `x`.', text: 'Do it.' }]);
});

test('readPrompts: every prompt of a page, in order, and none on a page without one', () => {
  const page = `${pageWithPrompt(['First.'])}\n\nText between.\n\n${pageWithPrompt(['Second.'])}`;
  assert.deepEqual(readPrompts(page).map((prompt) => prompt.text), ['First.', 'Second.']);
  assert.deepEqual(readPrompts('# A page\n\nNo prompt here.'), []);
});

test('readPrompts: a fenced block keeps its own indentation and its fences', () => {
  const page = pageWithPrompt(['Add this:', '```markdown', '## Widgetic', '  - indented', '```']);
  assert.equal(readPrompts(page)[0].text, 'Add this:\n```markdown\n## Widgetic\n  - indented\n```');
});

test('readPrompts: a prompt that is not closed is reported with its line', () => {
  assert.throws(() => readPrompts('Intro.\n<Prompt description="x">\nDo it.'), {
    message: 'The <Prompt> at line 2 is not closed.',
  });
  assert.throws(() => readPrompts('<Prompt description="x"'), { message: 'The <Prompt> at line 1 is not closed.' });
});

// ---------------------------------------------------------------------------------------------
// What a prompt becomes when it is copied
// ---------------------------------------------------------------------------------------------

test('checkPromptCopyText: a prompt written for copying has no problem', () => {
  assert.deepEqual(checkPromptCopyText(goodPrompt), []);
});

test('checkPromptCopyText: an address outside a code span (Mintlify copies it as a link)', () => {
  const prompt = { ...goodPrompt, text: 'Go to https://mcp.widgetic.com now.' };
  assert.deepEqual(checkPromptCopyText(prompt), [
    `${PROMPT_WHERE} has an address outside a code span: Mintlify copies it as a Markdown link. Put it in a code span.`,
  ]);
});

test('checkPromptCopyText: a "-" or "+" bullet (Mintlify copies bullets with "*")', () => {
  const message = `${PROMPT_WHERE} has a "-" or "+" bullet: Mintlify copies bullets with "*", so write "*" and the copy is the text of the page.`;
  assert.deepEqual(checkPromptCopyText({ ...goodPrompt, text: '- first\n- second' }), [message]);
  assert.deepEqual(checkPromptCopyText({ ...goodPrompt, text: '1. Step\n   + nested' }), [message]);
});

test('checkPromptCopyText: "<" and braces outside a code span are MDX, not text', () => {
  const message = `${PROMPT_WHERE} has a "<" or a brace outside a code span, which MDX reads as code.`;
  assert.deepEqual(checkPromptCopyText({ ...goodPrompt, text: 'Use <group> as the name.' }), [message]);
  assert.deepEqual(checkPromptCopyText({ ...goodPrompt, text: 'Set {value} first.' }), [message]);
});

test('checkPromptCopyText: bullets, addresses, "<" and braces inside code are text', () => {
  const text = [
    'Run `widgetic api <group> <command>` and keep `{"a": 1}` as it is.',
    '```json',
    '{ "url": "https://mcp.widgetic.com" }',
    '- not a bullet in a fence',
    '```',
  ].join('\n');
  assert.deepEqual(checkPromptCopyText({ ...goodPrompt, text }), []);
});

test('checkPromptCopyText: no description and no text', () => {
  assert.deepEqual(checkPromptCopyText({ line: 3, description: ' ', text: '' }), [
    `${PROMPT_WHERE} has no description (it is what the card shows).`,
    `${PROMPT_WHERE} has no text to copy.`,
  ]);
});

// ---------------------------------------------------------------------------------------------
// The promises about a key
// ---------------------------------------------------------------------------------------------

test('checkPromptSafety: the promises are there', () => {
  const prompts = [
    { line: 1, text: 'The server signs in in the browser, so do not ask me for an API key.' },
    { line: 5, text: 'Never ask me to paste the key into the chat. Keep a draft, then publish.' },
  ];
  assert.deepEqual(checkPromptSafety(prompts), []);
});

test('checkPromptSafety: a missing promise is reported, and so is publishing with no draft', () => {
  assert.deepEqual(checkPromptSafety([{ line: 9, text: 'Do something.' }]), [
    `${QUICKSTART_PAGE}: no prompt tells the agent not to ask for an API key (the MCP server signs in in the browser).`,
    `${QUICKSTART_PAGE}: no prompt tells the agent never to take the API key in the chat, in an argument or in a file.`,
  ]);
  const withPublish = [
    { line: 1, text: 'Do not ask me for an API key.' },
    { line: 5, text: 'Never ask me to paste the key into the chat.' },
    { line: 9, text: 'Publish the widget at once.' },
  ];
  assert.deepEqual(checkPromptSafety(withPublish), [
    `The prompt at line 9 of ${QUICKSTART_PAGE} mentions publishing and never says "draft".`,
  ]);
});

// ---------------------------------------------------------------------------------------------
// What the reference says exists
// ---------------------------------------------------------------------------------------------

test('readCliReference: reads the commands, the tools, the flags and the variables', () => {
  assert.deepEqual([...reference.topLevel], ['api', 'mcp', 'auth', 'doctor', 'update', 'schema']);
  assert.deepEqual([...reference.groups.keys()], ['widgets', 'credits']);
  assert.deepEqual([...reference.groups.get('widgets')], ['create-widget', 'list-widgets']);
  assert.deepEqual([...reference.mcpCommands], ['create-widget', 'get-profile']);
  assert.deepEqual([...reference.mcpTools], ['create_widget', 'get_profile']);
  // `--help` and `--version` are always there; `--wait` comes from the handwritten page.
  assert.deepEqual([...reference.flags].sort(), ['--dry-run', '--help', '--json', '--version', '--wait', '--widget-id', '--yes']);
  assert.deepEqual([...reference.environmentVariables], ['WIDGETIC_API_KEY']);
});

// ---------------------------------------------------------------------------------------------
// What a text mentions
// ---------------------------------------------------------------------------------------------

test('checkMentions: commands, flags, variables and tools the reference has are accepted', () => {
  const text = [
    'Run `widgetic doctor`, then `widgetic auth login` and `widgetic --help`.',
    'Use `widgetic api widgets create-widget --json --dry-run` or `widgetic mcp create-widget --wait`.',
    'Read `widgetic schema api GROUP COMMAND` and `widgetic schema mcp COMMAND` first.',
    'The forms are `widgetic api <group> <command>`, `widgetic api call` and `widgetic mcp call`.',
    'Call `get_profile`, then `create_widget` with a `widget_id`. Pass `--yes`. Set `WIDGETIC_API_KEY`.',
    'Another program keeps its own flags: `claude mcp add --transport http widgetic https://mcp.widgetic.com`.',
    '```sh',
    'widgetic mcp get-profile --json',
    '```',
  ].join('\n');
  assert.deepEqual(checkMentions(text, reference, 'A text'), []);
});

test('checkMentions: a command that is not one', () => {
  assert.deepEqual(checkMentions('Run `widgetic frobnicate`.', reference, 'A text'), [
    'A text: "widgetic frobnicate" is not a command of the CLI (in `widgetic frobnicate`).',
  ]);
  assert.deepEqual(checkMentions('Run `widgetic api gizmos list`.', reference, 'A text'), [
    'A text: "widgetic api gizmos" is not a group of the CLI (in `widgetic api gizmos list`).',
  ]);
  assert.deepEqual(checkMentions('Run `widgetic api widgets explode --json`.', reference, 'A text'), [
    'A text: "widgetic api widgets explode" is not a command of the CLI (in `widgetic api widgets explode --json`).',
  ]);
  assert.deepEqual(checkMentions('Run `widgetic mcp explode`.', reference, 'A text'), [
    'A text: "widgetic mcp explode" is not a command of the CLI (in `widgetic mcp explode`).',
  ]);
  assert.deepEqual(checkMentions('Run `widgetic auth explode`.', reference, 'A text'), [
    'A text: "widgetic auth explode" is not a command of the CLI (in `widgetic auth explode`).',
  ]);
  assert.deepEqual(checkMentions('Run `widgetic schema explode`.', reference, 'A text'), [
    'A text: "widgetic schema explode" is not a command of the CLI (in `widgetic schema explode`).',
  ]);
  assert.deepEqual(checkMentions('Run `widgetic schema mcp explode`.', reference, 'A text'), [
    'A text: "widgetic mcp explode" is not a command of the CLI (in `widgetic schema mcp explode`).',
  ]);
});

test('checkMentions: a command in a fenced block, and one in a note inside a fenced block', () => {
  const text = ['```sh', 'widgetic frobnicate --now', '```', '```markdown', '- Run `widgetic gadget` first.', '```'].join('\n');
  assert.deepEqual(checkMentions(text, reference, 'A text'), [
    'A text: "widgetic frobnicate" is not a command of the CLI (in `widgetic frobnicate --now`).',
    'A text: --now is not a flag of the CLI (in `widgetic frobnicate --now`).',
    'A text: "widgetic gadget" is not a command of the CLI (in `widgetic gadget`).',
  ]);
});

test('checkMentions: a flag that is not one, in a command and on its own', () => {
  assert.deepEqual(checkMentions('Run `widgetic doctor --frobnicate`.', reference, 'A text'), [
    'A text: --frobnicate is not a flag of the CLI (in `widgetic doctor --frobnicate`).',
  ]);
  assert.deepEqual(checkMentions('Add `--frobnicate` to the command.', reference, 'A text'), [
    'A text: --frobnicate is not a flag of the CLI.',
  ]);
  assert.deepEqual(checkMentions('Add `--frobnicate somevalue` to it.', reference, 'A text'), [
    'A text: --frobnicate is not a flag of the CLI.',
  ]);
});

test('checkMentions: a variable the documentation does not name, and a tool that does not exist', () => {
  assert.deepEqual(checkMentions('Set `WIDGETIC_NOPE` first.', reference, 'A text'), [
    'A text: WIDGETIC_NOPE is not an environment variable the documentation names.',
  ]);
  assert.deepEqual(checkMentions('Call `explode_widget` now.', reference, 'A text'), [
    'A text: `explode_widget` is neither an MCP tool nor an argument of one.',
  ]);
});

// ---------------------------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------------------------

test('checkAddresses: the places an agent may be sent to', () => {
  const text = 'Use `https://mcp.widgetic.com`, https://api.widgetic.com/v1. And (https://app.widgetic.com), too.';
  assert.deepEqual(checkAddresses(text, 'A text'), []);
});

test('checkAddresses: another place, the address of the documentation site, and a key', () => {
  assert.deepEqual(checkAddresses('See https://example.com/page for more.', 'A text'), [
    'A text: https://example.com/page is not an address an agent may be sent to (mcp.widgetic.com, api.widgetic.com, app.widgetic.com).',
  ]);
  assert.deepEqual(checkAddresses('Read the pages at docs.widgetic.com first.', 'A text'), [
    'A text: names the address of the documentation site, which is not decided yet: say "the documentation site".',
  ]);
  assert.deepEqual(checkAddresses('Read https://widgetic.mintlify.app/docs/quickstart first.', 'A text'), [
    'A text: https://widgetic.mintlify.app/docs/quickstart is not an address an agent may be sent to (mcp.widgetic.com, api.widgetic.com, app.widgetic.com).',
    'A text: names the address of the documentation site, which is not decided yet: say "the documentation site".',
  ]);
  assert.deepEqual(checkAddresses('The key is wgt_usr_abcdefgh12345678.', 'A text'), [
    'A text: has something that looks like a real API key.',
  ]);
  // The prefix that names a kind of key is not a key.
  assert.deepEqual(checkAddresses('Keys start with `wgt_usr_` or `wdg_org_`.', 'A text'), []);
});

// ---------------------------------------------------------------------------------------------
// The skill
// ---------------------------------------------------------------------------------------------

test('readSkill: reads the fields, the map and the quoted values', () => {
  const text = [
    '---',
    'name: widgetic',
    'description: Build widgets.',
    'compatibility: Needs network access.',
    'metadata:',
    '  mintlify-proj: widgetic',
    '  version: "1.0"',
    '---',
    '',
    '# Widgetic',
  ].join('\n');
  assert.deepEqual(readSkill(text), {
    frontmatter: {
      name: 'widgetic',
      description: 'Build widgets.',
      compatibility: 'Needs network access.',
      metadata: { 'mintlify-proj': 'widgetic', version: '1.0' },
    },
    body: '\n# Widgetic',
  });
});

test('readSkill: refuses what is not frontmatter, a list in it, and a plain value that YAML would refuse', () => {
  assert.throws(() => readSkill('# Widgetic'), {
    message: `${SKILL_FILE} must start with YAML frontmatter between two "---" lines.`,
  });
  assert.throws(() => readSkill('---\nname: widgetic\n- item\n---\nBody'), {
    message: `${SKILL_FILE}, line 3: the frontmatter is not a plain "key: value" list: - item`,
  });
  assert.throws(() => readSkill('---\nname: widgetic\ndescription: Use it: now\n---\nBody'), {
    message: `${SKILL_FILE}: the frontmatter value "Use it: now..." holds ": " or " #", which YAML reads as syntax: put the value in quotes.`,
  });
  // The same value in quotes is fine.
  assert.equal(readSkill('---\nname: widgetic\ndescription: "Use it: now"\n---\nBody').frontmatter.description, 'Use it: now');
});

test('checkSkill: reports a refused skill as a problem, not as an exception', () => {
  assert.deepEqual(checkSkill('# Widgetic', reference), [
    `${SKILL_FILE} must start with YAML frontmatter between two "---" lines.`,
  ]);
});

test('checkSkillFrontmatter: the fields of the skill pass', () => {
  assert.deepEqual(checkSkillFrontmatter(goodSkillFrontmatter), []);
  assert.deepEqual(checkSkillFrontmatter({ name: 'widgetic', description: 'x'.repeat(1024) }), []);
  assert.deepEqual(checkSkillFrontmatter({ ...goodSkillFrontmatter, compatibility: 'x'.repeat(500) }), []);
});

test('checkSkillFrontmatter: a missing name and description, and a field the specification has not', () => {
  assert.deepEqual(checkSkillFrontmatter({}), [`${SKILL_FILE}: "name" is missing.`, `${SKILL_FILE}: "description" is missing.`]);
  assert.deepEqual(checkSkillFrontmatter({ ...goodSkillFrontmatter, version: '1' }), [
    `${SKILL_FILE}: "version" is not a field of the specification (name, description, license, compatibility, metadata, allowed-tools).`,
  ]);
  assert.deepEqual(checkSkillFrontmatter({ ...goodSkillFrontmatter, description: '   ' }), [`${SKILL_FILE}: "description" is missing.`]);
});

test('checkSkillFrontmatter: a name the specification refuses, and one that is not this skill', () => {
  for (const name of ['Widgetic', '-widgetic', 'widgetic-', 'wid--getic', 'wid getic', 'a'.repeat(65)]) {
    assert.deepEqual(checkSkillFrontmatter({ ...goodSkillFrontmatter, name }), [
      `${SKILL_FILE}: the name "${name}" must be at most 64 characters of lowercase letters, numbers and single hyphens, with no hyphen at either end.`,
    ]);
  }
  assert.deepEqual(checkSkillFrontmatter({ ...goodSkillFrontmatter, name: 'other-skill' }), [
    `${SKILL_FILE}: the name is "other-skill", and the skill of this site is "widgetic".`,
  ]);
});

test('checkSkillFrontmatter: a description, a compatibility and a metadata that are too much or not enough', () => {
  assert.deepEqual(checkSkillFrontmatter({ ...goodSkillFrontmatter, description: 'x'.repeat(1025) }), [
    `${SKILL_FILE}: "description" is 1025 characters; the most is 1024.`,
  ]);
  const compatibilityMessage = `${SKILL_FILE}: "compatibility" must be 1 to 500 characters.`;
  assert.deepEqual(checkSkillFrontmatter({ ...goodSkillFrontmatter, compatibility: 'x'.repeat(501) }), [compatibilityMessage]);
  assert.deepEqual(checkSkillFrontmatter({ ...goodSkillFrontmatter, compatibility: ' ' }), [compatibilityMessage]);
  const metadataMessage = `${SKILL_FILE}: "metadata" must be a map of keys to text.`;
  assert.deepEqual(checkSkillFrontmatter({ ...goodSkillFrontmatter, metadata: {} }), [metadataMessage]);
  assert.deepEqual(checkSkillFrontmatter({ ...goodSkillFrontmatter, metadata: 'text' }), [metadataMessage]);
});

test('checkSkillBody: under 500 lines passes, 500 is too many', () => {
  assert.deepEqual(checkSkillBody(`${'A line.\n'.repeat(499)}`, reference), []);
  assert.deepEqual(checkSkillBody(`${'A line.\n'.repeat(500)}`, reference), [
    `${SKILL_FILE}: the body is 500 lines; the specification asks for fewer than 500.`,
  ]);
});

test('checkSkillBody: a command, a flag and an address that are wrong are found in the body', () => {
  const body = ['# Widgetic', 'Run `widgetic frobnicate`.', 'Read https://example.com/guide.'].join('\n');
  assert.deepEqual(checkSkillBody(body, reference), [
    `${SKILL_FILE}: "widgetic frobnicate" is not a command of the CLI (in \`widgetic frobnicate\`).`,
    `${SKILL_FILE}: https://example.com/guide is not an address an agent may be sent to (mcp.widgetic.com, api.widgetic.com, app.widgetic.com).`,
  ]);
});

// ---------------------------------------------------------------------------------------------
// The prompts of a page, all rules together
// ---------------------------------------------------------------------------------------------

test('checkQuickstartPrompts: a page without a prompt is a problem', () => {
  assert.deepEqual(checkQuickstartPrompts('# Quickstart\n\nNo prompt here.', reference), [`${QUICKSTART_PAGE} has no <Prompt>.`]);
});

test('checkQuickstartPrompts: a command named only in the description of a prompt is checked too', () => {
  const page = pageWithPrompt(
    ['Do not ask me for an API key.', 'Never ask me to paste the key into the chat.'],
    'Runs `widgetic frobnicate` for you.',
  );
  assert.deepEqual(checkQuickstartPrompts(page, reference), [
    `The description of the prompt at line 3 of ${QUICKSTART_PAGE}: "widgetic frobnicate" is not a command of the CLI (in \`widgetic frobnicate\`).`,
  ]);
});

test('checkQuickstartPrompts: a page whose prompts keep every rule has no problem', () => {
  const page = pageWithPrompt(
    ['Do not ask me for an API key.', 'Never ask me to paste the key into the chat.', 'Run `widgetic doctor --json`.'],
    'Checks the setup with `widgetic doctor`.',
  );
  assert.deepEqual(checkQuickstartPrompts(page, reference), []);
});

// ---------------------------------------------------------------------------------------------
// The real files
// ---------------------------------------------------------------------------------------------

const repositoryRoot = path.resolve(__dirname, '..', '..');

/** A file of the repository, as text. */
function readRepositoryFile(relativePath) {
  return fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

/** The text of every `.md` and `.mdx` file under a folder of the repository. */
function readAllPages(relativeFolder) {
  const texts = [];
  const visit = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const entryPath = path.join(folder, entry.name);
      if (entry.isDirectory()) visit(entryPath);
      else if (/\.mdx?$/.test(entry.name)) texts.push(fs.readFileSync(entryPath, 'utf8'));
    }
  };
  visit(path.join(repositoryRoot, relativeFolder));
  return texts;
}

/** The reference of the real CLI pages. */
function readRealReference() {
  const commandsFolder = 'docs/cli/commands';
  const apiPages = {};
  for (const fileName of fs.readdirSync(path.join(repositoryRoot, commandsFolder))) {
    if (/^api-.+\.mdx$/.test(fileName)) apiPages[fileName] = readRepositoryFile(`${commandsFolder}/${fileName}`);
  }
  return readCliReference({
    indexPage: readRepositoryFile(`${commandsFolder}/index.mdx`),
    apiPages,
    mcpPage: readRepositoryFile(`${commandsFolder}/mcp.mdx`),
    handwrittenCliPages: [readRepositoryFile('docs/cli/getting-started.mdx')],
    documentationTexts: readAllPages('docs'),
  });
}

test('the real reference is read whole (so the checks below are not checking against nothing)', () => {
  const realReference = readRealReference();
  assert.ok(realReference.groups.size >= 10, `groups: ${realReference.groups.size}`);
  assert.ok(realReference.mcpTools.size >= 40, `MCP tools: ${realReference.mcpTools.size}`);
  assert.ok(realReference.mcpCommands.size >= 40, `MCP commands: ${realReference.mcpCommands.size}`);
  assert.ok(realReference.flags.has('--wait') && realReference.flags.has('--json'));
  assert.ok(realReference.environmentVariables.has('WIDGETIC_API_KEY'));
});

test('the real quickstart: three prompts, and every rule holds', () => {
  const quickstart = readRepositoryFile(QUICKSTART_PAGE);
  assert.equal(readPrompts(quickstart).length, 3);
  assert.deepEqual(checkQuickstartPrompts(quickstart, readRealReference()), []);
});

test('the real skill: every rule of the specification and of the reference holds', () => {
  const skillText = readRepositoryFile(SKILL_FILE);
  assert.equal(readSkill(skillText).frontmatter.name, 'widgetic');
  assert.deepEqual(checkSkill(skillText, readRealReference()), []);
});

test('the checks on the real files can fail: a command mistyped in a prompt', () => {
  const quickstart = readRepositoryFile(QUICKSTART_PAGE).replace(/widgetic doctor/g, 'widgetic doctr');
  const problems = checkQuickstartPrompts(quickstart, readRealReference());
  assert.ok(problems.length > 0);
  assert.ok(problems.some((problem) => problem.includes('"widgetic doctr" is not a command of the CLI')), problems.join('\n'));
});

test('the checks on the real files can fail: an address standing alone in a prompt', () => {
  const quickstart = readRepositoryFile(QUICKSTART_PAGE).replace('`https://mcp.widgetic.com`', 'https://mcp.widgetic.com');
  const problems = checkQuickstartPrompts(quickstart, readRealReference());
  assert.ok(problems.some((problem) => problem.includes('has an address outside a code span')), problems.join('\n'));
});

test('the checks on the real files can fail: a skill with a name the specification refuses', () => {
  const skillText = readRepositoryFile(SKILL_FILE).replace(/^name: widgetic$/m, 'name: Widgetic');
  const problems = checkSkill(skillText, readRealReference());
  assert.ok(problems.some((problem) => problem.includes('the name "Widgetic" must be at most 64 characters')), problems.join('\n'));
});

test('the checks on the real files can fail: a flag that the reference does not have, in the skill', () => {
  const skillText = `${readRepositoryFile(SKILL_FILE)}\nRun \`widgetic doctor --frobnicate\` to see.\n`;
  const problems = checkSkill(skillText, readRealReference());
  assert.ok(problems.some((problem) => problem.includes('--frobnicate is not a flag of the CLI')), problems.join('\n'));
});
