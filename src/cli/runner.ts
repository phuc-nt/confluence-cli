import { z } from 'zod';
import { ok, fail, ErrorCodes, type McpToolResult } from '../utils/response-envelope.js';
import type { CollectedTool } from './tool-collector.js';
import { parseToolArguments, ArgumentError } from './argument-parser.js';
import { summarizeTools, describeTool } from './tool-reference.js';

/** What differs between the Jira and Confluence CLIs; everything else is here. */
export interface CliAdapter {
  binName: string;
  version: string;
  /** Environment variable names, for `--help` and error hints. */
  credentialHelp: string;
  /** All tools, registered exactly as the MCP server registers them. No network. */
  tools: CollectedTool[];
  /** Failure envelope when credentials are missing, otherwise null. */
  credentialError(): McpToolResult | null;
  /** Live round trip to the site; returns an envelope. */
  doctor(): Promise<McpToolResult>;
  /** Run one tool with already-validated params; returns an envelope. */
  invoke(tool: CollectedTool, params: Record<string, unknown>): Promise<McpToolResult>;
}

/**
 * Exit codes: 0 the tool succeeded, 1 the tool returned a failure envelope,
 * 2 the command line, parameters or credentials were wrong before any call.
 */
export const ExitCode = { OK: 0, TOOL_FAILED: 1, USAGE: 2 } as const;

/** Dispatch one invocation. Everything on stdout is an envelope except `--help`. */
export async function runCli(argv: string[], adapter: CliAdapter): Promise<number> {
  const [command, ...rest] = argv;

  if (!command || ['help', '--help', '-h'].includes(command)) {
    process.stdout.write(usage(adapter));
    return ExitCode.OK;
  }
  if (command === '--version' || command === '-v') {
    process.stdout.write(`${adapter.version}\n`);
    return ExitCode.OK;
  }

  switch (command) {
    case 'tools':
      return emit(ok({ tools: summarizeTools(adapter.tools) }, { tool: 'tools', count: adapter.tools.length }));

    case 'describe': {
      const tool = rest[0] ? findTool(adapter, rest[0]) : undefined;
      if (!tool) return emit(unknownTool(adapter, rest[0] ?? ''), ExitCode.USAGE);
      return emit(ok(describeTool(tool), { tool: 'describe' }));
    }

    case 'doctor': {
      const missing = adapter.credentialError();
      if (missing) return emit(missing, ExitCode.USAGE);
      return emit(await guarded(() => adapter.doctor(), 'doctor'));
    }

    default:
      return runTool(command, rest, adapter);
  }
}

async function runTool(name: string, args: string[], adapter: CliAdapter): Promise<number> {
  const tool = findTool(adapter, name);
  if (!tool) return emit(unknownTool(adapter, name), ExitCode.USAGE);

  const missing = adapter.credentialError();
  if (missing) return emit(missing, ExitCode.USAGE);

  let input: Record<string, unknown>;
  try {
    input = parseToolArguments(args, tool.shape);
  } catch (error) {
    if (!(error instanceof ArgumentError)) throw error;
    return emit(
      fail(ErrorCodes.INVALID_INPUT, error.message, `Run "${adapter.binName} describe ${tool.name}" to see the parameters.`, { tool: tool.name }),
      ExitCode.USAGE
    );
  }

  const parsed = z.object(tool.shape).safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return emit(
      fail(ErrorCodes.INVALID_INPUT, `Invalid parameters for ${tool.name}`, `Run "${adapter.binName} describe ${tool.name}" to see the parameters.`, { tool: tool.name, issues }),
      ExitCode.USAGE
    );
  }

  return emit(await guarded(() => adapter.invoke(tool, parsed.data), tool.name));
}

/** A handler that throws past its own catch still owes the caller an envelope. */
async function guarded(run: () => Promise<McpToolResult>, tool: string): Promise<McpToolResult> {
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(ErrorCodes.UNKNOWN_ERROR, message, undefined, { tool });
  }
}

/** Exact name first; a case-insensitive match second so `getissue` still works. */
function findTool(adapter: CliAdapter, name: string): CollectedTool | undefined {
  return adapter.tools.find((t) => t.name === name)
    ?? adapter.tools.find((t) => t.name.toLowerCase() === name.toLowerCase());
}

function unknownTool(adapter: CliAdapter, name: string): McpToolResult {
  const needle = name.toLowerCase().replace(/[^a-z]/g, '');
  const near = adapter.tools
    .map((t) => t.name)
    .filter((n) => needle.length >= 3 && n.toLowerCase().includes(needle));
  const hint = near.length
    ? `Did you mean: ${near.join(', ')}? Run "${adapter.binName} tools" for the full list.`
    : `Run "${adapter.binName} tools" for the full list.`;
  return fail(ErrorCodes.INVALID_INPUT, name ? `Unknown tool "${name}"` : 'Missing tool name', hint, { tool: name });
}

/** Print the envelope text and derive the exit code from its `ok` flag. */
function emit(result: McpToolResult, forcedCode?: number): number {
  const text = result.content?.[0]?.text ?? JSON.stringify(result, null, 2);
  process.stdout.write(`${text}\n`);
  if (forcedCode !== undefined) return forcedCode;
  return result.isError ? ExitCode.TOOL_FAILED : ExitCode.OK;
}

function usage(adapter: CliAdapter): string {
  const b = adapter.binName;
  return `${b} ${adapter.version}

Usage:
  ${b} tools                      list tools (name, one-line summary, parameters)
  ${b} describe <tool>            full description and JSON Schema of one tool
  ${b} doctor                     check credentials with a live read-only call
  ${b} <tool> [parameters]        run a tool; stdout is one JSON envelope

Parameters:
  --key value   --key=value   --flag        one parameter each (coerced to the schema type)
  --json '{"key": "value"}'                 all parameters as JSON; a bare '{...}' works too
  --file params.json   |   --stdin          all parameters from a file or stdin

Output: {"ok": true, "data": ..., "meta": ...} or {"ok": false, "error": {"code", "message", "hint"}, "meta": ...}
Exit:   0 ok, 1 tool returned ok=false, 2 bad usage / parameters / credentials
Logs:   stderr only; LOG_LEVEL=debug|info|warn|error (default warn)

Credentials (environment or .env in the current directory):
  ${adapter.credentialHelp}
`;
}
