/**
 * GraphXR MCP Auto-Discovery Client
 *
 * A browser-compatible TypeScript module for the GraphXR Agent chat page.
 * It probes localhost:8899 (or a configured port) to detect a running
 * GraphXR MCP Server and manages the optional SSE connection.
 *
 * Designed to have zero Node.js-specific imports — uses only the
 * standard Web APIs (fetch, EventSource) so it can run directly in a
 * browser bundle.
 *
 * Usage in GraphXR Agent frontend:
 *   import { GraphXRMcpDiscovery } from './discovery';
 *   const discovery = new GraphXRMcpDiscovery();
 *   discovery.onStatusChange((status) => renderConnectionBadge(status));
 *   await discovery.startPolling();
 */

export type DiscoveryStatus =
  | 'idle'          // not yet started
  | 'probing'       // actively checking
  | 'available'     // server found, not yet connected
  | 'connecting'    // SSE connection in progress
  | 'connected'     // SSE connection established
  | 'disconnected'  // was connected, now lost
  | 'unavailable';  // port is not responding

export interface McpToolInfo {
  name: string;
  description: string;
}

export interface McpServerInfo {
  name: string;
  version: string;
  protocol: string;
  transport: string[];
  sseEndpoint: string;
  tools: McpToolInfo[];
  capabilities: {
    pushGraph: boolean;
    queryGraph: boolean;
    bidirectional: boolean;
  };
  graphxrCompatible: boolean;
}

export interface GraphXRMcpDiscoveryOptions {
  /** Port to probe. Defaults to 8899. */
  port?: number;
  /** How often to re-probe (ms). Defaults to 10 000. */
  pollIntervalMs?: number;
  /** Timeout for each probe request (ms). Defaults to 2 000. */
  probeTimeoutMs?: number;
  /** Auto-connect via SSE once the server is found. Defaults to false. */
  autoConnect?: boolean;
}

type StatusChangeHandler = (status: DiscoveryStatus, info?: McpServerInfo) => void;

export class GraphXRMcpDiscovery {
  private readonly port: number;
  private readonly pollIntervalMs: number;
  private readonly probeTimeoutMs: number;
  private readonly autoConnect: boolean;

  private status: DiscoveryStatus = 'idle';
  private serverInfo: McpServerInfo | null = null;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;
  private eventSource: EventSource | null = null;
  private readonly statusHandlers: StatusChangeHandler[] = [];

  constructor(options: GraphXRMcpDiscoveryOptions = {}) {
    this.port = options.port ?? 8899;
    this.pollIntervalMs = options.pollIntervalMs ?? 10_000;
    this.probeTimeoutMs = options.probeTimeoutMs ?? 2_000;
    this.autoConnect = options.autoConnect ?? false;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Register a callback that fires whenever the discovery status changes. */
  onStatusChange(handler: StatusChangeHandler): () => void {
    this.statusHandlers.push(handler);
    return () => {
      const idx = this.statusHandlers.indexOf(handler);
      if (idx !== -1) this.statusHandlers.splice(idx, 1);
    };
  }

  /** Current discovery status. */
  getStatus(): DiscoveryStatus {
    return this.status;
  }

  /** Resolved MCP server info, or null if not yet discovered. */
  getServerInfo(): McpServerInfo | null {
    return this.serverInfo;
  }

  /**
   * Start background polling for the MCP server.
   * Performs an immediate probe, then repeats every `pollIntervalMs`.
   */
  async startPolling(): Promise<void> {
    if (this.pollingTimer !== null) return; // already polling
    await this.probe();
    this.pollingTimer = setInterval(() => {
      this.probe().catch(() => {});
    }, this.pollIntervalMs);
  }

  /** Stop background polling (does not disconnect an existing SSE session). */
  stopPolling(): void {
    if (this.pollingTimer !== null) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  /**
   * Manually open an SSE connection to the MCP server.
   * Call this after the user opts in to connecting.
   * Requires the server to have been discovered first (status === 'available').
   */
  connect(): void {
    if (!this.serverInfo) {
      throw new Error('[discovery] Cannot connect: MCP server not yet discovered.');
    }
    this.openSse();
  }

  /** Disconnect the current SSE session. */
  disconnect(): void {
    this.closeSse();
    if (this.status === 'connected' || this.status === 'connecting') {
      this.setStatus('available');
    }
  }

  // ---------------------------------------------------------------------------
  // Internal probe logic
  // ---------------------------------------------------------------------------

  private async probe(): Promise<void> {
    this.setStatus('probing');

    const baseUrl = `http://localhost:${this.port}`;

    try {
      // 1. Liveness check
      const healthRes = await this.fetchWithTimeout(`${baseUrl}/health`);
      if (!healthRes.ok) {
        this.setStatus('unavailable');
        return;
      }

      // 2. Capability manifest
      const infoRes = await this.fetchWithTimeout(`${baseUrl}/mcp-info`);
      if (!infoRes.ok) {
        this.setStatus('unavailable');
        return;
      }

      const info = (await infoRes.json()) as McpServerInfo;
      if (!info.graphxrCompatible) {
        // A non-GraphXR MCP server is running on this port — ignore it.
        this.setStatus('unavailable');
        return;
      }

      this.serverInfo = info;

      if (this.status === 'connected' || this.status === 'connecting') {
        // Already connected — no status change needed
        return;
      }

      this.setStatus('available', info);

      if (this.autoConnect) {
        this.openSse();
      }
    } catch {
      // Fetch failed — server is not running
      if (this.status === 'connected' || this.status === 'connecting') {
        this.closeSse();
        this.setStatus('disconnected');
      } else {
        this.setStatus('unavailable');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // SSE session
  // ---------------------------------------------------------------------------

  private openSse(): void {
    if (!this.serverInfo) return;
    this.setStatus('connecting');

    const sseUrl = `http://localhost:${this.port}${this.serverInfo.sseEndpoint}`;
    const es = new EventSource(sseUrl);
    this.eventSource = es;

    es.addEventListener('open', () => {
      this.setStatus('connected', this.serverInfo ?? undefined);
    });

    es.addEventListener('error', () => {
      this.closeSse();
      this.setStatus('disconnected');
      // Re-probe to check if the server came back
      this.probe().catch(() => {});
    });
  }

  private closeSse(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  // ---------------------------------------------------------------------------
  // Status management
  // ---------------------------------------------------------------------------

  private setStatus(status: DiscoveryStatus, info?: McpServerInfo): void {
    if (this.status === status) return;
    this.status = status;
    for (const handler of this.statusHandlers) {
      handler(status, info);
    }
  }

  // ---------------------------------------------------------------------------
  // Fetch helper with timeout
  // ---------------------------------------------------------------------------

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    // Set a timeout so the polling loop is never blocked indefinitely.
    // If the fetch completes before the timeout, the finally block clears
    // the timer so the abort signal is never triggered after resolution.
    const timer = setTimeout(() => controller.abort(), this.probeTimeoutMs);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
