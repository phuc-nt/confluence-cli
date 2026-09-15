# confluence-cli

Confluence Cloud from the shell, built for AI agent harnesses that cannot load MCP servers (and for scripts). One command, 11 tools, one JSON envelope, authenticated with a personal Atlassian API token. Ships with an agent skill so Claude Code, Kiro and similar tools know when and how to use it.

The tool names, parameters and response envelope are the same as the [Confluence Cloud MCP server](https://github.com/phuc-nt/confluence-cloud-mcp-server), so a workflow written against the CLI moves to MCP without changes.

## Install

Node.js 20 or newer.

```bash
npm install -g @phuc-nt/confluence-cli
# or straight from GitHub
npm install -g github:phuc-nt/confluence-cli
```

## Credentials

Create an API token at <https://id.atlassian.com/manage-profile/security/api-tokens>, then set three variables in the environment or in a `.env` file in the working directory:

| Variable | Fallback name (shared with `jira-cli`) | Value |
|---|---|---|
| `CONFLUENCE_SITE_NAME` | `ATLASSIAN_SITE_NAME` | `your-site.atlassian.net` |
| `CONFLUENCE_EMAIL` | `ATLASSIAN_USER_EMAIL` | the account email |
| `CONFLUENCE_API_TOKEN` | `ATLASSIAN_API_TOKEN` | the API token |

```bash
confluence-cli doctor      # live check: prints the acting account, the site and the tool count
```

## Usage

```bash
confluence-cli tools                                   # every tool, one line each
confluence-cli describe searchPages                    # full description + JSON Schema
confluence-cli searchPages --query "release" --spaceKey DOCS --limit 5
confluence-cli getPageContent --pageId 123456                                 # body as Markdown
confluence-cli getPageContent --pageId 123456 --raw                           # body as storage format
confluence-cli createPage --spaceId 65846 --title "Notes" --file page.json    # {"content": "# Markdown..."}
confluence-cli updatePage --json '{"pageId":"123456","version":7,"title":"Renamed"}'
echo '{"pageId":"123456"}' | confluence-cli getPageComments --stdin
```

Parameters can be given as flags (`--key value`, `--key=value`, `--flag`), as one JSON object (`--json '{...}'`, `--file params.json`, `--stdin`), or mixed. Flags are coerced to the type the tool's schema declares. Page content written as Markdown is converted to Confluence storage format.

Responses are written for an agent to read, not for a browser to render. Page and comment bodies come back as Markdown with HTML entities decoded, roughly a third smaller than the storage format they replace; `--raw` returns the original XHTML for when a body must be written back verbatim. Fields the API could not fill are omitted rather than returned as `null`.

Every call prints exactly one envelope on stdout. Logs go to stderr only (`LOG_LEVEL=debug|info|warn|error`, default `warn`).

```jsonc
{ "ok": true,  "data": { ... }, "meta": { "tool": "getPageContent" } }
{ "ok": false, "error": { "code": "NOT_FOUND", "message": "...", "hint": "..." }, "meta": { "tool": "getPageContent" } }
```

| Exit code | Meaning |
|---|---|
| `0` | the tool returned `ok: true` |
| `1` | the tool returned `ok: false` (see `error.code`, `error.hint`) |
| `2` | bad command, unknown or mistyped parameter, or missing credentials |

Error codes: `AUTH_FAILED`, `PERMISSION_DENIED`, `INVALID_INPUT`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `UPSTREAM_ERROR`, `NETWORK_ERROR`, `UNKNOWN_ERROR`.

## Tools

`getSpaces`, `searchPages`, `getPageContent`, `getPageVersions`, `createPage`, `updatePage`, `deletePage`, `getPageComments`, `addComment`, `updateComment`, `deleteComment`.

Parameter tables: [skills/confluence-cli/reference/tools.md](skills/confluence-cli/reference/tools.md). `confluence-cli describe <tool>` is the authority.

## Agent skill

[`skills/confluence-cli/`](skills/confluence-cli/) follows the Agent Skills format (`SKILL.md` plus a generated reference). Copy it into the project the agent works in:

```bash
SRC="$(npm root -g)/@phuc-nt/confluence-cli/skills/confluence-cli"
cp -r "$SRC" .claude/skills/      # Claude Code
cp -r "$SRC" .kiro/skills/        # Kiro
```

The skill tells the agent to run `doctor` once, how to pass parameters, how to react to each error code, and to confirm with the user before destructive calls.

## Development

```bash
npm install
npm run typecheck          # tsc, no emit
npm run build              # esbuild, one self-contained file under dist/
npm run cli -- doctor      # run the local build
npm run skill:reference    # regenerate skills/confluence-cli/reference/tools.md from the built CLI
```

The tool implementations under `src/tools/` and `src/utils/` were copied from the Confluence Cloud MCP server and are kept in sync by hand; this package has no dependency on the MCP server or the MCP SDK. The tools register through the small `ToolRegistrar` interface in `src/utils/tool-registrar.ts`, which mirrors the MCP server's `tool()` method.

## License

MIT, see [LICENSE](LICENSE).
