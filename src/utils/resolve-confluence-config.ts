import type { ConfluenceConfig } from './confluence-api.js';

/**
 * Credentials come from `CONFLUENCE_*` first, then from the `ATLASSIAN_*`
 * names the sibling Jira server uses, so one API token configured once serves
 * both Jira and Confluence on the same site.
 */
const ENV_NAMES = {
  siteName: ['CONFLUENCE_SITE_NAME', 'ATLASSIAN_SITE_NAME'],
  email: ['CONFLUENCE_EMAIL', 'ATLASSIAN_USER_EMAIL'],
  apiToken: ['CONFLUENCE_API_TOKEN', 'ATLASSIAN_API_TOKEN'],
} as const;

type Field = keyof typeof ENV_NAMES;

export interface ResolvedConfluenceConfig {
  /** Null when at least one field is missing. */
  config: ConfluenceConfig | null;
  /** Which variable supplied each field, for diagnostics. Never the values. */
  sources: Partial<Record<Field, string>>;
  /** Human-readable names of the fields still missing. */
  missing: string[];
}

export const CREDENTIAL_HELP =
  'CONFLUENCE_SITE_NAME, CONFLUENCE_EMAIL, CONFLUENCE_API_TOKEN\n' +
  '  (or ATLASSIAN_SITE_NAME, ATLASSIAN_USER_EMAIL, ATLASSIAN_API_TOKEN)';

export function resolveConfluenceConfig(
  env: NodeJS.ProcessEnv = process.env
): ResolvedConfluenceConfig {
  const values: Partial<Record<Field, string>> = {};
  const sources: Partial<Record<Field, string>> = {};
  const missing: string[] = [];

  for (const field of Object.keys(ENV_NAMES) as Field[]) {
    const name = ENV_NAMES[field].find((n) => env[n]?.trim());
    if (name) {
      values[field] = env[name]!.trim();
      sources[field] = name;
    } else {
      missing.push(ENV_NAMES[field].join(' or '));
    }
  }

  if (missing.length > 0) return { config: null, sources, missing };

  return {
    config: {
      siteName: normalizeSiteName(values.siteName!),
      email: values.email!,
      apiToken: values.apiToken!,
    },
    sources,
    missing,
  };
}

/**
 * The API client builds `https://<siteName>/wiki/...`, so accept the forms
 * people paste ("https://acme.atlassian.net/wiki/", "acme") and reduce them to
 * the bare host.
 */
export function normalizeSiteName(raw: string): string {
  let host = raw.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  host = host.replace(/\/wiki$/i, '');
  if (!host.includes('.')) host = `${host}.atlassian.net`;
  return host;
}
