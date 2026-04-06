export interface SourceInfo {
  name: string;
  description: string;
  transport: 'sse' | 'stdio';
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  tools: string[];
  error?: string;
}

export interface SessionInfo {
  sessionId: string;
  connectedAt: string;
  lastActivity: string;
  userAgent?: string;
}

export interface LineageEntry {
  operationId: string;
  operation: string;
  source: string;
  nodeCount: number;
  edgeCount: number;
  timestamp: string;
}

export interface RegistryResult {
  name: string;
  title?: string;
  description?: string;
  package_name?: string;
  npm_package?: string;
}

export interface AddSourceParams {
  name: string;
  transport: 'sse' | 'stdio';
  url?: string;
  command?: string;
  args?: string[];
  description?: string;
}

export type DatabaseType = 'neo4j' | 'spanner' | 'bigquery';

export interface DatabaseTemplateParams {
  type: DatabaseType;
  // Neo4j
  uri?: string;
  user?: string;
  password?: string;
  // Spanner
  project?: string;
  instance?: string;
  database?: string;
  dialect?: 'googlesql' | 'postgresql';
  // BigQuery
  location?: string;
  allowedDatasets?: string;
  // Property Graph (Spanner & BigQuery)
  enablePropertyGraph?: boolean;
  graphName?: string;
}

export interface AdcStatus {
  available: boolean;
  method?: 'service-account' | 'gcloud-adc' | 'metadata-server';
  detail?: string;
}
