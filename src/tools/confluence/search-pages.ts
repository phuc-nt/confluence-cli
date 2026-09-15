import { z } from 'zod';
import type { ToolRegistrar } from '../../utils/tool-registrar.js';
import { ConfluenceApiClient } from '../../utils/confluence-api.js';
import { Logger } from '../../utils/logger.js';
import { ok, fail, failFromError, ErrorCodes } from '../../utils/response-envelope.js';

const logger = new Logger('SearchPagesTool');

export const searchPagesSchema = z.object({
  query: z.string().optional().describe('Search text to find in page titles and content (supports partial matches)'),
  title: z.string().optional().describe('Search specifically in page titles (alternative to query, supports partial matches)'),
  spaceKey: z.string().optional().describe('Limit search to specific space key (e.g., "AWA1", "DOCS") - improves search accuracy'),
  spaceId: z.string().optional().describe('Limit search to specific space ID (alternative to spaceKey, less reliable for search)'),
  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(25)
    .describe('Maximum number of results to return (default: 25, max: 100)'),
  sortBy: z
    .enum(['relevance', 'title', 'created', 'modified'])
    .optional()
    .default('relevance')
    .describe('Sort order for results (default: relevance for best matches)'),
});

type SearchPagesParams = z.infer<typeof searchPagesSchema>;

export function registerSearchPagesTool(server: ToolRegistrar, apiClient: ConfluenceApiClient) {
  server.tool(
    'searchPages',
    'Search for Confluence pages across spaces using text queries or filters. Supports CQL search and content API fallback. Returns page IDs for use with other tools. WORKFLOW: Use this as the first step to find pages, then use page IDs with getPageContent, updatePage, deletePage, or comment tools. Requires at least one of query, title, spaceKey, or spaceId. Returns {ok, data, meta} JSON.',
    searchPagesSchema.shape,
    async (params: SearchPagesParams) => {
      const TOOL = 'searchPages';
      try {
        logger.info('Searching Confluence pages');

        const { query, title, spaceKey, spaceId, limit, sortBy } = params;

        if (!query && !title && !spaceKey && !spaceId) {
          return fail(
            ErrorCodes.INVALID_INPUT,
            'At least one search parameter (query, title, spaceKey, or spaceId) must be provided',
            'Provide at least one: query (text search), title (title search), or spaceKey (space filter).',
            { tool: TOOL }
          );
        }

        let effectiveSpaceKey = spaceKey;
        if (spaceId && !spaceKey) {
          logger.debug(`spaceId provided but spaceKey needed for search: ${spaceId}`);
        }

        logger.debug(`Searching with params: query=${query}, title=${title}, spaceKey=${effectiveSpaceKey}, limit=${limit}`);

        const searchResults = await apiClient.searchPages({
          query,
          title,
          spaceKey: effectiveSpaceKey,
          limit,
          sortBy,
        });

        logger.info(`Search completed via ${searchResults.searchMethod}: found ${searchResults.size} results`);

        const results = searchResults.results.map((page: any) => ({
          id: page.id,
          title: page.title,
          type: page.type,
          spaceKey: page.spaceKey ?? null,
          spaceName: page.spaceName ?? null,
          lastModified: page.lastModified ?? null,
          author: page.author ?? null,
          excerpt: page.excerpt ?? null,
          webui: page.url ?? null,
        }));

        return ok(
          { results },
          {
            tool: TOOL,
            count: results.length,
            limit,
            sortBy,
            searchMethod: searchResults.searchMethod ?? null,
            query: query ?? null,
            title: title ?? null,
            spaceKey: effectiveSpaceKey ?? null,
          }
        );
      } catch (error) {
        logger.error('Failed to search pages:', error);

        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        let hint = 'Check search parameters and API permissions.';
        if (errorMessage.includes('API permissions')) {
          hint =
            'Search requires API permissions. Try using getSpaces to explore spaces, then getPageContent with specific page IDs.';
        }

        return failFromError(error, TOOL, {
          [ErrorCodes.PERMISSION_DENIED]: hint,
          [ErrorCodes.UNKNOWN_ERROR]: hint,
        });
      }
    }
  );
}
