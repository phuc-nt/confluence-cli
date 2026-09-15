import { z } from 'zod';
import type { ToolRegistrar } from '../../utils/tool-registrar.js';
import { ConfluenceApiClient } from '../../utils/confluence-api.js';
import { Logger } from '../../utils/logger.js';
import { ok, failFromError, ErrorCodes } from '../../utils/response-envelope.js';
import { storageToMarkdown } from '../../utils/storage-to-markdown.js';

const logger = new Logger('GetPageContentTool');

export const getPageContentSchema = z.object({
  pageId: z.string().describe('Confluence page ID to retrieve content from'),
  bodyFormat: z
    .enum(['storage', 'atlas_doc_format'])
    .optional()
    .default('storage')
    .describe('Content format to retrieve (default: storage)'),
  raw: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Return the untouched Confluence storage format (XHTML) instead of Markdown. Use when the body must be written back verbatim; the default Markdown is for reading.'
    ),
});

type GetPageContentParams = z.infer<typeof getPageContentSchema>;

export function registerGetPageContentTool(server: ToolRegistrar, apiClient: ConfluenceApiClient) {
  server.tool(
    'getPageContent',
    'Retrieve complete content and metadata of a Confluence page. The body is returned as Markdown (data.representation = "markdown"); pass raw=true to get the original Confluence storage format instead, which is what you need if you intend to write the body back unchanged. Provides page version for updatePage operations. WORKFLOW: Use searchPages first to find page ID, then getPageContent to retrieve content and version. Returns {ok, data, meta} JSON.',
    getPageContentSchema.shape,
    async (params: GetPageContentParams) => {
      const TOOL = 'getPageContent';
      try {
        logger.info('Retrieving Confluence page content');

        const { pageId, bodyFormat, raw } = params;

        logger.debug(`Retrieving page ${pageId} with format ${bodyFormat}`);

        const page = await apiClient.getPageContent(pageId, bodyFormat);

        logger.info(`Page content retrieved successfully: ${page.id}`);

        const storage = page.body?.storage?.value ?? null;
        const adf = page.body?.atlas_doc_format?.value ?? null;

        // Storage format is XHTML with HTML entities: expensive to read and
        // easy to misread. Render it to Markdown unless the caller asked for
        // the original, which it needs to write the body back unchanged.
        const convert = storage !== null && !raw;
        const body = convert ? storageToMarkdown(storage) : (storage ?? adf);
        const representation = convert
          ? 'markdown'
          : storage !== null
            ? 'storage'
            : adf !== null
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
