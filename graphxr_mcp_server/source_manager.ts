/**
 * Source Manager — Dynamic MCP Server Proxy
 *
 * Reads hub_config.yaml at startup and connects to external MCP servers:
 *   - genai-toolbox (SSE) — built-in, auto-connects if enabled
 *   - STDIO servers (filesystem, fetch, github, etc.) — on-demand
 *
 * All external tools are namespaced (e.g., "toolbox__neo4j-query") and
 * proxied through the Hub, so clients see a single unified tool list.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import YAML from 'yaml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SourceStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SourceInfo {
  name: string;
  description: string;
  transport: 'sse' | 'stdio';
  status: SourceStatus;
  tools: string[];
  error?: string;
}

interface SourceEntry {
  client: Client;
  transport: SSEClientTransport | StdioClientTransport;
  tools: Tool[];
  status: SourceStatus;
  description: string;
  transportType: 'sse' | 'stdio';
  error?: string;
}

interface HubConfig {
  toolbox?: {
    enabled?: boolean;
    url?: string;
    description?: string;
  };
  mcp_servers?: Array<{
    name: string;
    enabled?: boolean;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    description?: string;
  }>;
}

// ---------------------------------------------------------------------------
// Source Manager
// ---------------------------------------------------------------------------

export interface AddSourceParams {
  name: string;
  transport: 'sse' | 'stdio';
  url?: string;          // for SSE
  command?: string;       // for STDIO
  args?: string[];        // for STDIO
  env?: Record<string, string>;
  description?: string;
}

export class SourceManager {
  private sources = new Map<string, SourceEntry>();
  private config: HubConfig = {};
  private configPath = resolve(process.cwd(), 'config/hub_config.yaml');

  /** Load config from hub_config.yaml. */
  loadConfig(configPath?: string): void {
    try {
      const path = configPath ?? this.configPath;
      const raw = readFileSync(path, 'utf-8');
      // Resolve env vars in the YAML
      const resolved = raw.replace(/\$\{([^}]+)\}/g, (_match, expr) => {
        const [varName, defaultVal] = expr.split(':-');
        return process.env[varName.trim()] ?? defaultVal?.trim() ?? '';
      });
      this.config = YAML.parse(resolved) ?? {};
    } catch {
      // Config not found — proceed with defaults
    }
  }

  /**
   * Initialize all enabled built-in sources.
   * genai-toolbox connects automatically if enabled.
   * STDIO servers are connected on-demand via connectSource().
   */
  async initialize(): Promise<void> {
    this.loadConfig();

    // Auto-connect genai-toolbox if enabled
    if (this.config.toolbox?.enabled) {
      const url = this.config.toolbox.url ?? 'http://localhost:5000/sse';
      await this.connectSSE('toolbox', url, this.config.toolbox.description ?? 'genai-toolbox');
    }
  }

  /** Connect to an SSE-based MCP server (e.g., genai-toolbox). */
  async connectSSE(name: string, url: string, description = ''): Promise<void> {
    if (this.sources.has(name)) return;

    const client = new Client({ name: 'graphxr-hub', version: '0.1.0' });
    const transport = new SSEClientTransport(new URL(url));

    const entry: SourceEntry = {
      client,
      transport,
      tools: [],
      status: 'connecting',
      description,
      transportType: 'sse',
    };
    this.sources.set(name, entry);

    try {
      await client.connect(transport);
      const result = await client.listTools();
      entry.tools = result.tools;
      entry.status = 'connected';
      console.log(`[source-manager] Connected to ${name} (SSE): ${entry.tools.length} tool(s)`);
    } catch (err) {
      entry.status = 'error';
      entry.error = err instanceof Error ? err.message : String(err);
      console.error(`[source-manager] Failed to connect to ${name}: ${entry.error}`);
    }
  }

  /** Connect to a STDIO-based MCP server (spawns child process). */
  async connectStdio(
    name: string,
    command: string,
    args: string[] = [],
    env?: Record<string, string>,
    description = ''
  ): Promise<void> {
    if (this.sources.has(name)) return;

    const client = new Client({ name: 'graphxr-hub', version: '0.1.0' });
    const transport = new StdioClientTransport({
      command,
      args,
      env: env ? { ...process.env as Record<string, string>, ...env } : undefined,
      stderr: 'pipe',
    });

    const entry: SourceEntry = {
      client,
      transport,
      tools: [],
      status: 'connecting',
      description,
      transportType: 'stdio',
    };
    this.sources.set(name, entry);

    try {
      await client.connect(transport);
      const result = await client.listTools();
      entry.tools = result.tools;
      entry.status = 'connected';
      console.log(`[source-manager] Connected to ${name} (STDIO): ${entry.tools.length} tool(s)`);
    } catch (err) {
      entry.status = 'error';
      entry.error = err instanceof Error ? err.message : String(err);
      console.error(`[source-manager] Failed to connect to ${name}: ${entry.error}`);
    }
  }

  /**
   * Connect to a configured MCP server by name (on-demand).
   * Looks up the server in hub_config.yaml's mcp_servers list.
   */
  async connectByName(name: string): Promise<boolean> {
    if (this.sources.has(name)) return this.sources.get(name)!.status === 'connected';

    const serverConfig = this.config.mcp_servers?.find((s) => s.name === name);
    if (!serverConfig) return false;
    if (!serverConfig.command) return false;

    await this.connectStdio(
      name,
      serverConfig.command,
      serverConfig.args,
      serverConfig.env,
      serverConfig.description
    );
    return this.sources.get(name)?.status === 'connected';
  }

  /**
   * Get all proxied tool definitions (namespaced).
   * Tool names are prefixed: "toolbox__neo4j-query", "filesystem__read_file", etc.
   */
  getProxiedTools(): Tool[] {
    const tools: Tool[] = [];
    for (const [name, entry] of this.sources) {
      if (entry.status !== 'connected') continue;
      for (const tool of entry.tools) {
        tools.push({
          ...tool,
          name: `${name}__${tool.name}`,
          description: `[${name}] ${tool.description ?? ''}`,
        });
      }
    }
    return tools;
  }

  /**
   * Dispatch a namespaced tool call to the correct external server.
   * Returns null if the tool doesn't belong to any connected source.
   */
  async dispatchTool(namespacedName: string, args: Record<string, unknown>): Promise<unknown | null> {
    const sepIdx = namespacedName.indexOf('__');
    if (sepIdx === -1) return null;

    const sourceName = namespacedName.slice(0, sepIdx);
    const toolName = namespacedName.slice(sepIdx + 2);

    // Try on-demand connect if not yet connected
    if (!this.sources.has(sourceName)) {
      const connected = await this.connectByName(sourceName);
      if (!connected) return null;
    }

    const entry = this.sources.get(sourceName);
    if (!entry || entry.status !== 'connected') return null;

    return entry.client.callTool({ name: toolName, arguments: args });
  }

  /** Get status of all sources. */
  getStatus(): SourceInfo[] {
    const result: SourceInfo[] = [];

    // Connected sources
    for (const [name, entry] of this.sources) {
      result.push({
        name,
        description: entry.description,
        transport: entry.transportType,
        status: entry.status,
        tools: entry.tools.map((t) => t.name),
        error: entry.error,
      });
    }

    // Configured but not yet connected STDIO servers
    for (const server of this.config.mcp_servers ?? []) {
      if (!this.sources.has(server.name) && server.enabled !== false) {
        result.push({
          name: server.name,
          description: server.description ?? '',
          transport: 'stdio',
          status: 'disconnected',
          tools: [],
        });
      }
    }

    return result;
  }

  /** Disconnect a specific source. */
  async disconnect(name: string): Promise<void> {
    const entry = this.sources.get(name);
    if (!entry) return;
    try {
      await entry.client.close();
    } catch { /* ignore */ }
    this.sources.delete(name);
  }

  /** Disconnect all sources. */
  async disconnectAll(): Promise<void> {
    for (const name of Array.from(this.sources.keys())) {
      await this.disconnect(name);
    }
  }

  // ---------------------------------------------------------------------------
  // Dynamic source management (add/remove at runtime + persist to config)
  // ---------------------------------------------------------------------------

  /**
   * Add a new data source, persist to hub_config.yaml, and connect immediately.
   */
  async addSource(params: AddSourceParams): Promise<{ connected: boolean; error?: string }> {
    const { name, transport, url, command, args, env, description } = params;

    // Persist to config
    if (!this.config.mcp_servers) this.config.mcp_servers = [];

    // Remove existing entry with same name
    this.config.mcp_servers = this.config.mcp_servers.filter((s) => s.name !== name);

    if (transport === 'sse') {
      // SSE sources go into toolbox-like top-level config
      this.config.mcp_servers.push({
        name,
        enabled: true,
        command: '', // not used for SSE, but we store url in description
        args: [],
        description: description ?? `SSE: ${url}`,
      });
    } else {
      this.config.mcp_servers.push({
        name,
        enabled: true,
        command: command ?? 'npx',
        args: args ?? [],
        env,
        description,
      });
    }

    this.saveConfig();

    // Connect
    await this.disconnect(name); // clean up if reconnecting
    try {
      if (transport === 'sse' && url) {
        await this.connectSSE(name, url, description);
      } else if (transport === 'stdio' && command) {
        await this.connectStdio(name, command, args, env, description);
      } else {
        return { connected: false, error: 'Missing url (for SSE) or command (for STDIO)' };
      }
      const entry = this.sources.get(name);
      if (entry?.status === 'connected') {
        return { connected: true };
      }
      return { connected: false, error: entry?.error ?? 'Unknown error' };
    } catch (err) {
      return { connected: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Remove a data source: disconnect and remove from config.
   */
  async removeSource(name: string): Promise<void> {
    await this.disconnect(name);
    if (this.config.mcp_servers) {
      this.config.mcp_servers = this.config.mcp_servers.filter((s) => s.name !== name);
      this.saveConfig();
    }
  }

  /** Persist current mcp_servers config back to hub_config.yaml. */
  private saveConfig(): void {
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      const fullConfig = YAML.parse(raw) ?? {};
      fullConfig.mcp_servers = this.config.mcp_servers;
      writeFileSync(this.configPath, YAML.stringify(fullConfig, { indent: 2 }), 'utf-8');
    } catch {
      // Best-effort persistence
    }
  }
}
