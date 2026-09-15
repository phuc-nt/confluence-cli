import { z } from 'zod';
import type { ToolRegistrar } from '../../utils/tool-registrar.js';
import { ConfluenceApiClient } from '../../utils/confluence-api.js';
import { Logger } from '../../utils/logger.js';
import { ok, failFromError, ErrorCodes } from '../../utils/response-envelope.js';

const logger = new Logger('DeletePageTool');

export const deletePageSchema = z.object({
  pageId: z.string().describe('Confluence page ID to delete'),
  draft: z
    .boolean()
    .optional()
    .default(false)
    .describe('Move to draft instead of permanent deletion (optional, default: false)'),
});

type DeletePageParams = z.infer<typeof deletePageSchema>;

export function registerDeletePageTool(server: ToolRegistrar, apiClient: ConfluenceApiClient) {
  server.tool(
    'deletePage',
    'Delete a Confluence page permanently. This action cannot be undone. WORKFLOW: Use searchPages or getPageContent first to confirm page ID, then call deletePage. Returns {ok, data, meta} JSON.',
    deletePageSchema.shape,
    async (params: DeletePageParams) => {
      const TOOL = 'deletePage';
      try {
        logger.info('Deleting Confluence page');

        const { pageId, draft } = params;

        let pageInfo;
        try {
          pageInfo = await apiClient.getPageContent(pageId);
        } catch (error) {
          logger.warn(`Could not retrieve page ${pageId} before deletion:`, error);
        }

        logger.debug(`Deleting page ${pageId}${draft ? ' (moving to draft)' : ''}`);

        await apiClient.deletePage(pageId);

        logger.info(`Page deleted successfully: ${pageId}`);

        return ok(
          {
            id: pageId,
            title: pageInfo?.title ?? null,
            spaceId: pageInfo?.spaceId ?? null,
            action: draft ? 'moved-to-draft' : 'permanently-deleted',
          },
          { tool: TOOL }
        );
      } catch (error) {
        logger.error('Failed to delete page:', error);
        return failFromError(error, TOOL, {
          [ErrorCodes.NOT_FOUND]: 'Page might already be deleted or the ID is incorrect.',
          [ErrorCodes.PERMISSION_DENIED]: 'Check if you have delete permissions for this page.',
        });
      }
    }
  );
}
