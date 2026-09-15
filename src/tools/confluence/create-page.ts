import { z } from 'zod';
import type { ToolRegistrar } from '../../utils/tool-registrar.js';
import { ConfluenceApiClient } from '../../utils/confluence-api.js';
import { Logger } from '../../utils/logger.js';
import { ok, failFromError, ErrorCodes } from '../../utils/response-envelope.js';
import { ensureStorageFormat } from '../../utils/markdown-to-storage.js';

const logger = new Logger('CreatePageTool');

export const createPageSchema = z.object({
  spaceId: z.string().describe('Confluence space ID where the page will be created'),
  title: z.string().describe('Title of the new page'),
  content: z
    .string()
    .describe(
      'Page content. Markdown is accepted and converted automatically (headings, lists, tables, code blocks, bold/italic, links). Confluence storage format (XHTML) is also accepted and passed through unchanged.'
    ),
  parentId: z.string().optional().describe('Optional parent page ID for creating child pages'),
});

type CreatePageParams = z.infer<typeof createPageSchema>;

export function registerCreatePageTool(server: ToolRegistrar, apiClient: ConfluenceApiClient) {
  server.tool(
    'createPage',
    'Create a new Confluence page in a specified space. WORKFLOW: Use getSpaces first to get space ID, then createPage to create the page. Returns {ok, data, meta} JSON.',
    createPageSchema.shape,
    async (params: CreatePageParams) => {
      const TOOL = 'createPage';
      try {
        logger.info('Creating new Confluence page');

        const { spaceId, title, content, parentId } = params;

        const { content: body, converted } = ensureStorageFormat(content);

        const pageData = {
          spaceId,
          status: 'current' as const,
          title,
          parentId,
          body: {
            representation: 'storage' as const,
            value: body,
          },
        };

        logger.debug('Creating page with data:', { spaceId, title, parentId, converted });

        const createdPage = await apiClient.createPage(pageData);

        logger.info(`Page created successfully: ${createdPage.id}`);

        return ok(
          {
            id: createdPage.id,
            title: createdPage.title,
            spaceId: createdPage.spaceId,
            version: createdPage.version?.number ?? 1,
            webui: createdPage._links?.webui ?? null,
          },
          { tool: TOOL, contentConvertedFromMarkdown: converted }
        );
      } catch (error) {
        logger.error('Failed to create page:', error);
        return failFromError(error, TOOL, {
          [ErrorCodes.NOT_FOUND]: 'Check that spaceId (and parentId, if given) exist.',
        });
      }
    }
  );
}
