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
import { resolveConfigPath, getPackageRoot } from './paths';
import { ensureConfigFiles } from './ensure_config';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SourceStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type DatabaseType = 'neo4j' | 'spanner' | 'bigquery';

export interface SourceInfo {
  name: string;
  description: string;
  transport: 'sse' | 'stdio';
  status: SourceStatus;
  tools: string[];
  error?: string;
  /** True if this row represents a database inside genai-toolbox */
  isToolboxDatabase?: boolean;
  /** Source key in tools.yaml (e.g. "spanner") */
  toolboxSourceKey?: string;
  /** Database kind */
  toolboxDbKind?: DatabaseType;
}

export interface ToolboxDatabaseEntry {
  sourceKey: string;
  displayName: string;
  kind: DatabaseType;
  params: Record<string, unknown>;
  propertyGraphEnabled: boolean;
  graphName?: string;
  tools: string[];
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
  private configPath = resolveConfigPath('hub_config.yaml');

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
      // hub_config.yaml missing or unreadable — fall back to safe defaults.
      // toolbox defaults to enabled so deployments without a hub_config.yaml
      // still auto-connect to genai-toolbox at the standard URL.
      this.config = {
        toolbox: {
          enabled: true,
          url: process.env.GENAI_TOOLBOX_URL ?? 'http://localhost:5000/mcp/sse',
          description: 'genai-toolbox (defaults)',
        },
      };
    }
  }

  /**
   * Initialize all enabled built-in sources.
   * genai-toolbox connects automatically if enabled.
   * STDIO servers are connected on-demand via connectSource().
   */
  async initialize(): Promise<void> {
    // Bootstrap any missing config files from shipped templates.
    // Look for templates next to cwd first, then fall back to package root
    // (which includes /app/config-defaults in the Docker image).
    ensureConfigFiles({ baseDir: process.cwd() });
    const pkgRoot = getPackageRoot();
    if (pkgRoot !== process.cwd()) {
      ensureConfigFiles({ baseDir: process.cwd(), defaultsDir: resolve(pkgRoot, 'config-defaults') });
    }
    this.loadConfig();

    // Auto-connect genai-toolbox if enabled
    if (this.config.toolbox?.enabled) {
      const url = this.config.toolbox.url ?? 'http://localhost:5000/mcp/sse';
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
    const existing = this.sources.get(name);
    if (existing?.status === 'connected') return true;

    // Disconnect first if in error state so we can retry
    if (existing) await this.disconnect(name);

    // Handle toolbox reconnection (including sub-source names like toolbox-spanner-xxx)
    if ((name === 'toolbox' || name.startsWith('toolbox-')) && this.config.toolbox?.enabled) {
      return (await this.reconnectToolbox()).connected;
    }

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

  // ---------------------------------------------------------------------------
  // tools.yaml parsing — expose individual databases as logical sub-sources
  // ---------------------------------------------------------------------------

  private get toolsYamlPath(): string {
    return resolveConfigPath('tools.yaml');
  }

  /** Parse tools.yaml and return individual database entries. */
  parseToolsYaml(): ToolboxDatabaseEntry[] {
    let parsed: { sources?: Record<string, Record<string, unknown>>; tools?: Record<string, Record<string, unknown>> };
    try {
      parsed = YAML.parse(readFileSync(this.toolsYamlPath, 'utf-8')) ?? {};
    } catch {
      return [];
    }

    const sources = parsed.sources ?? {};
    const tools = parsed.tools ?? {};
    const entries: ToolboxDatabaseEntry[] = [];

    for (const [sourceKey, sourceConfig] of Object.entries(sources)) {
      const kind = sourceConfig.kind as DatabaseType;
      // Build display name: toolbox-{kind}-{identifier}
      let identifier = '';
      if (kind === 'spanner') identifier = (sourceConfig.project as string) ?? sourceKey;
      else if (kind === 'bigquery') identifier = (sourceConfig.project as string) ?? sourceKey;
      else if (kind === 'neo4j') {
        const uri = (sourceConfig.uri as string) ?? '';
        identifier = uri.replace(/^bolt:\/\//, '').replace(/:\d+$/, '') || sourceKey;
      }
      const displayName = `toolbox-${kind}-${identifier}`;

      // Collect tools belonging to this source
      const sourceTools: string[] = [];
      let propertyGraphEnabled = false;
      let graphName: string | undefined;

      for (const [toolName, toolConfig] of Object.entries(tools)) {
        if (toolConfig.source !== sourceKey) continue;
        sourceTools.push(toolName);
        const toolKind = (toolConfig.kind as string) ?? '';
        if (toolKind.includes('list-graphs') || toolKind.includes('query-graph') ||
            toolName.includes('list-graphs') || toolName.includes('query-graph')) {
          propertyGraphEnabled = true;
        }
        if (toolConfig.statement && typeof toolConfig.statement === 'string') {
          const match = toolConfig.statement.match(/GRAPH_TABLE\((\w+)/);
          if (match) graphName = match[1];
        }
      }

      // Build params (exclude 'kind')
      const params: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(sourceConfig)) {
        if (k !== 'kind') params[k] = v;
      }

      entries.push({ sourceKey, displayName, kind, params, propertyGraphEnabled, graphName, tools: sourceTools });
    }

    return entries;
  }

  /** Get status of all sources. */
  getStatus(): SourceInfo[] {
    const result: SourceInfo[] = [];
    const toolboxEntry = this.sources.get('toolbox');
    const toolboxStatus: SourceStatus = toolboxEntry?.status ?? 'disconnected';
    const toolboxError = toolboxEntry?.error;
    const toolboxAllTools = toolboxEntry?.tools.map((t) => t.name) ?? [];

    // Expand toolbox into individual database sub-source rows
    if (this.config.toolbox?.enabled) {
      const databases = this.parseToolsYaml();
      if (databases.length > 0) {
        for (const db of databases) {
          // Filter to only tools that toolbox actually reports (intersection)
          const activeTools = db.tools.filter((t) => toolboxAllTools.includes(t));
          result.push({
            name: db.displayName,
            description: this.buildDbDescription(db),
            transport: 'sse',
            status: toolboxStatus,
            tools: activeTools,
            error: toolboxError,
            isToolboxDatabase: true,
            toolboxSourceKey: db.sourceKey,
            toolboxDbKind: db.kind,
          });
        }
      } else {
        // Toolbox enabled but no databases configured
        result.push({
          name: 'toolbox',
          description: this.config.toolbox.description ?? 'genai-toolbox (no databases)',
          transport: 'sse',
          status: toolboxStatus,
          tools: toolboxAllTools,
          error: toolboxError,
        });
      }
    }

    // Non-toolbox connected sources
    for (const [name, entry] of this.sources) {
      if (name === 'toolbox') continue;
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

  private buildDbDescription(db: ToolboxDatabaseEntry): string {
    switch (db.kind) {
      case 'spanner':
        return `Spanner: ${db.params.project}/${db.params.instance}/${db.params.database}`;
      case 'bigquery':
        return `BigQuery: ${db.params.project}` + (db.params.location ? ` (${db.params.location})` : '');
      case 'neo4j':
        return `Neo4j: ${db.params.uri}`;
      default:
        return `${db.kind}: ${db.sourceKey}`;
    }
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

  // ---------------------------------------------------------------------------
  // Database template support — generate tools.yaml for genai-toolbox
  // ---------------------------------------------------------------------------

  generateToolsYaml(
    dbType: 'neo4j' | 'spanner' | 'bigquery',
    params: Record<string, unknown>,
    existing?: { sources: Record<string, Record<string, unknown>>; tools: Record<string, Record<string, unknown>> },
  ): { sources: Record<string, Record<string, unknown>>; tools: Record<string, Record<string, unknown>> } {
    const sources = { ...(existing?.sources ?? {}) };
    const tools = { ...(existing?.tools ?? {}) };

    switch (dbType) {
      case 'neo4j':
        sources['neo4j'] = {
          kind: 'neo4j',
          uri: params.uri as string,
          user: params.user as string,
          password: params.password as string,
        };
        tools['neo4j-execute-cypher'] = {
          kind: 'neo4j-execute-cypher',
          source: 'neo4j',
          description: 'Execute Cypher queries on Neo4j graph database',
        };
        tools['neo4j-schema'] = {
          kind: 'neo4j-schema',
          source: 'neo4j',
          description: 'Extract schema from Neo4j database',
        };
        break;

      case 'spanner':
        sources['spanner'] = {
          kind: 'spanner',
          project: params.project as string,
          instance: params.instance as string,
          database: params.database as string,
          ...(params.dialect ? { dialect: params.dialect as string } : {}),
        };
        tools['spanner-execute-sql'] = {
          kind: 'spanner-execute-sql',
          source: 'spanner',
          description: 'Execute SQL queries on Google Cloud Spanner (supports GRAPH_TABLE for property graph queries)',
        };
        tools['spanner-list-tables'] = {
          kind: 'spanner-list-tables',
          source: 'spanner',
          description: 'List tables in Spanner database',
        };
        if (params.enablePropertyGraph) {
          tools['spanner-list-graphs'] = {
            kind: 'spanner-list-graphs',
            source: 'spanner',
            description: 'List property graphs in Spanner database',
          };
          if (params.graphName) {
            tools['spanner-query-graph'] = {
              kind: 'spanner-sql',
              source: 'spanner',
              description: `Query property graph "${params.graphName}" using GRAPH_TABLE() syntax in Spanner`,
              statement: `SELECT * FROM GRAPH_TABLE(${params.graphName} MATCH -[e]-> RETURN e LIMIT 100)`,
            };
          }
        }
        break;

      case 'bigquery': {
        const allowedDatasets = params.allowedDatasets
          ? (params.allowedDatasets as string).split(',').map((s: string) => s.trim()).filter(Boolean)
          : undefined;
        sources['bigquery'] = {
          kind: 'bigquery',
          project: params.project as string,
          ...(params.location ? { location: params.location as string } : {}),
          ...(allowedDatasets ? { allowedDatasets } : {}),
        };
        tools['bigquery-execute-sql'] = {
          kind: 'bigquery-execute-sql',
          source: 'bigquery',
          description: params.enablePropertyGraph
            ? 'Execute SQL queries on BigQuery (supports GRAPH_TABLE for property graph queries)'
            : 'Execute SQL queries on BigQuery',
        };
        tools['bigquery-conversational-analytics'] = {
          kind: 'bigquery-conversational-analytics',
          source: 'bigquery',
          description: 'Conversational analytics on BigQuery datasets',
        };
        tools['bigquery-get-dataset-info'] = {
          kind: 'bigquery-get-dataset-info',
          source: 'bigquery',
          description: 'Get BigQuery dataset metadata',
        };
        tools['bigquery-list-dataset-ids'] = {
          kind: 'bigquery-list-dataset-ids',
          source: 'bigquery',
          description: 'List BigQuery dataset IDs',
        };
        if (params.enablePropertyGraph && params.graphName) {
          tools['bigquery-query-graph'] = {
            kind: 'bigquery-sql',
            source: 'bigquery',
            description: `Query property graph "${params.graphName}" using GRAPH_TABLE() syntax in BigQuery`,
            statement: `SELECT * FROM GRAPH_TABLE(${params.graphName} MATCH -[e]-> RETURN e LIMIT 100)`,
          };
        }
        break;
      }
    }

    return { sources, tools };
  }

  async addDatabaseSource(
    dbType: 'neo4j' | 'spanner' | 'bigquery',
    params: Record<string, unknown>,
  ): Promise<{ connected: boolean; error?: string }> {
    const toolsPath = resolve(process.cwd(), 'config/tools.yaml');
    let existing: { sources: Record<string, Record<string, unknown>>; tools: Record<string, Record<string, unknown>> } | undefined;
    try {
      const raw = readFileSync(toolsPath, 'utf-8');
      existing = YAML.parse(raw) ?? undefined;
    } catch { /* first time */ }

    const config = this.generateToolsYaml(dbType, params, existing);
    writeFileSync(toolsPath, YAML.stringify(config, { indent: 2 }), 'utf-8');

    try {
      const hubRaw = readFileSync(this.configPath, 'utf-8');
      const hubConfig = YAML.parse(hubRaw) ?? {};
      if (hubConfig.toolbox) {
        hubConfig.toolbox.enabled = true;
      } else {
        hubConfig.toolbox = {
          enabled: true,
          transport: 'sse',
          url: '${GENAI_TOOLBOX_URL:-http://localhost:5000/mcp/sse}',
          description: 'Google genai-toolbox: database sources',
        };
      }
      writeFileSync(this.configPath, YAML.stringify(hubConfig, { indent: 2 }), 'utf-8');
      this.loadConfig();
    } catch (err) {
      return { connected: false, error: `Failed to update hub_config.yaml: ${err}` };
    }

    await this.disconnect('toolbox');
    const toolboxUrl = this.config.toolbox?.url ?? 'http://localhost:5000/mcp/sse';
    await this.connectSSE('toolbox', toolboxUrl, this.config.toolbox?.description ?? 'genai-toolbox');

    const entry = this.sources.get('toolbox');
    if (entry?.status === 'connected') {
      return { connected: true };
    }
    return { connected: false, error: entry?.error ?? 'Failed to connect to genai-toolbox' };
  }

  // ---------------------------------------------------------------------------
  // Toolbox database CRUD — edit / remove individual databases in tools.yaml
  // ---------------------------------------------------------------------------

  /** Reconnect the toolbox SSE after tools.yaml changes. */
  async reconnectToolbox(): Promise<{ connected: boolean; error?: string }> {
    await this.disconnect('toolbox');
    if (!this.config.toolbox?.enabled) return { connected: false, error: 'toolbox is disabled' };
    const url = this.config.toolbox.url ?? 'http://localhost:5000/mcp/sse';
    await this.connectSSE('toolbox', url, this.config.toolbox.description ?? 'genai-toolbox');
    const entry = this.sources.get('toolbox');
    if (entry?.status === 'connected') return { connected: true };
    return { connected: false, error: entry?.error ?? 'Failed to connect to genai-toolbox' };
  }

  /** Update an existing database source in tools.yaml, regenerate its tools, and reconnect. */
  async updateDatabaseSource(
    sourceKey: string,
    dbType: DatabaseType,
    params: Record<string, unknown>,
  ): Promise<{ connected: boolean; error?: string }> {
    let parsed: { sources?: Record<string, unknown>; tools?: Record<string, unknown> };
    try {
      parsed = YAML.parse(readFileSync(this.toolsYamlPath, 'utf-8')) ?? {};
    } catch {
      return { connected: false, error: 'tools.yaml not found' };
    }

    const sources = (parsed.sources ?? {}) as Record<string, Record<string, unknown>>;
    const tools = (parsed.tools ?? {}) as Record<string, Record<string, unknown>>;

    if (!sources[sourceKey]) {
      return { connected: false, error: `Source "${sourceKey}" not found in tools.yaml` };
    }

    // Remove old tools belonging to this source
    for (const [toolName, toolConfig] of Object.entries(tools)) {
      if (toolConfig.source === sourceKey) delete tools[toolName];
    }
    // Remove old source
    delete sources[sourceKey];

    // Regenerate via generateToolsYaml (merges with remaining sources/tools)
    const config = this.generateToolsYaml(dbType, params, { sources, tools });
    writeFileSync(this.toolsYamlPath, YAML.stringify(config, { indent: 2 }), 'utf-8');

    return this.reconnectToolbox();
  }

  /** Remove a database source from tools.yaml and reconnect. */
  async removeDatabaseSource(sourceKey: string): Promise<{ connected: boolean; error?: string }> {
    let parsed: { sources?: Record<string, unknown>; tools?: Record<string, unknown> };
    try {
      parsed = YAML.parse(readFileSync(this.toolsYamlPath, 'utf-8')) ?? {};
    } catch {
      return { connected: false, error: 'tools.yaml not found' };
    }

    const sources = (parsed.sources ?? {}) as Record<string, Record<string, unknown>>;
    const tools = (parsed.tools ?? {}) as Record<string, Record<string, unknown>>;

    // Remove tools belonging to this source
    for (const [toolName, toolConfig] of Object.entries(tools)) {
      if (toolConfig.source === sourceKey) delete tools[toolName];
    }
    delete sources[sourceKey];

    writeFileSync(this.toolsYamlPath, YAML.stringify({ sources, tools }, { indent: 2 }), 'utf-8');

    // If no sources left, optionally keep toolbox enabled but reconnect
    if (Object.keys(sources).length === 0) {
      await this.disconnect('toolbox');
      return { connected: false };
    }

    return this.reconnectToolbox();
  }

  /** Enable or disable the toolbox in hub_config.yaml. */
  async setToolboxEnabled(enabled: boolean): Promise<void> {
    try {
      const raw = readFileSync(this.configPath, 'utf-8');
      const hubConfig = YAML.parse(raw) ?? {};
      if (hubConfig.toolbox) {
        hubConfig.toolbox.enabled = enabled;
      } else {
        hubConfig.toolbox = {
          enabled,
          transport: 'sse',
          url: '${GENAI_TOOLBOX_URL:-http://localhost:5000/mcp/sse}',
          description: 'Google genai-toolbox: database sources',
        };
      }
      writeFileSync(this.configPath, YAML.stringify(hubConfig, { indent: 2 }), 'utf-8');
      this.loadConfig();
    } catch { /* best-effort */ }

    if (enabled) {
      await this.reconnectToolbox();
    } else {
      await this.disconnect('toolbox');
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
