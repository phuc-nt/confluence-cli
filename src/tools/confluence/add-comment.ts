import { z } from 'zod';
import type { ToolRegistrar } from '../../utils/tool-registrar.js';
import { ConfluenceApiClient } from '../../utils/confluence-api.js';
import { Logger } from '../../utils/logger.js';
import { ok, fail, failFromError, ErrorCodes } from '../../utils/response-envelope.js';
import { ensureStorageFormat } from '../../utils/markdown-to-storage.js';

const logger = new Logger('AddCommentTool');

export const addCommentSchema = z.object({
  pageId: z.string().describe('The ID of the Confluence page to add the comment to'),
  content: z
    .string()
    .describe(
      'The comment content. Markdown is accepted and converted automatically (headings, lists, tables, code blocks, bold/italic, links). Confluence storage format (XHTML) is also accepted and passed through unchanged. Example: "This is a comment" or "<p>This is a comment</p>"'
    ),
  parentId: z.string().optional().describe('Optional ID of parent comment to reply to (creates a threaded reply)'),
});

type AddCommentParams = z.infer<typeof addCommentSchema>;

export function registerAddCommentTool(server: ToolRegistrar, apiClient: ConfluenceApiClient) {
  server.tool(
    'addComment',
    'Add a new footer comment to a Confluence page. Supports both top-level comments and replies to existing comments. WORKFLOW: For replies, use getPageComments first to get parent comment ID. Returns {ok, data, meta} JSON.',
    addCommentSchema.shape,
    async (params: AddCommentParams) => {
      const TOOL = 'addComment';
      try {
        logger.info('Adding comment to page');

        const { pageId, content, parentId } = params;

        const textContent = content.replace(/<[^>]*>/g, '').trim();
        if (textContent.length === 0) {
          return fail(ErrorCodes.INVALID_INPUT, 'content cannot be empty', undefined, { tool: TOOL });
        }

        const { content: body, converted } = ensureStorageFormat(content);

        const commentData = await apiClient.addComment(pageId, body, parentId);

        logger.info(`Successfully added comment: ${commentData.id}`);

        return ok(
          {
            id: commentData.id,
            pageId,
            parentId: parentId ?? null,
            version: commentData.version?.number ?? 1,
            createdAt: commentData.createdAt ?? commentData.version?.createdAt ?? null,
            webui: commentData._links?.webui ?? null,
          },
          { tool: TOOL, contentConvertedFromMarkdown: converted }
        );
      } catch (error) {
        logger.error('Failed to add comment:', error);
        return failFromError(error, TOOL, {
          [ErrorCodes.NOT_FOUND]: 'Ensure the page exists and you have permission to add comments.',
        });
      }
    }
  );
}
