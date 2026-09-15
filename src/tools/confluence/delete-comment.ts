import { z } from 'zod';
import type { ToolRegistrar } from '../../utils/tool-registrar.js';
import { ConfluenceApiClient } from '../../utils/confluence-api.js';
import { Logger } from '../../utils/logger.js';
import { ok, failFromError, ErrorCodes } from '../../utils/response-envelope.js';

const logger = new Logger('DeleteCommentTool');

export const deleteCommentSchema = z.object({
  commentId: z.string().describe('The ID of the comment to delete'),
});

type DeleteCommentParams = z.infer<typeof deleteCommentSchema>;

export function registerDeleteCommentTool(server: ToolRegistrar, apiClient: ConfluenceApiClient) {
  server.tool(
    'deleteComment',
    'Permanently delete a Confluence comment. This action cannot be undone and will remove the comment and all its replies. WORKFLOW: Use getPageComments first to get comment ID, then call deleteComment. Returns {ok, data, meta} JSON.',
    deleteCommentSchema.shape,
    async (params: DeleteCommentParams) => {
      const TOOL = 'deleteComment';
      try {
        logger.info('Deleting comment');

        const { commentId } = params;

        await apiClient.deleteComment(commentId);

        logger.info(`Successfully deleted comment: ${commentId}`);

        return ok(
          {
            id: commentId,
            status: 'permanently-removed',
          },
          { tool: TOOL }
        );
      } catch (error) {
        logger.error('Failed to delete comment:', error);
        return failFromError(error, TOOL, {
          [ErrorCodes.NOT_FOUND]: 'Check the comment ID; it may already be deleted.',
          [ErrorCodes.PERMISSION_DENIED]: 'Ensure you have permission to delete the comment.',
        });
      }
    }
  );
}
