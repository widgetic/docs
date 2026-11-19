---
name: widgetic
description: Build, preview, publish and embed Widgetic widgets (interactive quizzes, countdowns, galleries, timelines, FAQs, charts, calculators, carousels) from a coding agent, and integrate the Widgetic REST API. Use when the user wants to create, change, publish, delete or embed a Widgetic widget, get its embed code (HTML, iframe, React, Vue, Svelte, Angular), manage workflows, A/B tests or translations, or call the Widgetic API from code. Covers the three ways in - the Widgetic MCP server, the widgetic command line and the REST API.
compatibility: Needs network access to mcp.widgetic.com and api.widgetic.com. The widgetic command line needs Node 22.12 or later.
metadata:
  mintlify-proj: widgetic
  version: "1.0"
---

# Widgetic

Widgetic builds an interactive widget (a countdown, a quiz, a gallery) from a description in plain words, hosts it, and gives you the code to embed it on a website. You reach it three ways: the MCP server, the `widgetic` command line, or the REST API.

## Pick a way in

| Way in | Use it for | Sign-in |
| --- | --- | --- |
| MCP server at `https://mcp.widgetic.com` | Building and editing widgets in a conversation: describe, preview, publish, get the embed code | OAuth in the browser. There is no key to handle. |
| `widgetic` command line | Scripts, CI and shells where the MCP server is not set up. `widgetic mcp <tool>` runs an MCP tool and `widgetic api <group> <command>` runs a REST operation. | An API key: `widgetic auth login`, or `WIDGETIC_API_KEY` in the environment |
| REST API at `https://api.widgetic.com/v1` | Code that talks to Widgetic: a backend, a partner integration, managed users, credits | `Authorization: Bearer <API key>` |

If an MCP tool such as `create_widget` is already available to you, use it and set nothing else up.

## Connect the MCP server

Add it under the name `widgetic`, and keep the servers that are already configured:

- Claude Code: run `claude mcp add --transport http widgetic https://mcp.widgetic.com`. The user then runs `/mcp`, chooses **widgetic** and authenticates.
- Codex: add a `[mcp_servers.widgetic]` table with `url = "https://mcp.widgetic.com"` to `~/.codex/config.toml`, then run `codex mcp login widgetic`.
- Cursor: add `"widgetic": { "url": "https://mcp.widgetic.com" }` under `mcpServers` in `.cursor/mcp.json`. The user chooses **Connect**.
- VS Code: add `"widgetic": { "type": "http", "url": "https://mcp.widgetic.com" }` under `servers` in `.vscode/mcp.json`.
- Any other client that supports remote MCP servers over Streamable HTTP uses the same address.

The user signs in to Widgetic in the browser and chooses **Allow**. You cannot do that for them: say what to click, then wait. Do not ask for an API key. When it is done, call `get_profile` and tell the user which workspace is connected (its name and plan). A workspace on a plan without API access, or one that has not paid yet, is refused with a message that says so: report it and stop.

## Use the command line

It needs Node 22.12 or later. Run `npm install -g @widgetic/cli`, then `widgetic doctor`. If its API key line is not ok, tell the user to make a key under Settings > API Keys in the dashboard (app.widgetic.com; a key with full access if they want `widgetic mcp`) and to run `widgetic auth login` in their own terminal, or to start you with `WIDGETIC_API_KEY` set.

- `widgetic --help` is the menu. `widgetic schema api GROUP COMMAND` and `widgetic schema mcp COMMAND` print everything one command takes: read it before you run a command you do not know.
- `--json` prints the result alone, as one line of JSON on stdout, and an error as one line of JSON on stderr. `--dry-run` prints the request and sends nothing.
- A command that changes or deletes something asks first on a terminal and needs `--yes` without one. Pass `--yes` only after the user said yes.
- `create-widget`, `replicate-widget` and `revise-widget` return at once; `--wait` waits for the build (up to 15 minutes). A build stays a draft unless you pass `--publish`.
- Exit codes: 0 ok, 1 any other failure, 2 the command line is wrong (nothing was sent), 3 no key or the plan does not allow it, 4 not found, 5 refused by the server, 6 rate limited or unavailable, 7 this CLI is too old (`widgetic update`).

## Rules for the user's account

- **Credits.** `create_widget` and `revise_widget` use 1 credit per call, charged when the build starts. A batch of widgets uses 1 credit each, up to 25 at a time: tell the user the total and get a yes first. Everything else, including previews, listing, embed codes and `get_profile`, is free.
- **Publishing.** Through MCP a finished build is published on its own, unless the user wants a draft (pass `publish` false) or the plan or the connection's permissions do not allow publishing. The command line builds drafts unless you pass `--publish`. `publish_widget` and `revise_widget` change what the embeds of a published widget show, so do them only after the user agreed. When the user wants to look first, keep a draft.
- **Deleting is permanent.** `delete_widget` removes every version, embeds already on websites stop working and credits are not refunded. Do it only when the user clearly asked, and pass the exact title (`confirm_title`) the user confirmed. `unpublish_widget` takes a widget offline without deleting it.
- **Workspace.** A connection or a key works in exactly one workspace, the one it was made for, and never follows the workspace the user has open on widgetic.com. Say which one (`get_profile`, or the Workspace line of `widgetic doctor`) before you create or change anything. To work in another workspace the user connects again, or makes a key, for that one.
- **Secrets.** Never put an API key in a command argument, in a file of the user's project, in the chat or in client-side code. It comes from `WIDGETIC_API_KEY` or `widgetic auth login`.

## Build, preview, publish and embed

1. Call `create_widget` with a `title` and a `brief` (what the widget should do and show, in the user's terms). It returns at once with a `widget_id`.
2. Call `show_widget` right away so the user watches the build (it answers in text in a client that cannot show a card). Poll `get_widget` every 5 to 10 seconds until `phase` is `ready`, `failed` or `cancelled`: it also has the link to the preview.
3. For a change that needs new code, call `revise_widget` with the user's feedback. The texts, images, colors, fonts and sizes of a published widget change without a rebuild (`update_widget_customization`).
4. Call `publish_widget` once the user approved the preview. It is not needed when the build was published on its own. The result has the `composition_id`.
5. Call `get_embed_code` with that `composition_id` and a `format`: `html`, `iframe`, `react`, `vue`, `svelte` or `angular`, at a fixed `width` and `height` or `responsive`. It works only for a published widget.

With the command line the same steps are `widgetic mcp create-widget --title "Launch countdown" --brief "A countdown to 14 March 2027" --wait`, `widgetic mcp show-widget --widget-id ID`, `widgetic mcp publish-widget --widget-id ID` and `widgetic mcp get-embed-code --composition-id ID --format react`.

## Call the REST API from code

- The base URL is `https://api.widgetic.com/v1`. Send `Authorization: Bearer <API key>`. The prefix of a key says its role: `wgt_usr_` a user, `wdg_org_` an organization, `wgt_prt_` a partner (managed users, credits, storage).
- A success is `{"success": true, "data": ...}`. An error is `{"success": false, "error": {"code": ..., "message": ...}}`.
- A key that lacks a scope the call needs gets `403` with the code `API_KEY_SCOPE_MISSING` and `error.details.missingScopes`. The limits of a key cannot be changed, so make a new key with those scopes. The MCP server accepts only a key made with full access.
- A call that creates something may need an `Idempotency-Key` header (the command line makes one for you). A `429` carries a `Retry-After` header: wait that long.
- In TypeScript, `npm install @widgetic/api-sdk-ts`. The API Reference of the documentation site lists every operation, and `widgetic schema api GROUP COMMAND` prints the input of one.

## When something fails

| You see | It means | Do this |
| --- | --- | --- |
| The connection or `get_profile` says the plan does not include API access | The account's plan has no API access | Tell the user and stop |
| A tool says the plan does not include publishing, or a build comes back as a draft | The plan or the connection's permissions do not allow publishing | Say so; `get_widget` explains how to publish |
| `403` with `API_KEY_SCOPE_MISSING`, or the CLI exits with 3 | The key lacks a scope, or it is not a full-access key and you used `widgetic mcp` | Make a new key with the scopes the error names |
| No API key (exit code 3) | There is no key for this profile | `widgetic auth login`, or set `WIDGETIC_API_KEY` |
| `429` (exit code 6) | Too many requests | Wait for `Retry-After` |
| Exit code 7 | This CLI is too old for the server | `widgetic update` |

## Look things up

- The documentation site has a page for every tool, command and endpoint. Add `.md` to the address of a page to get it as Markdown, and open `/llms.txt` on the same site for the list of pages.
- `widgetic --help` and `widgetic schema` always describe the version you have installed.
