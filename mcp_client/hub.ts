/**
 * MCP Hub — multi-server connection manager
 *
 * Reads config/hub_config.yaml and manages connections to all enabled
 * MCP servers (DuckDB STDIO, genai-toolbox SSE, filesystem, fetch, etc.).
 *
 * Usage:
 *   const hub = new McpHub();
 *   await hub.start();
 *   const tools = hub.listAllTools();
 *   const result = await hub.callTool('duckdb', 'query', { sql: '...' });
 *   await hub.stop();
 */

import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

// ---------------------------------------------------------------------------
// Config types (mirrors hub_config.yaml)
// ---------------------------------------------------------------------------

export interface StdioServerConfig {
  enabled: boolean;
  transport: 'stdio';
  command: string;
  args: string[];
  env?: Record<string, string>;
  description?: string;
}

export interface SseServerConfig {
  enabled: boolean;
  transport: 'sse';
  url: string;
  description?: string;
}

export interface GraphXRServerConfig {
  enabled: boolean;
  port: number;
  graphxr_ws_url: string;
  transport?: 'http' | 'stdio';
}

export type ServerConfig = StdioServerConfig | SseServerConfig;

export interface HubConfig {
  graphxr_mcp_server?: GraphXRServerConfig;
  duckdb?: StdioServerConfig;
  toolbox?: SseServerConfig;
  mcp_servers?: Array<{ name: string } & ServerConfig>;
}

// ---------------------------------------------------------------------------
// Tool descriptor (aggregated from all connected servers)
// ---------------------------------------------------------------------------

export interface ToolDescriptor {
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// STDIO server handle
// ---------------------------------------------------------------------------

interface StdioHandle {
  process: ChildProcess;
  serverName: string;
  config: StdioServerConfig;
  /** Resolved tools after the process reports them. */
  tools: ToolDescriptor[];
}

// ---------------------------------------------------------------------------
// McpHub
// ---------------------------------------------------------------------------

export class McpHub {
  private readonly configPath: string;
  private config: HubConfig = {};
  private stdioHandles: Map<string, StdioHandle> = new Map();
  private started = false;

  constructor(configPath?: string) {
    this.configPath =
      configPath ??
      path.resolve(process.cwd(), 'config', 'hub_config.yaml');
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async start(): Promise<void> {
    if (this.started) return;
    this.config = this.loadConfig();
    this.started = true;

    // Start all enabled STDIO servers
    if (this.config.duckdb?.enabled && this.config.duckdb.transport === 'stdio') {
      this.startStdioServer('duckdb', this.config.duckdb);
    }

    for (const srv of this.config.mcp_servers ?? []) {
      if (srv.enabled && srv.transport === 'stdio') {
        this.startStdioServer(srv.name, srv as StdioServerConfig);
      }
    }
  }

  async stop(): Promise<void> {
    for (const handle of this.stdioHandles.values()) {
      handle.process.kill('SIGTERM');
    }
    this.stdioHandles.clear();
    this.started = false;
  }

  // ---------------------------------------------------------------------------
  // Tool registry
  // ---------------------------------------------------------------------------

  /** Returns all tools from all connected servers. */
  listAllTools(): ToolDescriptor[] {
    const tools: ToolDescriptor[] = [];
    for (const handle of this.stdioHandles.values()) {
      tools.push(...handle.tools);
    }
    return tools;
  }

  /** Returns tools from a specific server by name. */
  listServerTools(serverName: string): ToolDescriptor[] {
    return this.stdioHandles.get(serverName)?.tools ?? [];
  }

  /** Returns the names of all running servers. */
  listServers(): string[] {
    const servers: string[] = [];
    for (const key of this.stdioHandles.keys()) {
      servers.push(key);
    }
    // SSE servers (not tracked as processes, just config)
    if (this.config.toolbox?.enabled) servers.push('toolbox');
    if (this.config.mcp_servers) {
      for (const s of this.config.mcp_servers) {
        if (s.enabled && s.transport === 'sse') servers.push(s.name);
      }
    }
    return servers;
  }

  /** Returns true if the named server is currently running/configured. */
  hasServer(serverName: string): boolean {
    return this.listServers().includes(serverName);
  }

  /** Returns the SSE URL for a named SSE server, or null if not found. */
  getSseUrl(serverName: string): string | null {
    if (serverName === 'toolbox' && this.config.toolbox?.enabled) {
      return this.config.toolbox.url;
    }
    const srv = (this.config.mcp_servers ?? []).find(
      (s) => s.name === serverName && s.enabled && s.transport === 'sse'
    );
    return srv ? (srv as SseServerConfig).url : null;
  }

  // ---------------------------------------------------------------------------
  // Config loader
  // ---------------------------------------------------------------------------

  private loadConfig(): HubConfig {
    if (!fs.existsSync(this.configPath)) {
      return {};
    }
    const raw = fs.readFileSync(this.configPath, 'utf8');
    return yaml.parse(raw) as HubConfig;
  }

  // ---------------------------------------------------------------------------
  // STDIO server management
  // ---------------------------------------------------------------------------

  private startStdioServer(name: string, config: StdioServerConfig): void {
    const env = { ...process.env, ...(config.env ?? {}) };
    const child = spawn(config.command, config.args, {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const handle: StdioHandle = { process: child, serverName: name, config, tools: [] };
    this.stdioHandles.set(name, handle);

    child.on('error', (err) => {
      console.error(`[hub] Failed to start stdio server "${name}":`, err);
      this.stdioHandles.delete(name);
    });

    child.on('exit', (code) => {
      if (code === null) {
        console.warn(`[hub] Stdio server "${name}" was terminated by a signal`);
      } else if (code !== 0) {
        console.error(`[hub] Stdio server "${name}" exited with non-zero code ${code}`);
      } else {
        console.warn(`[hub] Stdio server "${name}" exited with code 0`);
      }
      this.stdioHandles.delete(name);
    });
  }

  // ---------------------------------------------------------------------------
  // Expose raw config for testing / inspection
  // ---------------------------------------------------------------------------

  getConfig(): HubConfig {
    return this.config;
  }
}
