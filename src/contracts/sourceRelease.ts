export interface SourceReleaseFile {
  path: string;
  sha256: string;
  recordCount?: number;
}

export interface SourceReleaseManifest {
  source: string;
  version: string;
  commitSha?: string;
  releaseTag?: string;
  producedAt: string;
  schemaVersion: number;
  files: SourceReleaseFile[];
  metadata?: Record<string, unknown>;
}
