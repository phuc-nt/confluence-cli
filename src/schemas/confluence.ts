export interface ConfluencePage {
  id: string;
  status: string;
  title: string;
  spaceId: string;
  parentId?: string;
  authorId: string;
  createdAt: string;
  version: {
    number: number;
    message?: string;
    minorEdit: boolean;
    authorId: string;
    createdAt: string;
  };
  body?: {
    storage?: {
      value: string;
      representation: 'storage';
    };
    atlas_doc_format?: {
      value: string;
      representation: 'atlas_doc_format';
    };
  };
  _links: {
    editui: string;
    webui: string;
  };
}

export interface ConfluenceSpace {
  id: string;
  key: string;
  name: string;
  type: string;
  status: string;
  authorId: string;
  createdAt: string;
  homepage?: {
    id: string;
    title: string;
  };
  description?: {
    plain: {
      value: string;
      representation: 'plain';
    };
  };
  _links: {
    webui: string;
  };
}

export interface ConfluenceComment {
  id: string;
  status: string;
  title: string;
  pageId: string;
  parentCommentId?: string;
  version: {
    number: number;
    authorId: string;
    createdAt: string;
  };
  body: {
    storage: {
      value: string;
      representation: 'storage';
    };
  };
  _links: {
    webui: string;
  };
}

export interface PageCreateRequest {
  spaceId: string;
  status: 'current' | 'draft';
  title: string;
  parentId?: string;
  body: {
    representation: 'storage' | 'atlas_doc_format';
    value: string;
  };
}

export interface PageUpdateRequest {
  id: string;
  status: 'current' | 'draft';
  title: string;
  body: {
    representation: 'storage' | 'atlas_doc_format';
    value: string;
  };
  version: {
    number: number;
    message?: string;
  };
}