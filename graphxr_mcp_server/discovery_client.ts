/**
 * MCP Server Auto-Discovery Client
 *
 * Provides a reusable discovery module that GraphXR Agent (or any frontend)
 * can use to detect a running GraphXR MCP Server on localhost.
 *
 * Usage (browser or Node.js):
 *   import { discoverMcpServer } from './discovery_client';
 *   const result = await discoverMcpServer();
 *   if (result.available) { ... connect via result.sseEndpoint ... }
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface McpToolInfo {
  name: string;
  description: string;
}

export interface McpCapabilities {
  pushGraph: boolean;
  queryGraph: boolean;
  bidirectional: boolean;
}

export interface GraphXRBridgeInfo {
  eventsEndpoint: string;
  resultsEndpoint: string;
  statusEndpoint: string;
  protocol: string;
  description: string;
}

export interface McpDiscoveryResult {
  available: boolean;
  url: string;
  name?: string;
  version?: string;
  protocol?: string;
  sseEndpoint?: string;
  tools?: McpToolInfo[];
  capabilities?: McpCapabilities;
  graphxrCompatible?: boolean;
  graphxrBridge?: GraphXRBridgeInfo;
  error?: string;
}

export interface DiscoveryOptions {
  /** Base URL to probe (default: http://localhost:8899) */
  baseUrl?: string;
  /** Ports to scan if baseUrl is not specified (default: [8899]) */
  ports?: number[];
  /** Timeout per probe in milliseconds (default: 3000) */
  timeoutMs?: number;
  /** Number of retry attempts per port (default: 1) */
  retries?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function probePort(baseUrl: string, timeoutMs: number): Promise<McpDiscoveryResult> {
  const url = baseUrl.replace(/\/+$/, '');

  try {
    // Step 1: Health check
    const healthRes = await fetchWithTimeout(`${url}/health`, timeoutMs);
    if (!healthRes.ok) {
      return { available: false, url, error: `Health check returned ${healthRes.status}` };
    }
    const health = await healthRes.json() as Record<string, unknown>;
    if (health.status !== 'ok') {
      return { available: false, url, error: 'Health status is not ok' };
    }

    // Step 2: MCP info
    const infoRes = await fetchWithTimeout(`${url}/mcp-info`, timeoutMs);
    if (!infoRes.ok) {
      return { available: false, url, error: `MCP info returned ${infoRes.status}` };
    }
    const info = await infoRes.json() as Record<string, unknown>;

    const bridge = info.graphxrBridge as Record<string, string> | undefined;

    return {
      available: true,
      url,
      name: info.name as string,
      version: info.version as string,
      protocol: info.protocol as string,
      sseEndpoint: `${url}${info.sseEndpoint ?? '/sse'}`,
      tools: info.tools as McpToolInfo[],
      capabilities: info.capabilities as McpCapabilities,
      graphxrCompatible: info.graphxrCompatible as boolean,
      graphxrBridge: bridge ? {
        eventsEndpoint: `${url}${bridge.eventsEndpoint}`,
        resultsEndpoint: `${url}${bridge.resultsEndpoint}`,
        statusEndpoint: `${url}${bridge.statusEndpoint}`,
        protocol: bridge.protocol,
        description: bridge.description,
      } : undefined,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { available: false, url, error: message };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover a running GraphXR MCP Server.
 *
 * Probes the specified URL (or scans a list of ports on localhost) and returns
 * the first available MCP server that reports `graphxrCompatible: true`.
 */
export async function discoverMcpServer(options: DiscoveryOptions = {}): Promise<McpDiscoveryResult> {
  const { timeoutMs = 3000, retries = 1 } = options;

  // If a specific baseUrl is provided, probe it directly
  if (options.baseUrl) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const result = await probePort(options.baseUrl, timeoutMs);
      if (result.available) return result;
      if (attempt < retries) await delay(500);
    }
    return { available: false, url: options.baseUrl, error: 'Server not reachable after retries' };
  }

  // Otherwise scan ports
  const ports = options.ports ?? [8899];
  for (const port of ports) {
    const url = `http://localhost:${port}`;
    for (let attempt = 0; attempt <= retries; attempt++) {
      const result = await probePort(url, timeoutMs);
      if (result.available) return result;
      if (attempt < retries) await delay(500);
    }
  }

  return { available: false, url: `http://localhost:${ports[0]}`, error: 'No MCP server found on scanned ports' };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
