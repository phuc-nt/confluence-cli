import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import { Logger } from './logger.js';
import { ErrorHandler } from './error-handler.js';
import { ConfluencePage, ConfluenceSpace, PageCreateRequest, PageUpdateRequest } from '../schemas/confluence.js';

export interface ConfluenceConfig {
  siteName: string;
  email: string;     // Added for Basic Auth
  apiToken: string;
}

export class ConfluenceApiClient {
  private v2Client: AxiosInstance;  // For v2 API endpoints
  private v1Client: AxiosInstance;  // For v1 API endpoints (search, content)
  private config: ConfluenceConfig;
  private logger: Logger;

  constructor(config: ConfluenceConfig) {
    this.config = config;
    this.logger = new Logger('ConfluenceAPI');
    
    // Create Basic Auth string for Confluence Cloud
    const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
    
    // Common headers and config
    const commonConfig = {
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      timeout: 30000, // 30 second timeout
    };

    // V2 API Client (existing functionality)
    this.v2Client = axios.create({
      baseURL: `https://${config.siteName}/wiki/api/v2`,
      ...commonConfig,
    });

    // V1 API Client (search, legacy endpoints)
    this.v1Client = axios.create({
      baseURL: `https://${config.siteName}/wiki/rest/api`,
      ...commonConfig,
    });

    // Add interceptors to both clients
    this.setupInterceptors(this.v2Client, 'v2');
    this.setupInterceptors(this.v1Client, 'v1');
  }

  private setupInterceptors(client: AxiosInstance, apiVersion: string) {
    // Request interceptor for logging
    client.interceptors.request.use(
      (config) => {
        this.logger.debug(`${apiVersion.toUpperCase()} API Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        this.logger.error(`${apiVersion.toUpperCase()} Request interceptor error:`, error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for logging and error handling
    client.interceptors.response.use(
      (response) => {
        this.logger.debug(`${apiVersion.toUpperCase()} API Response: ${response.status} ${response.config.url}`);
        return response;
      },
      (error: AxiosError) => {
        this.logger.error(`${apiVersion.toUpperCase()} API Error: ${error.response?.status} ${error.config?.url}`, error.response?.data);
        return Promise.reject(ErrorHandler.handleApiError(error));
      }
    );
  }

  async testConnection(): Promise<boolean> {
    try {
      this.logger.info('Testing connection to Confluence API...');
      // Use spaces endpoint for v2 API
      const response = await this.v2Client.get('/spaces?limit=1');
      this.logger.info('Connection test successful');
      return response.status === 200;
    } catch (error: any) {
      this.logger.error('Connection test failed:', error);
      
      // If endpoint fails, provide helpful error info
      if (error.response?.status === 404) {
        this.logger.error('API v2 endpoint not found - check if your Confluence instance supports API v2');
      }
      
      return false;
    }
  }

  // Identity of the authenticated account, for credential checks. The v2 API
  // has no user endpoint, so this is the one v1 call made outside search.
  async getCurrentUser(): Promise<{ accountId: string; displayName: string; email: string | null }> {
    try {
      const response = await this.v1Client.get('/user/current');
      const user = response.data ?? {};
      return {
        accountId: user.accountId,
        displayName: user.displayName,
        email: user.email ?? null,
      };
    } catch (error) {
      throw ErrorHandler.handleApiError(error);
    }
  }

  // V2 API Methods (Page Management)

  async createPage(data: PageCreateRequest): Promise<ConfluencePage> {
    try {
      this.logger.info(`Creating page: ${data.title} in space ${data.spaceId}`);
      const response = await this.v2Client.post('/pages', data);
      this.logger.info(`Page created successfully: ${response.data.id}`);
      return response.data;
    } catch (error) {
      throw ErrorHandler.handleApiError(error);
    }
  }

  async getPageContent(pageId: string, bodyFormat: 'storage' | 'atlas_doc_format' = 'storage'): Promise<ConfluencePage> {
    try {
      this.logger.info(`Retrieving page content: ${pageId}`);
      const response = await this.v2Client.get(`/pages/${pageId}?body-format=${bodyFormat}`);
      return response.data;
    } catch (error) {
      throw ErrorHandler.handleApiError(error);
    }
  }

  async updatePage(pageId: string, data: PageUpdateRequest): Promise<ConfluencePage> {
    try {
      this.logger.info(`Updating page: ${pageId}`);
      const response = await this.v2Client.put(`/pages/${pageId}`, data);
      this.logger.info(`Page updated successfully: ${pageId}`);
      return response.data;
    } catch (error) {
      throw ErrorHandler.handleApiError(error);
    }
  }

  async deletePage(pageId: string): Promise<void> {
    try {
      this.logger.info(`Deleting page: ${pageId}`);
      await this.v2Client.delete(`/pages/${pageId}`);
      this.logger.info(`Page deleted successfully: ${pageId}`);
    } catch (error) {
      throw ErrorHandler.handleApiError(error);
    }
  }

  async getSpaces(limit: number = 25): Promise<{ results: ConfluenceSpace[] }> {
    try {
      this.logger.info('Retrieving spaces list');
      this.logger.debug(`Making request to /spaces?limit=${limit}`);
      
      // Use v2 API endpoint
      const response = await this.v2Client.get(`/spaces?limit=${limit}`);
      
      this.logger.debug(`Response status: ${response.status}`);
      this.logger.debug(`Response data:`, JSON.stringify(response.data, null, 2));
      
      return response.data; // v2 API already has { results: [...] } format
    } catch (error) {
      this.logger.error('getSpaces failed:', error);
      throw ErrorHandler.handleApiError(error);
    }
  }

  async getPageVersions(pageId: string, limit: number = 10): Promise<{ results: any[] }> {
    try {
      this.logger.info(`Retrieving version history for page: ${pageId}`);
      this.logger.debug(`Making request to /pages/${pageId}/versions?limit=${limit}`);
      
      const response = await this.v2Client.get(`/pages/${pageId}/versions?limit=${limit}`);
      
      this.logger.debug(`Response status: ${response.status}`);
      this.logger.debug(`Found ${response.data.results?.length || 0} versions`);
      
      return response.data;
    } catch (error) {
      this.logger.error('getPageVersions failed:', error);
      throw ErrorHandler.handleApiError(error);
    }
  }

  async getPageComments(pageId: string, limit: number = 25, cursor?: string): Promise<any> {
    try {
      this.logger.info(`Getting comments for page: ${pageId}`);
      
      let url = `/pages/${pageId}/footer-comments?limit=${limit}&body-format=storage`;
      if (cursor) {
        url += `&cursor=${cursor}`;
      }

      const response = await this.v2Client.get(url);
      
      this.logger.info(`Retrieved ${response.data.results?.length || 0} comments for page ${pageId}`);
      
      return {
        results: response.data.results || [],
        _links: response.data._links || {},
        limit: limit,
        size: response.data.results?.length || 0
      };
    } catch (error) {
      this.logger.error(`Failed to get comments for page ${pageId}:`, error);
      throw ErrorHandler.handleApiError(error);
    }
  }

  async addComment(pageId: string, content: string, parentId?: string): Promise<any> {
    try {
      this.logger.info(`Adding comment to page: ${pageId}${parentId ? ` (reply to: ${parentId})` : ''}`);
      
      const requestBody: any = {
        pageId: pageId,
        body: {
          representation: 'storage',
          value: content
        }
      };

      if (parentId) {
        requestBody.parentId = parentId;
      }

      const response = await this.v2Client.post('/footer-comments', requestBody);
      
      this.logger.info(`Successfully added comment: ${response.data.id}`);
      
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to add comment to page ${pageId}:`, error);
      throw ErrorHandler.handleApiError(error);
    }
  }

  async updateComment(commentId: string, content: string, version: number): Promise<any> {
    try {
      this.logger.info(`Updating comment: ${commentId} to version ${version}`);
      
      const requestBody = {
        body: {
          representation: 'storage',
          value: content
        },
        version: {
          number: version
        }
      };

      const response = await this.v2Client.put(`/footer-comments/${commentId}`, requestBody);
      
      this.logger.info(`Successfully updated comment: ${commentId} to version ${response.data.version.number}`);
      
      return response.data;
    } catch (error) {
      this.logger.error(`Failed to update comment ${commentId}:`, error);
      throw ErrorHandler.handleApiError(error);
    }
  }

  async deleteComment(commentId: string): Promise<void> {
    try {
      this.logger.info(`Deleting comment: ${commentId}`);
      
      await this.v2Client.delete(`/footer-comments/${commentId}`);
      
      this.logger.info(`Successfully deleted comment: ${commentId}`);
    } catch (error) {
      this.logger.error(`Failed to delete comment ${commentId}:`, error);
      throw ErrorHandler.handleApiError(error);
    }
  }

  // V1 API Methods (Search & Content Discovery)

  async searchPages(searchParams: {
    query?: string;
    title?: string;
    spaceKey?: string;
    spaceId?: string;
    limit?: number;
    sortBy?: 'relevance' | 'title' | 'created' | 'modified';
  }): Promise<{ results: any[]; size: number; limit: number; searchMethod?: string }> {
    try {
      this.logger.info(`Searching pages with params: ${JSON.stringify(searchParams)}`);
      
      const limit = searchParams.limit || 25;
      
      // Strategy 1: Try CQL Search (v1 API)
      if (searchParams.query || searchParams.title) {
        try {
          this.logger.debug('Attempting CQL search via v1 API');
          const cqlResult = await this.searchWithCQL(searchParams);
          return { ...cqlResult, searchMethod: 'CQL' };
        } catch (error) {
          this.logger.warn('CQL search failed, trying content API fallback:', error);
        }
      }
      
      // Strategy 2: Try Content API (v1 API fallback)
      if (searchParams.spaceKey) {
        try {
          this.logger.debug('Attempting content API fallback');
          const contentResult = await this.searchWithContentAPI(searchParams);
          return { ...contentResult, searchMethod: 'Content API' };
        } catch (error) {
          this.logger.warn('Content API fallback failed:', error);
        }
      }
      
      // Strategy 3: Guidance response when APIs are restricted
      throw new Error('Search functionality requires API permissions that are not available. Please provide specific page IDs or use getSpaces to explore available spaces.');
      
    } catch (error) {
      this.logger.error('All search strategies failed:', error);
      throw ErrorHandler.handleApiError(error);
    }
  }

  private async searchWithCQL(params: {
    query?: string;
    title?: string;
    spaceKey?: string;
    limit?: number;
    sortBy?: string;
  }): Promise<{ results: any[]; size: number; limit: number }> {
    const cqlParts = ['type=page'];
    
    // Add space filter
    if (params.spaceKey) {
      cqlParts.push(`space="${params.spaceKey}"`);
    }
    
    // Add search terms
    if (params.query) {
      cqlParts.push(`(title~"${params.query}*" OR text~"${params.query}")`);
    } else if (params.title) {
      cqlParts.push(`title~"${params.title}*"`);
    }
    
    const cql = cqlParts.join(' AND ');
    
    const queryParams = new URLSearchParams({
      cql: cql,
      limit: (params.limit || 25).toString(),
      start: '0'
    });
    
    // Use v1 client for search endpoint
    const response = await this.v1Client.get(`/search?${queryParams}`);
    
    return {
      results: response.data.results?.map(this.transformCQLResult.bind(this)) || [],
      size: response.data.size || 0,
      limit: response.data.limit || params.limit || 25
    };
  }

  private async searchWithContentAPI(params: {
    spaceKey?: string;
    title?: string;
    limit?: number;
  }): Promise<{ results: any[]; size: number; limit: number }> {
    const queryParams = new URLSearchParams({
      type: 'page',
      limit: (params.limit || 25).toString(),
      expand: 'version,space'
    });
    
    if (params.spaceKey) {
      queryParams.append('spaceKey', params.spaceKey);
    }
    
    if (params.title) {
      queryParams.append('title', params.title);
    }
    
    // Use v1 client for content endpoint
    const response = await this.v1Client.get(`/content?${queryParams}`);
    
    return {
      results: response.data.results?.map(this.transformV1ContentResult.bind(this)) || [],
      size: response.data.size || 0,
      limit: response.data.limit || params.limit || 25
    };
  }

  private transformCQLResult(result: any): any {
    return {
      id: result.content?.id || result.id,
      title: result.title || result.content?.title,
      type: result.content?.type || 'page',
      spaceKey: result.space?.key,
      spaceName: result.space?.name,
      url: result.url || result._links?.webui,
      excerpt: result.excerpt || '',
      lastModified: result.lastModified || result.content?.version?.when,
      author: {
        displayName: result.content?.version?.by?.displayName || 'Unknown',
        accountId: result.content?.version?.by?.accountId
      }
    };
  }

  private transformV1ContentResult(result: any): any {
    return {
      id: result.id,
      title: result.title,
      type: result.type,
      spaceKey: result.space?.key,
      spaceName: result.space?.name,
      url: result._links?.webui,
      lastModified: result.version?.when,
      author: {
        displayName: result.version?.by?.displayName || 'Unknown',
        accountId: result.version?.by?.accountId
      }
    };
  }
}