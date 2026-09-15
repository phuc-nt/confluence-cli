import { z, type ZodTypeAny } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { CollectedTool } from './tool-collector.js';
import { unwrapField } from './argument-parser.js';

/** One line per tool, enough to pick the right one before calling `describe`. */
export interface ToolSummary {
  name: string;
  summary: string;
  required: string[];
  optional: string[];
}

export function summarizeTools(tools: CollectedTool[]): ToolSummary[] {
  return tools.map((tool) => {
    const required: string[] = [];
    const optional: string[] = [];
    for (const [key, field] of Object.entries(tool.shape)) {
      (isRequired(field) ? required : optional).push(key);
    }
    return { name: tool.name, summary: firstLine(tool.description), required, optional };
  });
}

/** Full description plus the JSON Schema an agent needs to build the input. */
export function describeTool(tool: CollectedTool): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJsonSchema(z.object(tool.shape), { $refStrategy: 'none' }),
  };
}

function isRequired(field: ZodTypeAny): boolean {
  const typeName = (field._def as { typeName?: string }).typeName;
  if (typeName === 'ZodOptional' || typeName === 'ZodDefault' || typeName === 'ZodNullable') return false;
  if (typeName === 'ZodEffects') return isRequired(unwrapField(field));
  return true;
}

function firstLine(description: string): string {
  const line = description.split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}
