'use strict';

/**
 * Checks for the files that teach an AI agent to use Widgetic: the copyable prompts of the quickstart
 * (`docs/quickstart.mdx`) and the skill (`skill.md` at the root of the project).
 *
 * Both are text a person pastes into an agent, or an agent loads on its own, and then acts on: a
 * command that does not exist, a flag that was renamed or an address that moved fails on somebody's
 * machine and not in a build. So every command, flag, environment variable, tool name and address
 * they mention is looked up in this site's own reference (`docs/cli/commands`, copied from the CLI at
 * each release, and the rest of `docs`), and the skill is held to the Agent Skills specification.
 *
 * It is pure: it takes the contents of the files and returns a list of problems as sentences, so each
 * rule can be tested on its own. `scripts/__tests__/agentQuickstart.test.js` reads the real files.
 *
 * Specification of a skill: https://agentskills.io/specification
 */

/** The page that holds the prompts, and the file that is the skill. */
const QUICKSTART_PAGE = 'docs/quickstart.mdx';
const SKILL_FILE = 'skill.md';

/** The fields a skill may have (the specification's). A new one is a decision, so it is reported. */
const SKILL_FIELDS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'];
const SKILL_NAME_MAX = 64;
const SKILL_DESCRIPTION_MAX = 1024;
const SKILL_COMPATIBILITY_MAX = 500;
/** The specification asks for a body that fits an agent's context: under 500 lines (so 500 is too many). */
const SKILL_BODY_MAX_LINES = 500;

/**
 * Lowercase letters, numbers and single hyphens, none at either end (the specification's rule for a
 * skill name).
 */
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The places an agent may be sent to. The documentation site is not one of them: its address is
 * still to be decided (the new site is on a Mintlify address and the old one on docs.widgetic.com),
 * so a skill or a prompt that named it would be wrong in one of the two places.
 */
const ALLOWED_HOSTS = new Set(['mcp.widgetic.com', 'api.widgetic.com', 'app.widgetic.com']);
const DOCS_SITE_ADDRESS = /docs\.widgetic\.com|widgetic\.com\/docs|mintlify\.app/i;

/** A real key, not the prefix that names a kind of key: the prefix, then at least 8 characters. */
const KEY_LOOKING = /\b(?:wgt_(?:usr|prt|adm|eds)|wdg_org)_[A-Za-z0-9]{8,}/;

/** The commands of the CLI that are not groups of the REST API or tools of the MCP server. */
const AUTH_COMMANDS = new Set(['login', 'logout', 'status']);

// ---------------------------------------------------------------------------------------------
// Reading the prompts
// ---------------------------------------------------------------------------------------------

/**
 * Removes the indentation every non-empty line has in common, as Mintlify does with the text of a
 * `<Prompt>` before it is copied.
 */
function dedent(text) {
  const lines = text.split('\n');
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => /^(\s*)/.exec(line)[1].length);
  const smallest = indents.length > 0 ? Math.min(...indents) : 0;
  return smallest === 0 ? text : lines.map((line) => line.slice(smallest)).join('\n');
}

/**
 * The index just after the `>` that closes an opening tag that starts at `start`, or -1. A `>` inside
 * a quoted attribute or inside braces does not close it.
 */
function findOpeningTagEnd(text, start) {
  let quote = null;
  let braceDepth = 0;
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (quote !== null) {
      if (character === quote && text[index - 1] !== '\\') quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') quote = character;
    else if (character === '{') braceDepth += 1;
    else if (character === '}') braceDepth -= 1;
    else if (character === '>' && braceDepth === 0) return index + 1;
  }
  return -1;
}

/**
 * Every `<Prompt>` of an MDX page: where it starts, the `description` the card shows and the text
 * the button copies (the text between the tags, without the indentation of the page).
 */
function readPrompts(mdxText) {
  const prompts = [];
  const openingTag = /<Prompt\b/g;
  let match;
  while ((match = openingTag.exec(mdxText)) !== null) {
    const line = mdxText.slice(0, match.index).split('\n').length;
    const tagEnd = findOpeningTagEnd(mdxText, match.index);
    const closeIndex = tagEnd === -1 ? -1 : mdxText.indexOf('</Prompt>', tagEnd);
    if (closeIndex === -1) throw new Error(`The <Prompt> at line ${line} is not closed.`);
    const description = /\bdescription="([^"]*)"/.exec(mdxText.slice(match.index, tagEnd));
    const text = dedent(mdxText.slice(tagEnd, closeIndex).replace(/^\n/, '').replace(/\n[ \t]*$/, ''));
    prompts.push({ line, description: description ? description[1] : '', text });
    openingTag.lastIndex = closeIndex;
  }
  return prompts;
}

// ---------------------------------------------------------------------------------------------
// Reading code in a text
// ---------------------------------------------------------------------------------------------

/** The text with its fenced blocks taken out. */
function withoutFences(text) {
  return text.replace(/^[ \t]*```[^\n]*\n[\s\S]*?^[ \t]*```[ \t]*$/gm, '');
}

/** The text with its fenced blocks and its code spans taken out: where MDX reads `<` and `{`. */
function outsideCode(text) {
  return withoutFences(text).replace(/`[^`\n]*`/g, '');
}

/**
 * Every piece of code in a text: each code span, each non-empty line of a fenced block (a shell
 * command is a line), and the code spans inside a fenced block (a note to paste into AGENTS.md is
 * Markdown, with commands in it).
 */
function codeSpans(text) {
  const spans = [];
  for (const block of text.matchAll(/^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```[ \t]*$/gm)) {
    for (const line of block[1].split('\n')) {
      if (line.trim() !== '') spans.push(line.trim());
    }
    for (const span of block[1].matchAll(/`([^`\n]+)`/g)) spans.push(span[1].trim());
  }
  for (const span of withoutFences(text).matchAll(/`([^`\n]+)`/g)) spans.push(span[1].trim());
  return spans;
}

// ---------------------------------------------------------------------------------------------
// What the CLI reference says exists
// ---------------------------------------------------------------------------------------------

/**
 * What the pages of the CLI reference say exists: the first words of a command, the groups of the
 * REST API with their commands, the MCP commands and tools, every flag, and every environment
 * variable the documentation names.
 *
 * `apiPages` maps a file name (`api-widgets.mdx`) to its text. `handwrittenCliPages` is the text of
 * the pages about the CLI that are written by hand (`docs/cli/getting-started.mdx`): they say
 * things the generated pages do not yet, such as `--wait`, so their flags count. `documentationTexts`
 * is the text of every page, for the environment variables.
 */
function readCliReference({ indexPage, apiPages, mcpPage, handwrittenCliPages, documentationTexts }) {
  const topLevel = new Set();
  for (const match of indexPage.matchAll(/`widgetic ([a-z][a-z-]*)[ `]/g)) topLevel.add(match[1]);

  const groups = new Map();
  for (const [fileName, text] of Object.entries(apiPages)) {
    const group = /^api-(.+)\.mdx$/.exec(fileName);
    if (!group) continue;
    const commands = new Set();
    for (const heading of text.matchAll(/^## `widgetic api [a-z0-9-]+ ([a-z0-9-]+)`/gm)) commands.add(heading[1]);
    groups.set(group[1], commands);
  }

  const mcpCommands = new Set();
  for (const heading of mcpPage.matchAll(/^### `widgetic mcp ([a-z0-9-]+)`/gm)) mcpCommands.add(heading[1]);
  const mcpTools = new Set();
  for (const tool of mcpPage.matchAll(/^- Tool: `([a-z_]+)`/gm)) mcpTools.add(tool[1]);

  const flags = new Set(['--help', '--version']);
  for (const text of [indexPage, mcpPage, ...Object.values(apiPages), ...handwrittenCliPages]) {
    for (const flag of text.matchAll(/--[a-z][a-z0-9-]*/g)) flags.add(flag[0]);
  }

  const environmentVariables = new Set();
  for (const text of [indexPage, mcpPage, ...Object.values(apiPages), ...documentationTexts]) {
    for (const name of text.matchAll(/\bWIDGETIC_[A-Z][A-Z_]*/g)) environmentVariables.add(name[0]);
  }

  return { topLevel, groups, mcpCommands, mcpTools, flags, environmentVariables };
}

// ---------------------------------------------------------------------------------------------
// Checking what a text mentions
// ---------------------------------------------------------------------------------------------

/**
 * The lowercase words that follow `widgetic` in a piece of code, up to four (the longest command is
 * `widgetic schema api GROUP COMMAND`), stopping at the first thing that is not one: a flag, a
 * placeholder such as `<group>` or `GROUP`, a quoted value.
 */
function commandWords(span) {
  const words = [];
  for (const token of span.split(/\s+/).slice(1)) {
    if (!/^[a-z][a-z0-9-]*$/.test(token) || words.length === 4) break;
    words.push(token);
  }
  return words;
}

/** The problem with the words of one command (`api widgets create-widget`), or null. */
function commandProblem(words, reference) {
  const [first, second, third] = words;
  if (first === undefined) return null;
  if (!reference.topLevel.has(first)) return `"widgetic ${first}" is not a command of the CLI`;
  if (first === 'schema') {
    if (second === undefined) return null;
    if (second !== 'api' && second !== 'mcp') return `"widgetic schema ${second}" is not a command of the CLI`;
    // `widgetic schema api widgets create-widget` describes `widgetic api widgets create-widget`.
    return commandProblem(words.slice(1), reference);
  }
  if (first === 'auth') {
    return second === undefined || AUTH_COMMANDS.has(second) ? null : `"widgetic auth ${second}" is not a command of the CLI`;
  }
  if (first === 'mcp') {
    if (second === undefined || second === 'call' || reference.mcpCommands.has(second)) return null;
    return `"widgetic mcp ${second}" is not a command of the CLI`;
  }
  if (first === 'api') {
    if (second === undefined || second === 'call') return null;
    if (!reference.groups.has(second)) return `"widgetic api ${second}" is not a group of the CLI`;
    if (third !== undefined && !reference.groups.get(second).has(third)) {
      return `"widgetic api ${second} ${third}" is not a command of the CLI`;
    }
  }
  return null;
}

/**
 * Everything a text names that the reference does not know: the commands and flags of `widgetic`, the
 * environment variables, and the MCP tools (a `snake_case` word in a code span of its own is a tool
 * or the name of a flag of one: `get_profile`, `widget_id`).
 *
 * A flag is only checked where it is `widgetic`'s: in a command that starts with `widgetic`, or alone
 * in a code span. The flags of another program (`claude mcp add --transport`) are not ours to check.
 */
function checkMentions(text, reference, where) {
  const problems = [];
  const flagNames = new Set([...reference.flags].map((flag) => flag.slice(2).replace(/-/g, '_')));

  for (const span of codeSpans(text)) {
    if (/^widgetic(?:\s|$)/.test(span)) {
      const problem = commandProblem(commandWords(span), reference);
      if (problem) problems.push(`${where}: ${problem} (in \`${span}\`).`);
      for (const flag of span.matchAll(/(?:^|\s)(--[a-z][a-z0-9-]*)/g)) {
        if (!reference.flags.has(flag[1])) problems.push(`${where}: ${flag[1]} is not a flag of the CLI (in \`${span}\`).`);
      }
    } else if (/^--[a-z][a-z0-9-]*(?:\s|$)/.test(span)) {
      const flag = /^--[a-z][a-z0-9-]*/.exec(span)[0];
      if (!reference.flags.has(flag)) problems.push(`${where}: ${flag} is not a flag of the CLI.`);
    } else if (/^[a-z]+(?:_[a-z]+)+$/.test(span)) {
      if (!reference.mcpTools.has(span) && !flagNames.has(span)) {
        problems.push(`${where}: \`${span}\` is neither an MCP tool nor an argument of one.`);
      }
    }
  }

  for (const name of new Set(text.match(/\bWIDGETIC_[A-Z][A-Z_]*/g) || [])) {
    if (!reference.environmentVariables.has(name)) problems.push(`${where}: ${name} is not an environment variable the documentation names.`);
  }
  return problems;
}

/** Every address in a text must be one of the places an agent may be sent to. */
function checkAddresses(text, where) {
  const problems = [];
  for (const found of text.match(/https?:\/\/[^\s)`'"<>\]]+/g) || []) {
    // A full stop or a comma after an address in a sentence is not part of it.
    const address = found.replace(/[.,;:]+$/, '');
    const host = new URL(address).hostname;
    if (!ALLOWED_HOSTS.has(host)) problems.push(`${where}: ${address} is not an address an agent may be sent to (${[...ALLOWED_HOSTS].join(', ')}).`);
  }
  if (DOCS_SITE_ADDRESS.test(text)) {
    problems.push(`${where}: names the address of the documentation site, which is not decided yet: say "the documentation site".`);
  }
  if (KEY_LOOKING.test(text)) problems.push(`${where}: has something that looks like a real API key.`);
  return problems;
}

// ---------------------------------------------------------------------------------------------
// The prompts
// ---------------------------------------------------------------------------------------------

/**
 * What a prompt becomes when it is copied.
 *
 * Mintlify copies the text of the `<Prompt>` after it has read it as Markdown and written it again
 * (checked on 16 Nov 2026 with mintlify 4.2.955, by clicking "Copy prompt"): an address standing
 * alone becomes `[address](address)`, and a `-` bullet becomes `*`. A prompt is written so that
 * what is copied is what the page says: addresses in code spans and `*` bullets. A `<` or a `{`
 * outside code is MDX, not text.
 */
function checkPromptCopyText(prompt) {
  const where = `The prompt at line ${prompt.line} of ${QUICKSTART_PAGE}`;
  const problems = [];
  if (prompt.description.trim() === '') problems.push(`${where} has no description (it is what the card shows).`);
  if (prompt.text.trim() === '') problems.push(`${where} has no text to copy.`);
  if (/https?:\/\//.test(outsideCode(prompt.text))) {
    problems.push(`${where} has an address outside a code span: Mintlify copies it as a Markdown link. Put it in a code span.`);
  }
  if (/^\s*[-+] /m.test(withoutFences(prompt.text))) {
    problems.push(`${where} has a "-" or "+" bullet: Mintlify copies bullets with "*", so write "*" and the copy is the text of the page.`);
  }
  // A ">" in a sentence ("Settings > API Keys") is text; "<" and braces are what MDX reads as code.
  if (/[<{}]/.test(outsideCode(prompt.text))) {
    problems.push(`${where} has a "<" or a brace outside a code span, which MDX reads as code.`);
  }
  return problems;
}

/**
 * The promises a prompt makes about a key. They are what a person relies on when pasting it, so they
 * are held in place: the MCP prompt never asks for a key, the CLI prompt never takes one in the chat,
 * and nothing that publishes forgets that a draft comes first.
 */
function checkPromptSafety(prompts) {
  const problems = [];
  const texts = prompts.map((prompt) => prompt.text);
  if (!texts.some((text) => /do not ask me for an API key/i.test(text))) {
    problems.push(`${QUICKSTART_PAGE}: no prompt tells the agent not to ask for an API key (the MCP server signs in in the browser).`);
  }
  if (!texts.some((text) => /never ask me to paste the key into the chat/i.test(text))) {
    problems.push(`${QUICKSTART_PAGE}: no prompt tells the agent never to take the API key in the chat, in an argument or in a file.`);
  }
  for (const prompt of prompts) {
    if (/publish/i.test(prompt.text) && !/draft/i.test(prompt.text)) {
      problems.push(`The prompt at line ${prompt.line} of ${QUICKSTART_PAGE} mentions publishing and never says "draft".`);
    }
  }
  return problems;
}

/** Every rule for the prompts of the quickstart. */
function checkQuickstartPrompts(mdxText, reference) {
  const prompts = readPrompts(mdxText);
  if (prompts.length === 0) return [`${QUICKSTART_PAGE} has no <Prompt>.`];
  return [
    ...prompts.flatMap((prompt) => [
      ...checkPromptCopyText(prompt),
      ...checkMentions(prompt.text, reference, `The prompt at line ${prompt.line} of ${QUICKSTART_PAGE}`),
      ...checkAddresses(prompt.text, `The prompt at line ${prompt.line} of ${QUICKSTART_PAGE}`),
      // The description is what the card shows next to the button, and it names commands too.
      ...checkMentions(prompt.description, reference, `The description of the prompt at line ${prompt.line} of ${QUICKSTART_PAGE}`),
    ]),
    ...checkPromptSafety(prompts),
  ];
}

// ---------------------------------------------------------------------------------------------
// The skill
// ---------------------------------------------------------------------------------------------

/**
 * A skill is YAML frontmatter, then Markdown. Only the little of YAML a skill uses is read: `key:
 * value` lines and one map (`metadata`) whose lines are indented. Anything else is reported rather
 * than guessed at.
 */
function readSkill(text) {
  const parts = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
  if (!parts) throw new Error(`${SKILL_FILE} must start with YAML frontmatter between two "---" lines.`);

  const frontmatter = {};
  let openMap = null;
  parts[1].split('\n').forEach((line, index) => {
    const lineNumber = index + 2;
    const nested = /^\s{2,}([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    const top = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (nested && openMap !== null) {
      frontmatter[openMap][nested[1]] = unquote(nested[2]);
    } else if (top) {
      openMap = null;
      if (top[2] === '') {
        openMap = top[1];
        frontmatter[openMap] = {};
      } else {
        frontmatter[top[1]] = unquote(top[2]);
      }
    } else {
      throw new Error(`${SKILL_FILE}, line ${lineNumber}: the frontmatter is not a plain "key: value" list: ${line}`);
    }
  });
  return { frontmatter, body: parts[2] };
}

/**
 * A YAML scalar, without its quotes. A plain one (no quotes) that holds ": " or " #" is not valid
 * YAML: a real parser would refuse the whole skill, so it is refused here with a message that says
 * what to do.
 */
function unquote(value) {
  const quoted = /^"(.*)"$/.exec(value) || /^'(.*)'$/.exec(value);
  if (quoted) return quoted[1];
  if (/:\s|\s#/.test(value)) {
    throw new Error(`${SKILL_FILE}: the frontmatter value "${value.slice(0, 60)}..." holds ": " or " #", which YAML reads as syntax: put the value in quotes.`);
  }
  return value;
}

/** The specification's rules for the frontmatter of a skill. */
function checkSkillFrontmatter(frontmatter) {
  const problems = [];
  const { name, description, compatibility, metadata } = frontmatter;

  for (const field of Object.keys(frontmatter)) {
    if (!SKILL_FIELDS.includes(field)) problems.push(`${SKILL_FILE}: "${field}" is not a field of the specification (${SKILL_FIELDS.join(', ')}).`);
  }

  if (typeof name !== 'string' || name === '') {
    problems.push(`${SKILL_FILE}: "name" is missing.`);
  } else if (name.length > SKILL_NAME_MAX || !SKILL_NAME_PATTERN.test(name)) {
    problems.push(
      `${SKILL_FILE}: the name "${name}" must be at most ${SKILL_NAME_MAX} characters of lowercase letters, numbers and single hyphens, with no hyphen at either end.`,
    );
  } else if (name !== 'widgetic') {
    problems.push(`${SKILL_FILE}: the name is "${name}", and the skill of this site is "widgetic".`);
  }

  if (typeof description !== 'string' || description.trim() === '') {
    problems.push(`${SKILL_FILE}: "description" is missing.`);
  } else if (description.length > SKILL_DESCRIPTION_MAX) {
    problems.push(`${SKILL_FILE}: "description" is ${description.length} characters; the most is ${SKILL_DESCRIPTION_MAX}.`);
  }

  if (compatibility !== undefined) {
    if (typeof compatibility !== 'string' || compatibility.trim() === '' || compatibility.length > SKILL_COMPATIBILITY_MAX) {
      problems.push(`${SKILL_FILE}: "compatibility" must be 1 to ${SKILL_COMPATIBILITY_MAX} characters.`);
    }
  }

  if (metadata !== undefined) {
    if (typeof metadata !== 'object' || metadata === null || Object.keys(metadata).length === 0) {
      problems.push(`${SKILL_FILE}: "metadata" must be a map of keys to text.`);
    }
  }
  return problems;
}

/** The rules for the Markdown of a skill. */
function checkSkillBody(body, reference) {
  const problems = [];
  const lineCount = body.replace(/\n$/, '').split('\n').length;
  if (lineCount >= SKILL_BODY_MAX_LINES) {
    problems.push(`${SKILL_FILE}: the body is ${lineCount} lines; the specification asks for fewer than ${SKILL_BODY_MAX_LINES}.`);
  }
  return [...problems, ...checkMentions(body, reference, SKILL_FILE), ...checkAddresses(body, SKILL_FILE)];
}

/** Every rule for the skill. */
function checkSkill(skillText, reference) {
  let skill;
  try {
    skill = readSkill(skillText);
  } catch (error) {
    return [error.message];
  }
  return [...checkSkillFrontmatter(skill.frontmatter), ...checkSkillBody(skill.body, reference)];
}

module.exports = {
  QUICKSTART_PAGE,
  SKILL_FILE,
  SKILL_BODY_MAX_LINES,
  SKILL_COMPATIBILITY_MAX,
  SKILL_DESCRIPTION_MAX,
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
};
