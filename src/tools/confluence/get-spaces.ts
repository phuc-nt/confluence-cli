import { z } from 'zod';
import type { ToolRegistrar } from '../../utils/tool-registrar.js';
import { ConfluenceApiClient } from '../../utils/confluence-api.js';
import { Logger } from '../../utils/logger.js';
import { ok, failFromError } from '../../utils/response-envelope.js';

const logger = new Logger('GetSpacesTool');

export const getSpacesSchema = z.object({
  limit: z
    .number()
    .min(1)
    .max(250)
    .optional()
    .default(25)
    .describe('Maximum number of spaces to return (default: 25)'),
});

type GetSpacesParams = z.infer<typeof getSpacesSchema>;

export function registerGetSpacesTool(server: ToolRegistrar, apiClient: ConfluenceApiClient) {
  server.tool(
    'getSpaces',
    'List available Confluence spaces with details and permissions. Space ID can be used with createPage; homepage ID can be used as parentId for child pages. Returns {ok, data, meta} JSON.',
    getSpacesSchema.shape,
    async (params: GetSpacesParams) => {
      const TOOL = 'getSpaces';
      try {
        logger.info('Retrieving Confluence spaces');

        const { limit } = params;

        logger.debug(`Retrieving spaces with limit: ${limit}`);

        const spacesResponse = await apiClient.getSpaces(limit);
        const spaces = spacesResponse.results;

        logger.info(`Retrieved ${spaces.length} spaces successfully`);

        return ok(
          {
            spaces: spaces.map((space) => ({
              id: space.id,
              key: space.key,
              name: space.name,
              type: space.type,
              status: space.status,
              authorId: space.authorId,
              createdAt: space.createdAt,
              homepage: space.homepage
                ? { id: space.homepage.id, title: space.homepage.title }
                : null,
              webui: space._links?.webui ?? null,
            })),
          },
          { tool: TOOL, count: spaces.length, limit }
        );
      } catch (error) {
        logger.error('Failed to retrieve spaces:', error);
        return failFromError(error, TOOL);
      }
    }
  );
}
