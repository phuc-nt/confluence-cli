import type { z, ZodRawShape, ZodTypeAny } from 'zod';

/**
 * The registration surface the tool modules were written against.
 *
 * It mirrors the `tool()` method of the MCP SDK's McpServer, so the tool
 * sources copied from the MCP server register unchanged, and a future MCP
 * server object satisfies this interface without an adapter. The CLI plugs in
 * a ToolCollector instead of a server.
 */
export type ToolExtra = Record<string, any>;

export type ToolHandlerFor<S extends ZodRawShape> = (
  params: z.objectOutputType<S, ZodTypeAny>,
  extra: ToolExtra
) => unknown;

export interface ToolRegistrar {
  tool<S extends ZodRawShape>(name: string, description: string, shape: S, handler: ToolHandlerFor<S>): void;
  tool<S extends ZodRawShape>(name: string, shape: S, handler: ToolHandlerFor<S>): void;
  tool(name: string, description: string, handler: (params: Record<string, never>, extra: ToolExtra) => unknown): void;
}
