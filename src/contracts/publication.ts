export interface PublicationItem {
  entityId: string;
  versionId: string;
  previousVersionId: string | null;
}

export interface PublicationValidation {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

export interface PublicationManifest {
  publicationId: string;
  publishedAt: string;
  actorId: string;
  approverIds: string[];
  sourceVersions: Record<string, string>;
  items: PublicationItem[];
  affectedRoutes: string[];
  validation: PublicationValidation;
}
