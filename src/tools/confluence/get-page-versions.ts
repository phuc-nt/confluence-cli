import { z } from 'zod';
import type { ToolRegistrar } from '../../utils/tool-registrar.js';
import { ConfluenceApiClient } from '../../utils/confluence-api.js';
import { Logger } from '../../utils/logger.js';
import { ok, failFromError, ErrorCodes } from '../../utils/response-envelope.js';

const logger = new Logger('GetPageVersionsTool');

export const getPageVersionsSchema = z.object({
  pageId: z.string().describe('Confluence page ID to get version history for'),
  limit: z
    .number()
    .min(1)
    .max(50)
    .optional()
    .default(10)
    .describe('Maximum number of versions to return (default: 10, max: 50)'),
});

type GetPageVersionsParams = z.infer<typeof getPageVersionsSchema>;

export function registerGetPageVersionsTool(server: ToolRegistrar, apiClient: ConfluenceApiClient) {
  server.tool(
    'getPageVersions',
    'Get version history metadata for a Confluence page. Returns version numbers, dates, and messages. Use this before updatePage to get current version number, or to explore page edit history. Returns {ok, data, meta} JSON.',
    getPageVersionsSchema.shape,
    async (params: GetPageVersionsParams) => {
      const TOOL = 'getPageVersions';
      try {
        logger.info('Getting page version history');

        const { pageId, limit } = params;

        logger.debug(`Getting version history for page ${pageId} with limit ${limit}`);
        const versionsData = await apiClient.getPageVersions(pageId, limit);

        const results = versionsData.results || [];
        logger.info(`Retrieved ${results.length} versions for page ${pageId}`);

        if (results.length === 0) {
          return ok(
            { pageId, versions: [], currentVersion: null },
            { tool: TOOL, count: 0, limit }
          );
        }

        const sortedVersions = [...results].sort((a, b) => b.number - a.number);
        const latestVersion = sortedVersions[0];

        return ok(
          {
            pageId,
            versions: sortedVersions.map((version) => ({
              number: version.number,
              createdAt: version.createdAt,
              message: version.message ?? null,
              authorId: version.authorId ?? null,
            })),
            currentVersion: latestVersion.number,
            nextVersion: latestVersion.number + 1,
          },
          { tool: TOOL, count: sortedVersions.length, limit }
        );
      } catch (error) {
        logger.error('Failed to get page versions:', error);
        return failFromError(error, TOOL, {
          [ErrorCodes.NOT_FOUND]: 'Verify pageId exists and you have read permissions.',
        });
      }
    }
  );
}
