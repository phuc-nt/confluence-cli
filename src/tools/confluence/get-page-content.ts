import { z } from 'zod';
import type { ToolRegistrar } from '../../utils/tool-registrar.js';
import { ConfluenceApiClient } from '../../utils/confluence-api.js';
import { Logger } from '../../utils/logger.js';
import { ok, failFromError, ErrorCodes } from '../../utils/response-envelope.js';

const logger = new Logger('GetPageContentTool');

export const getPageContentSchema = z.object({
  pageId: z.string().describe('Confluence page ID to retrieve content from'),
  bodyFormat: z
    .enum(['storage', 'atlas_doc_format'])
    .optional()
    .default('storage')
    .describe('Content format to retrieve (default: storage)'),
});

type GetPageContentParams = z.infer<typeof getPageContentSchema>;

export function registerGetPageContentTool(server: ToolRegistrar, apiClient: ConfluenceApiClient) {
  server.tool(
    'getPageContent',
    'Retrieve complete content and metadata of a Confluence page. Provides page version for updatePage operations. WORKFLOW: Use searchPages first to find page ID, then getPageContent to retrieve content and version. Returns {ok, data, meta} JSON.',
    getPageContentSchema.shape,
    async (params: GetPageContentParams) => {
      const TOOL = 'getPageContent';
      try {
        logger.info('Retrieving Confluence page content');

        const { pageId, bodyFormat } = params;

        logger.debug(`Retrieving page ${pageId} with format ${bodyFormat}`);

        const page = await apiClient.getPageContent(pageId, bodyFormat);

        logger.info(`Page content retrieved successfully: ${page.id}`);

        const body = page.body?.storage?.value ?? page.body?.atlas_doc_format?.value ?? null;
        const representation = page.body?.storage
          ? 'storage'
          : page.body?.atlas_doc_format
            ? 'atlas_doc_format'
            : null;

        return ok(
          {
            id: page.id,
            title: page.title,
            spaceId: page.spaceId,
            version: page.version?.number ?? 1,
            authorId: page.authorId,
            createdAt: page.createdAt,
            body,
            representation,
            webui: page._links?.webui ?? null,
          },
          { tool: TOOL }
        );
      } catch (error) {
        logger.error('Failed to retrieve page content:', error);
        return failFromError(error, TOOL, {
          [ErrorCodes.NOT_FOUND]: 'Check that pageId exists, or call searchPages to find it.',
        });
      }
    }
  );
}
