import { z } from 'zod';
import type { ToolRegistrar } from '../../utils/tool-registrar.js';
import { ConfluenceApiClient } from '../../utils/confluence-api.js';
import { Logger } from '../../utils/logger.js';
import { ok, failFromError, ErrorCodes } from '../../utils/response-envelope.js';
import { storageToMarkdown } from '../../utils/storage-to-markdown.js';

const logger = new Logger('GetPageCommentsTool');

export const getPageCommentsSchema = z.object({
  pageId: z.string().describe('The ID of the Confluence page to get comments from'),
  limit: z
    .number()
    .min(1)
    .max(100)
    .optional()
    .default(25)
    .describe('Maximum number of comments to return (default: 25, max: 100)'),
  cursor: z.string().optional().describe('Pagination cursor for retrieving next batch of comments (optional)'),
  raw: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Return comment bodies as untouched Confluence storage format (XHTML) instead of Markdown.'
    ),
});

type GetPageCommentsParams = z.infer<typeof getPageCommentsSchema>;

export function registerGetPageCommentsTool(server: ToolRegistrar, apiClient: ConfluenceApiClient) {
  server.tool(
    'getPageComments',
    'Retrieve all footer comments for a specific Confluence page. Returns comment IDs, content, authors, and creation dates for analysis and management. Comment bodies are returned as Markdown; pass raw=true for the original Confluence storage format. Returns {ok, data, meta} JSON.',
    getPageCommentsSchema.shape,
    async (params: GetPageCommentsParams) => {
      const TOOL = 'getPageComments';
      try {
        logger.info('Getting page comments');

        const { pageId, limit, cursor, raw } = params;

        const commentsData = await apiClient.getPageComments(pageId, limit, cursor);

        logger.info(`Retrieved ${commentsData.size} comments for page ${pageId}`);

        const comments = (commentsData.results || []).map((comment: any) => {
          const storage = comment.body?.storage?.value ?? null;
          return {
            id: comment.id,
            version: comment.version?.number ?? 1,
            authorId: comment.authorId ?? comment.version?.authorId ?? null,
            createdAt: comment.createdAt ?? comment.version?.createdAt ?? null,
            parentCommentId: comment.parentCommentId ?? null,
            body: storage === null || raw ? storage : storageToMarkdown(storage),
            webui: comment._links?.webui ?? null,
          };
        });

        return ok(
          {
            pageId,
            comments,
          },
          {
            tool: TOOL,
            count: comments.length,
            limit,
            nextCursor: commentsData._links?.next ?? null,
          }
        );
      } catch (error) {
        logger.error('Failed to get page comments:', error);
        return failFromError(error, TOOL, {
          [ErrorCodes.NOT_FOUND]: 'Ensure the page ID exists and you have permission to view comments.',
        });
      }
    }
  );
}
