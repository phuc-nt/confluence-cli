/**
 * Shared MCP response envelope.
 *
 * Every tool in this server returns exactly one text block containing JSON in
 * one of two shapes:
 *
 *   success -> { ok: true,  data: {...}, meta: {...} }
 *   failure -> { ok: false, error: { code, message, hint? }, meta: {...} }
 *
 * The same contract is mirrored in the sibling Jira and Slack MCP servers so an
 * AI client can parse any of the three the same way. Keep this file in sync
 * across those repos when the contract changes.
 */

/** Stable, machine-readable error codes shared by all three MCP servers. */
export const ErrorCodes = {
  // Auth & permissions
  AUTH_FAILED: 'AUTH_FAILED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  // Request shape
  INVALID_INPUT: 'INVALID_INPUT',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  // Upstream
  RATE_LIMITED: 'RATE_LIMITED',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface EnvelopeMeta {
  /** Tool name, so multi-call transcripts stay attributable. */
  tool?: string;
  [key: string]: unknown;
}

/** MCP tool result: a single text block plus the protocol-level error flag. */
export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

function serialize(payload: unknown): McpToolResult['content'] {
  return [{ type: 'text', text: JSON.stringify(payload, null, 2) }];
}

/** Build a success envelope. */
export function ok(data: unknown, meta: EnvelopeMeta = {}): McpToolResult {
  return {
    content: serialize({ ok: true, data, meta }),
    isError: false,
  };
}

/** Build a failure envelope. `hint` should tell the caller how to recover. */
export function fail(
  code: ErrorCode,
  message: string,
  hint?: string,
  meta: EnvelopeMeta = {}
): McpToolResult {
  return {
    content: serialize({
      ok: false,
      error: { code, message, ...(hint ? { hint } : {}) },
      meta,
    }),
    isError: true,
  };
}

/**
 * Map an arbitrary thrown value onto a failure envelope.
 *
 * Recognises axios-style `error.response.status` first, then falls back to
 * scanning the message for status codes, since some call paths rethrow plain
 * Errors carrying only text.
 */
export function failFromError(
  error: unknown,
  tool: string,
  hints: Partial<Record<ErrorCode, string>> = {}
): McpToolResult {
  const anyErr = error as any;
  // ConfluenceApiError carries the status flat on the error; axios puts it
  // under `response`. Read both, or a 409 from the API client arrives here
  // looking like an unknown failure.
  const status: number | undefined =
    typeof anyErr?.status === 'number' ? anyErr.status : anyErr?.response?.status;
  const rawMessage: string =
    anyErr?.response?.data?.message || anyErr?.message || 'Unknown error';

  let code: ErrorCode = ErrorCodes.UNKNOWN_ERROR;

  if (status === 401) code = ErrorCodes.AUTH_FAILED;
  else if (status === 403) code = ErrorCodes.PERMISSION_DENIED;
  else if (status === 404) code = ErrorCodes.NOT_FOUND;
  else if (status === 409) code = ErrorCodes.CONFLICT;
  else if (status === 429) code = ErrorCodes.RATE_LIMITED;
  else if (typeof status === 'number' && status >= 400) code = ErrorCodes.UPSTREAM_ERROR;
  // The API client rethrows McpError whose text starts with the phrases the
  // error handler chose, so match those as well as bare status codes.
  else if (/\b401\b|unauthorized|authentication failed/i.test(rawMessage)) code = ErrorCodes.AUTH_FAILED;
  else if (/\b403\b|forbidden|permission|access denied/i.test(rawMessage)) code = ErrorCodes.PERMISSION_DENIED;
  else if (/\b404\b|not found/i.test(rawMessage)) code = ErrorCodes.NOT_FOUND;
  else if (/\b409\b|conflict|version must be incremented/i.test(rawMessage))
    code = ErrorCodes.CONFLICT;
  else if (/\b429\b|rate limit/i.test(rawMessage)) code = ErrorCodes.RATE_LIMITED;
  else if (/network|ECONNREFUSED|ETIMEDOUT|ENOTFOUND/i.test(rawMessage))
    code = ErrorCodes.NETWORK_ERROR;

  const defaultHints: Partial<Record<ErrorCode, string>> = {
    [ErrorCodes.AUTH_FAILED]:
      'Check CONFLUENCE_EMAIL and CONFLUENCE_API_TOKEN environment variables.',
    [ErrorCodes.PERMISSION_DENIED]:
      'The account is authenticated but lacks permission for this resource.',
    [ErrorCodes.RATE_LIMITED]: 'Slow down and retry after a short delay.',
  };

  const hint = hints[code] ?? defaultHints[code];

  return fail(code, rawMessage, hint, { tool, ...(status ? { status } : {}) });
}
