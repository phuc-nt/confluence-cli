---
name: confluence-cli
description: Read, search, create, update and comment on Confluence Cloud pages from the shell with the `confluence-cli` command (Atlassian API token, no MCP needed). Use when the user asks to look up, write, or update Confluence pages, spaces, or comments, or to publish a document to Confluence.
---

# Confluence via `confluence-cli`

`confluence-cli` is a shell command with 11 Confluence Cloud tools, the same
tools, parameters and response shape as the Confluence Cloud MCP server. Every
call prints one JSON envelope on stdout; nothing else goes there. Logs go to
stderr. Use it exactly as you would use the MCP tools of the same names.

## 1. Check the setup once per session

```bash
confluence-cli doctor
```

- `ok: true` → `data.user.displayName` is the account you act as, `data.site`
  the site. Continue.
- exit 2 with `AUTH_FAILED` and "Missing credentials" → ask the user to set
  `CONFLUENCE_SITE_NAME`, `CONFLUENCE_EMAIL`, `CONFLUENCE_API_TOKEN` (or the
  shared `ATLASSIAN_SITE_NAME`, `ATLASSIAN_USER_EMAIL`, `ATLASSIAN_API_TOKEN`)
  in the environment or in a `.env` file in the working directory. Never ask
  the user to paste the token into the chat, and never print it.
- `command not found` → install: `npm install -g github:phuc-nt/confluence-cli`,
  Node 20+. Not on the npm registry. If that install runs with scripts blocked
  (`--ignore-scripts`, or a locked-down npm config) the bundle is never built and
  the command still will not exist — then clone the repo and run `npm install
  --ignore-scripts && npm run build`. Report this to the user rather than
  retrying the same install.

## 2. Call a tool

```bash
confluence-cli <tool> --key value --key2 value2      # flags, coerced to the schema type
confluence-cli <tool> --json '{"key": "value"}'      # or one JSON object
confluence-cli <tool> --file params.json              # or a file / --stdin
confluence-cli describe <tool>                        # full description + JSON Schema
confluence-cli tools                                  # all tools, one line each
```

Rules:
- Long or multi-line `content` → write it to a file and use `--file`, or
  `--json` built by a script. Do not fight shell quoting.
- Exit code: `0` success, `1` the tool returned `ok: false`, `2` wrong
  parameters or credentials. Always read `error.code` and `error.hint`.
- Unknown flag or wrong type is refused before any API call; run
  `describe <tool>` and retry. Do not guess parameter names.

## 3. Response envelope

```jsonc
{ "ok": true,  "data": { ... }, "meta": { "tool": "getPageContent", ... } }
{ "ok": false, "error": { "code": "NOT_FOUND", "message": "...", "hint": "..." }, "meta": { "tool": "..." } }
```

Codes: `AUTH_FAILED`, `PERMISSION_DENIED`, `INVALID_INPUT`, `NOT_FOUND`,
`CONFLICT`, `RATE_LIMITED`, `UPSTREAM_ERROR`, `NETWORK_ERROR`, `UNKNOWN_ERROR`.
On `CONFLICT` from `updatePage`/`updateComment`: re-read the current version and
retry once with it. On `RATE_LIMITED`: wait, then retry once. On `AUTH_FAILED`
or `PERMISSION_DENIED`: stop and report; do not retry.

## 4. Workflows

Find a page, then read it:
```bash
confluence-cli searchPages --query "release checklist" --spaceKey DOCS --limit 5
confluence-cli getPageContent --pageId 123456            # data.version is needed for updates
confluence-cli getPageContent --pageId 123456 --raw      # original storage format (XHTML)
```

`data.body` is Markdown (`data.representation` says `markdown`): headings,
lists, tables, links and code blocks, with HTML entities decoded. Read it as
you would any Markdown. Use `--raw` only when the body must survive a
round-trip unchanged — reading Markdown and writing it back drops macros and
layout the converter does not represent.

Create a page (Markdown is converted to Confluence storage format automatically):
```bash
confluence-cli getSpaces --limit 50                      # pick data.spaces[].id
confluence-cli createPage --spaceId 65846 --title "Design: Login" --file page.json
# page.json: {"content": "# Heading\n\nBody in **Markdown**..."}  (parentId optional)
```

Update a page safely (optimistic locking):
```bash
confluence-cli getPageContent --pageId 123456            # note data.version
confluence-cli updatePage --pageId 123456 --version 7 --title "New title" --file body.json
```
Content in the file replaces the whole body; pass only `--title` to rename.
To edit an existing body rather than replace it, read it with `--raw`, change
that, and send it back — the storage format passes through untouched.

Comments (bodies are Markdown, `--raw` for storage format):
```bash
confluence-cli getPageComments --pageId 123456 --limit 50
confluence-cli addComment --pageId 123456 --content "Reviewed, two questions inline."
confluence-cli addComment --pageId 123456 --parentId 98765 --content "Reply text"
confluence-cli updateComment --commentId 98765 --version 2 --content "Edited text"
```

History and deletion:
```bash
confluence-cli getPageVersions --pageId 123456 --limit 10
confluence-cli deletePage --pageId 123456 --draft        # keep as draft; omit --draft to delete
confluence-cli deleteComment --commentId 98765
```

Before `deletePage`, `deleteComment`, or any `updatePage` that replaces
content the user did not author in this session, state what will change and
get the user's confirmation. Read tools (`get*`, `search*`) need no
confirmation.

## 5. Picking the right tool

Parameter tables for all tools: [reference/tools.md](reference/tools.md).
When a table is not enough, `confluence-cli describe <tool>` is authoritative.

**Never guess a tool name or a parameter name.** Unlike an MCP server, this CLI
does not push its tool list into your context — ask it, and the answer is
authoritative:

```bash
confluence-cli tools --json      # every tool: name, summary, required[], optional[]
confluence-cli describe <tool>   # one tool: full description + JSON Schema
```

Start from the task, not from the tool name:

| The user wants | Tool |
|---|---|
| Find a page by text, title or space | `searchPages` |
| Read a page | `getPageContent` (Markdown; `--raw` for storage XHTML) |
| The page's edit history | `getPageVersions` |
| List spaces / find a space id | `getSpaces` |
| Write a new page | `createPage` (needs `spaceId`, not a space key) |
| Change an existing page | `getPageContent` for the version, then `updatePage` |
| Read or write comments | `getPageComments`, `addComment`, `updateComment` |
| Remove a page or comment | `deletePage`, `deleteComment` — see below |

Pairs that are easy to confuse:

- `createPage` takes a **`spaceId`** (a number from `getSpaces`), while
  `searchPages` filters by **`spaceKey`** (e.g. `DOCS`). They are not
  interchangeable.
- `updatePage` **replaces the whole body**. To edit rather than replace, read
  with `--raw`, change that text, and send it back; reading Markdown and writing
  it back drops macros and layout the converter does not represent.
- `updatePage` and `updateComment` need the object's **current** `version`. A
  stale one returns `CONFLICT` — re-read the version and retry once.
- `deletePage --draft` keeps the page as a draft; without `--draft` it goes to
  the trash.

## 5b. Destructive tools

Before `deletePage` or `deleteComment`, and before any `updatePage` that
replaces content the user did not author in this session:

1. Name the exact object (page id **and** title, or the comment and its page)
   and what is lost — a page takes its comments and attachments with it.
2. Get the user's explicit confirmation for that object.
3. Prefer the non-destructive route when it fits: `deletePage --draft` over a
   trash delete, an edit over a wholesale body replacement.

Never delete objects the user did not name, never delete in a loop over search
results, and never delete to "clean up" something you created unless the user
asked for that. Read tools (`get*`, `search*`) need no confirmation.

## 6. When MCP becomes available

The MCP server (`confluence-cloud-mcp-server`) registers the same tool names,
parameters and envelope. Switch the transport; keep the workflow above as is.
