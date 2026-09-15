import type { ZodRawShape } from 'zod';
import type { ToolRegistrar } from '../utils/tool-registrar.js';
import type { McpToolResult } from '../utils/response-envelope.js';

export interface CollectedTool {
  name: string;
  description: string;
  shape: ZodRawShape;
  handler: ToolHandler;
}

export type ToolHandler = (
  params: Record<string, unknown>,
  extra: Record<string, unknown>
) => Promise<McpToolResult> | McpToolResult;

/**
 * Stands in for the MCP server at registration time: the tool modules call
 * `tool(name, description, shape, handler)` on it and the CLI reads the
 * collected entries back to list, describe and invoke them.
 */
export class ToolCollector implements ToolRegistrar {
  private readonly tools = new Map<string, CollectedTool>();

  tool(name: string, ...rest: unknown[]): void {
    const handler = rest.pop() as ToolHandler;
    let description = '';
    let shape: ZodRawShape = {};
    for (const arg of rest) {
      if (typeof arg === 'string') description = arg;
      else if (arg && typeof arg === 'object' && !isAnnotations(arg)) shape = arg as ZodRawShape;
    }
    if (this.tools.has(name)) throw new Error(`Tool "${name}" registered twice`);
    this.tools.set(name, { name, description, shape, handler });
  }

  list(): CollectedTool[] {
    return [...this.tools.values()];
  }

  get(name: string): CollectedTool | undefined {
    return this.tools.get(name);
  }
}

// A zod shape's values are schemas (they carry `_def`); an annotations object
// holds plain strings and booleans.
function isAnnotations(value: object): boolean {
  return Object.values(value).every((v) => !v || typeof v !== 'object' || !('_def' in v));
}
