/**
 * Command-line front end over the Confluence Cloud tools.
 *
 * For harnesses that cannot load MCP servers: each invocation runs one tool
 * and prints the same {ok, data, meta} envelope the Confluence MCP server
 * returns, so a skill written against the CLI keeps working unchanged once
 * MCP is available.
 */
import dotenv from 'dotenv';
import { createRequire } from 'module';
import { Logger } from './utils/logger.js';
import { ConfluenceApiClient } from './utils/confluence-api.js';
import { registerConfluenceTools } from './tools/confluence/index.js';
import { ok, fail, failFromError, ErrorCodes, type McpToolResult } from './utils/response-envelope.js';
import { resolveConfluenceConfig, CREDENTIAL_HELP } from './utils/resolve-confluence-config.js';
import { ToolCollector, type CollectedTool } from './cli/tool-collector.js';
import { runCli, type CliAdapter } from './cli/runner.js';

dotenv.config();
// A CLI call is one tool; the server's per-request info lines are noise here.
if (!process.env.LOG_LEVEL) Logger.setLogLevel('warn');
// Dependency deprecation notices (e.g. Node's url.parse warning raised inside
// axios) are for library authors, not for whoever reads this CLI's stderr.
(process as unknown as { noDeprecation: boolean }).noDeprecation = true;

const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as { version: string };
const BIN = 'confluence-cli';

const resolved = resolveConfluenceConfig();

// `tools` and `describe` must work before credentials exist, and the
// registrars need a client instance up front; an unconfigured client makes no
// network call until a tool runs, and tools are refused without credentials.
const client = new ConfluenceApiClient(
  resolved.config ?? { siteName: 'unconfigured.invalid', email: '', apiToken: '' }
);

const collector = new ToolCollector();
registerConfluenceTools(collector, client);

const adapter: CliAdapter = {
  binName: BIN,
  version: packageJson.version,
  credentialHelp: CREDENTIAL_HELP,
  tools: collector.list(),

  credentialError(): McpToolResult | null {
    if (resolved.config) return null;
    return fail(
      ErrorCodes.AUTH_FAILED,
      `Missing credentials: ${resolved.missing.join('; ')}`,
      'Set them in the environment or a .env file in the current directory, then run "confluence-cli doctor".',
      { tool: 'credentials' }
    );
  },

  async doctor(): Promise<McpToolResult> {
    try {
      const user = await client.getCurrentUser();
      return ok(
        {
          site: resolved.config!.siteName,
          email: resolved.config!.email,
          user,
          credentialSources: resolved.sources,
          toolCount: collector.list().length,
        },
        { tool: 'doctor' }
      );
    } catch (error) {
      return failFromError(error, 'doctor', {
        [ErrorCodes.NOT_FOUND]: 'Check CONFLUENCE_SITE_NAME: it should be the bare host such as acme.atlassian.net.',
      });
    }
  },

  async invoke(tool: CollectedTool, params: Record<string, unknown>): Promise<McpToolResult> {
    return tool.handler(params, {});
  },
};

runCli(process.argv.slice(2), adapter).then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`[${BIN}] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(2);
  }
);
