import { z } from 'zod';
import type { ToolRegistrar } from '../../utils/tool-registrar.js';
import { ConfluenceApiClient } from '../../utils/confluence-api.js';
import { Logger } from '../../utils/logger.js';
import { ok, fail, failFromError, ErrorCodes } from '../../utils/response-envelope.js';
import { ensureStorageFormat } from '../../utils/markdown-to-storage.js';

const logger = new Logger('UpdatePageTool');

export const updatePageSchema = z.object({
  pageId: z.string().describe('Confluence page ID to update'),
  title: z.string().optional().describe('New page title (optional if only updating content)'),
  content: z
    .string()
    .optional()
    .describe(
      'New page content (optional if only updating title). Markdown is accepted and converted automatically; Confluence storage format (XHTML) passes through unchanged.'
    ),
  version: z.number().describe('Current page version number (required for optimistic locking)'),
  versionMessage: z
    .string()
    .optional()
    .default('Updated page via MCP')
    .describe('Optional message describing the changes made'),
});

type UpdatePageParams = z.infer<typeof updatePageSchema>;

export function registerUpdatePageTool(server: ToolRegistrar, apiClient: ConfluenceApiClient) {
  server.tool(
    'updatePage',
    'Update title and/or content of an existing Confluence page. Requires current version for conflict resolution. WORKFLOW: Use getPageContent or getPageVersions first to get current version, then call updatePage with that version. Requires at least one of title or content. Returns {ok, data, meta} JSON.',
    updatePageSchema.shape,
    async (params: UpdatePageParams) => {
      const TOOL = 'updatePage';
      try {
        logger.info('Updating Confluence page');

        const { pageId, title, content, version, versionMessage } = params;

        if (!title && !content) {
          return fail(
            ErrorCodes.INVALID_INPUT,
            'At least one of title or content must be provided for update',
            undefined,
            { tool: TOOL }
          );
        }

        logger.debug(`Getting current page data for ${pageId}`);
        const currentPage = await apiClient.getPageContent(pageId);

        const normalized = content ? ensureStorageFormat(content) : null;

        const updateData = {
          id: pageId,
          status: 'current' as const,
          title: title || currentPage.title,
          body: {
            representation: 'storage' as const,
            value: normalized?.content ?? currentPage.body?.storage?.value ?? '',
          },
          version: {
            number: version,
            message: versionMessage || `Updated page via MCP`,
          },
        };

        logger.debug(`Updating page ${pageId} with version ${version}`);

        const updatedPage = await apiClient.updatePage(pageId, updateData);

        logger.info(
          `Page updated successfully: ${updatedPage.id} (version ${updatedPage.version?.number})`
        );

        const changed: string[] = [];
        if (title && title !== currentPage.title) changed.push('title');
        if (content) changed.push('content');

        return ok(
          {
            id: updatedPage.id,
            title: updatedPage.title,
            previousVersion: currentPage.version?.number ?? null,
            version: updatedPage.version?.number ?? version,
            changed,
            webui: updatedPage._links?.webui ?? null,
          },
          {
            tool: TOOL,
            contentConvertedFromMarkdown: normalized?.converted ?? false,
            versionMessage: versionMessage || 'Updated page via MCP',
          }
        );
      } catch (error) {
        logger.error('Failed to update page:', error);
        return failFromError(error, TOOL, {
          [ErrorCodes.CONFLICT]:
            'Version conflict. Call getPageContent to read the current version, then retry with version + 1.',
          [ErrorCodes.INVALID_INPUT]:
            'Confluence rejected the version number. Read the current version and retry.',
        });
      }
    }
  );
}
