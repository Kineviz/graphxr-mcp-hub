import type { SourceInfo, AddSourceParams, SessionInfo, LineageEntry, RegistryResult, DatabaseTemplateParams, AdcStatus, ToolboxDatabaseEntry } from '../types';

const BASE = '/admin/api';

async function request<T>(path: string, options?: RequestInit & { signal?: AbortSignal }): Promise<T> {
  const timeout = AbortSignal.timeout(15000);
  const signal = options?.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;

  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as Record<string, string>).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Sources ─────────────────────────────────────────────────────────────────

export async function getSources(): Promise<SourceInfo[]> {
  const data = await request<{ sources: SourceInfo[] }>('/sources');
  return data.sources;
}

export async function addSource(params: AddSourceParams): Promise<SourceInfo[]> {
  const data = await request<{ sources: SourceInfo[] }>('/sources', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.sources;
}

export async function addDatabaseSource(params: DatabaseTemplateParams): Promise<SourceInfo[]> {
  const data = await request<{ sources: SourceInfo[] }>('/sources/database', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.sources;
}

export async function removeSource(name: string): Promise<SourceInfo[]> {
  const data = await request<{ sources: SourceInfo[] }>(`/sources/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  return data.sources;
}

export async function connectSource(name: string): Promise<SourceInfo[]> {
  const data = await request<{ sources: SourceInfo[] }>(`/sources/${encodeURIComponent(name)}/connect`, {
    method: 'POST',
  });
  return data.sources;
}

export async function disconnectSource(name: string): Promise<SourceInfo[]> {
  const data = await request<{ sources: SourceInfo[] }>(`/sources/${encodeURIComponent(name)}/disconnect`, {
    method: 'POST',
  });
  return data.sources;
}

// ── Toolbox Database Management ───────────────────────────────────────────

export async function getToolboxDatabases(): Promise<ToolboxDatabaseEntry[]> {
  const data = await request<{ databases: ToolboxDatabaseEntry[] }>('/toolbox/databases');
  return data.databases;
}

export async function updateToolboxDatabase(sourceKey: string, body: Record<string, unknown>): Promise<SourceInfo[]> {
  const data = await request<{ sources: SourceInfo[] }>(`/toolbox/databases/${encodeURIComponent(sourceKey)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  return data.sources;
}

export async function deleteToolboxDatabase(sourceKey: string): Promise<SourceInfo[]> {
  const data = await request<{ sources: SourceInfo[] }>(`/toolbox/databases/${encodeURIComponent(sourceKey)}`, {
    method: 'DELETE',
  });
  return data.sources;
}

export async function toggleToolbox(enabled: boolean): Promise<SourceInfo[]> {
  const data = await request<{ sources: SourceInfo[] }>('/toolbox/toggle', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
  return data.sources;
}

// ── ADC Status ─────────────────────────────────────────────────────────────

export async function getAdcStatus(): Promise<AdcStatus> {
  return request('/adc-status');
}

// ── MCP Registry ────────────────────────────────────────────────────────────

export async function searchRegistry(query: string): Promise<RegistryResult[]> {
  const data = await request<{ results: RegistryResult[] }>(`/registry/search?q=${encodeURIComponent(query)}`);
  return data.results;
}

export async function installFromRegistry(
  name: string,
  packageName: string,
  description?: string,
): Promise<SourceInfo[]> {
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  const data = await request<{ sources: SourceInfo[] }>('/registry/install', {
    method: 'POST',
    body: JSON.stringify({ name: safeName, package_name: packageName, description }),
  });
  return data.sources;
}

// ── Sessions ────────────────────────────────────────────────────────────────

export async function getSessions(): Promise<{ activeSessions: number; sessions: SessionInfo[] }> {
  return request('/sessions');
}

// ── Lineage ─────────────────────────────────────────────────────────────────

export async function getLineage(limit = 50): Promise<{ totalOperations: number; recent: LineageEntry[] }> {
  return request(`/lineage?limit=${limit}`);
}

// ── Examples ────────────────────────────────────────────────────────────────

export async function getExamples(): Promise<{ name: string; content: string }[]> {
  const data = await request<{ examples: { name: string; content: string }[] }>('/examples');
  return data.examples;
}

// ── Config ──────────────────────────────────────────────────────────────────

export async function getConfig(): Promise<{ config: Record<string, unknown>; raw: string }> {
  return request('/config');
}

export async function putConfig(config: Record<string, unknown>): Promise<{ success: boolean; message: string }> {
  return request('/config', {
    method: 'PUT',
    body: JSON.stringify({ config }),
  });
}
