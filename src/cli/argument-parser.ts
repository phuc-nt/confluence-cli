import { readFileSync } from 'fs';
import type { ZodRawShape, ZodTypeAny } from 'zod';

/**
 * Thrown for anything wrong with the command line itself, as opposed to the
 * parameter values, which zod validates afterwards.
 */
export class ArgumentError extends Error {}

/**
 * Turn `<tool>` arguments into the object the tool's zod schema expects.
 *
 * Accepted forms, later ones override earlier ones:
 *   --json '{"a":1}'      whole input as JSON (a bare '{...}' positional works too)
 *   --file params.json    whole input read from a file
 *   --stdin               whole input read from standard input
 *   --key value           one parameter; `--key=value` and bare `--flag` also work
 *
 * Flag values arrive as strings, so each is coerced to what the schema field
 * wants (number, boolean, JSON array/object, comma list). Zod still validates
 * the result, so a bad coercion produces a normal INVALID_INPUT error.
 */
export function parseToolArguments(
  args: string[],
  shape: ZodRawShape
): Record<string, unknown> {
  let input: Record<string, unknown> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith('{')) {
      input = { ...input, ...parseJsonObject(arg, 'positional JSON') };
      continue;
    }
    if (!arg.startsWith('--')) {
      throw new ArgumentError(`Unexpected argument "${arg}"; parameters are passed as --key value or --json '{...}'`);
    }

    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const inlineValue = eq === -1 ? undefined : arg.slice(eq + 1);
    const takeValue = (): string => {
      if (inlineValue !== undefined) return inlineValue;
      const next = args[i + 1];
      if (next === undefined) throw new ArgumentError(`--${key} needs a value`);
      i++;
      return next;
    };

    if (key === 'json') {
      input = { ...input, ...parseJsonObject(takeValue(), '--json') };
    } else if (key === 'file') {
      input = { ...input, ...parseJsonObject(readFileSync(takeValue(), 'utf8'), '--file') };
    } else if (key === 'stdin') {
      input = { ...input, ...parseJsonObject(readFileSync(0, 'utf8'), '--stdin') };
    } else {
      const field = shape[key];
      if (!field) {
        throw new ArgumentError(`Unknown parameter --${key}`);
      }
      const next = args[i + 1];
      const hasValue = inlineValue !== undefined || (next !== undefined && !next.startsWith('--'));
      const raw = hasValue ? takeValue() : 'true';
      input[key] = coerceForField(field, raw);
    }
  }

  return input;
}

function parseJsonObject(text: string, source: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ArgumentError(`${source} is not valid JSON: ${(error as Error).message}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArgumentError(`${source} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

/** Peel optional/nullable/default/effects wrappers to reach the base type. */
export function unwrapField(field: ZodTypeAny): ZodTypeAny {
  let current: ZodTypeAny = field;
  for (;;) {
    const def = current._def as { typeName?: string; innerType?: ZodTypeAny; schema?: ZodTypeAny };
    if (def.innerType && ['ZodOptional', 'ZodNullable', 'ZodDefault'].includes(def.typeName ?? '')) {
      current = def.innerType;
    } else if (def.typeName === 'ZodEffects' && def.schema) {
      current = def.schema;
    } else {
      return current;
    }
  }
}

function typeNameOf(field: ZodTypeAny): string {
  return (unwrapField(field)._def as { typeName?: string }).typeName ?? '';
}

function coerceForField(field: ZodTypeAny, raw: string): unknown {
  const base = unwrapField(field);
  const trimmed = raw.trim();
  const looksJson = trimmed.startsWith('[') || trimmed.startsWith('{');

  switch (typeNameOf(base)) {
    case 'ZodNumber':
      return toNumber(raw);
    case 'ZodBoolean':
      return toBoolean(raw);
    case 'ZodArray': {
      if (looksJson) return tryJson(raw);
      const element = (base._def as { type: ZodTypeAny }).type;
      return raw.split(',').map((part) => coerceForField(element, part.trim()));
    }
    case 'ZodObject':
    case 'ZodRecord':
    case 'ZodTuple':
      return looksJson ? tryJson(raw) : raw;
    case 'ZodUnion': {
      if (looksJson) return tryJson(raw);
      const options = (base._def as { options: ZodTypeAny[] }).options;
      if (options.some((o) => typeNameOf(o) === 'ZodNumber') && typeof toNumber(raw) === 'number') return toNumber(raw);
      if (options.some((o) => typeNameOf(o) === 'ZodBoolean') && typeof toBoolean(raw) === 'boolean') return toBoolean(raw);
      return raw;
    }
    default:
      return raw;
  }
}

function toNumber(raw: string): unknown {
  if (raw.trim() === '') return raw;
  const n = Number(raw);
  return Number.isNaN(n) ? raw : n;
}

function toBoolean(raw: string): unknown {
  const v = raw.trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(v)) return true;
  if (['false', '0', 'no', 'n'].includes(v)) return false;
  return raw;
}

function tryJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
