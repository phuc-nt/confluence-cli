import { z } from 'zod';
import type { ToolRegistrar } from '../../utils/tool-registrar.js';
import { ConfluenceApiClient } from '../../utils/confluence-api.js';
import { Logger } from '../../utils/logger.js';
import { ok, fail, failFromError, ErrorCodes } from '../../utils/response-envelope.js';
import { ensureStorageFormat } from '../../utils/markdown-to-storage.js';

const logger = new Logger('UpdateCommentTool');

export const updateCommentSchema = z.object({
  commentId: z.string().describe('The ID of the comment to update'),
  content: z
    .string()
    .describe(
      'The new comment content. Markdown is accepted and converted automatically (headings, lists, tables, code blocks, bold/italic, links). Confluence storage format (XHTML) is also accepted and passed through unchanged. Example: "Updated comment text" or "<p>Updated comment text</p>"'
    ),
  version: z
    .number()
    .min(1)
    .describe(
      'The current version number of the comment (API will increment to next version). Get from getPageComments response.'
    ),
});

type UpdateCommentParams = z.infer<typeof updateCommentSchema>;

export function registerUpdateCommentTool(server: ToolRegistrar, apiClient: ConfluenceApiClient) {
  server.tool(
    'updateComment',
    'Update the content of an existing Confluence comment. Requires the comment ID and current version number for conflict resolution. WORKFLOW: Use getPageComments first to get current version, then call updateComment with that version. Returns {ok, data, meta} JSON.',
    updateCommentSchema.shape,
    async (params: UpdateCommentParams) => {
      const TOOL = 'updateComment';
      try {
        logger.info('Updating comment');

        const { commentId, content, version } = params;

        const textContent = content.replace(/<[^>]*>/g, '').trim();
        if (textContent.length === 0) {
          return fail(ErrorCodes.INVALID_INPUT, 'content cannot be empty', undefined, { tool: TOOL });
        }

        const { content: body, converted } = ensureStorageFormat(content);

        const nextVersion = version + 1;
        const commentData = await apiClient.updateComment(commentId, body, nextVersion);

        logger.info(`Successfully updated comment: ${commentData.id} to version ${commentData.version.number}`);

        return ok(
          {
            id: commentData.id,
            previousVersion: version,
            version: commentData.version?.number ?? nextVersion,
            updatedAt: commentData.version?.createdAt ?? null,
            webui: commentData._links?.webui ?? null,
          },
          { tool: TOOL, contentConvertedFromMarkdown: converted }
        );
      } catch (error) {
        logger.error('Failed to update comment:', error);
        return failFromError(error, TOOL, {
          [ErrorCodes.CONFLICT]:
            'Version conflict. Call getPageComments to read the current version, then retry.',
          [ErrorCodes.PERMISSION_DENIED]: 'Ensure you have permission to edit the comment.',
        });
      }
    }
  );
}
