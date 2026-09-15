/**
 * Error raised for a failed Confluence API call.
 *
 * The message starts with a fixed phrase per failure class ("Authentication
 * failed:", "Access denied:", "Resource not found:", "Rate limit exceeded:",
 * "API error <status>:", "Network error:"). response-envelope.ts maps those
 * phrases, and `status`, to the stable error codes of the envelope.
 */
export class ConfluenceApiError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ConfluenceApiError';
    this.status = status;
  }
}

export class ErrorHandler {
  static handleApiError(error: any): ConfluenceApiError {
    if (error instanceof ConfluenceApiError) return error;

    if (error.response) {
      const status: number = error.response.status;
      const message = error.response.data?.message || error.message;

      switch (status) {
        case 401:
          return new ConfluenceApiError(
            `Authentication failed: ${message} (check CONFLUENCE_API_TOKEN / CONFLUENCE_EMAIL)`,
            status
          );
        case 403:
          return new ConfluenceApiError(
            `Access denied: ${message} (check CONFLUENCE_API_TOKEN / CONFLUENCE_EMAIL and account permissions)`,
            status
          );
        case 404:
          return new ConfluenceApiError(`Resource not found: ${message}`, status);
        case 429:
          return new ConfluenceApiError(`Rate limit exceeded: ${message}`, status);
        default:
          return new ConfluenceApiError(`API error ${status}: ${message}`, status);
      }
    }

    return new ConfluenceApiError(`Network error: ${error.message}`);
  }
}
