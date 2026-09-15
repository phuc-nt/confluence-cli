import type { ToolRegistrar } from '../../utils/tool-registrar.js';
import { ConfluenceApiClient } from '../../utils/confluence-api.js';
import { Logger } from '../../utils/logger.js';
import { registerCreatePageTool } from './create-page.js';
import { registerGetPageContentTool } from './get-page-content.js';
import { registerUpdatePageTool } from './update-page.js';
import { registerDeletePageTool } from './delete-page.js';
import { registerGetSpacesTool } from './get-spaces.js';
import { registerGetPageVersionsTool } from './get-page-versions.js';
import { registerSearchPagesTool } from './search-pages.js';
import { registerGetPageCommentsTool } from './get-page-comments.js';
import { registerAddCommentTool } from './add-comment.js';
import { registerUpdateCommentTool } from './update-comment.js';
import { registerDeleteCommentTool } from './delete-comment.js';

const logger = new Logger('ToolRegistry');

const TOOL_REGISTRARS = [
  registerCreatePageTool,
  registerGetPageContentTool,
  registerUpdatePageTool,
  registerDeletePageTool,
  registerGetSpacesTool,
  registerGetPageVersionsTool,
  registerSearchPagesTool,
  registerGetPageCommentsTool,
  registerAddCommentTool,
  registerUpdateCommentTool,
  registerDeleteCommentTool,
];

/**
 * Register all Confluence tools with the MCP server.
 */
export function registerConfluenceTools(server: ToolRegistrar, apiClient: ConfluenceApiClient): void {
  for (const register of TOOL_REGISTRARS) {
    register(server, apiClient);
  }
  logger.info(`${TOOL_REGISTRARS.length} Confluence tools registered`);
}
