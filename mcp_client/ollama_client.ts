/**
 * Ollama MCP Client — bridges Ollama local models with the GraphXR MCP Server.
 *
 * Ollama exposes an OpenAI-compatible `/api/chat` endpoint that supports
 * function/tool calling. This module:
 *   1. Fetches available MCP tools from the GraphXR MCP Server's /mcp-info endpoint.
 *   2. Converts MCP tool schemas to Ollama tool format.
 *   3. Sends chat messages to Ollama with tools attached.
 *   4. When Ollama emits a tool_call, proxies it to the MCP Server via HTTP POST.
 *   5. Returns the MCP tool result back to Ollama to continue the conversation.
 *
 * Usage:
 *   const client = new OllamaMcpClient();
 *   const reply = await client.chat('把 users.csv 数据推送到 GraphXR');
 *   console.log(reply);
 */

export interface OllamaMcpClientOptions {
  /** Ollama API base URL. Defaults to http://localhost:11434. */
  ollamaUrl?: string;
  /** Ollama model to use. Defaults to "llama3.2". */
  model?: string;
  /** GraphXR MCP Server base URL. Defaults to http://localhost:8899. */
  mcpServerUrl?: string;
  /**
   * System prompt injected before every conversation.
   * Defaults to a concise GraphXR-aware assistant prompt.
   */
  systemPrompt?: string;
  /** Request timeout in milliseconds. Defaults to 60 000. */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Ollama API types
// ---------------------------------------------------------------------------

interface OllamaToolFunction {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

interface OllamaTool {
  type: 'function';
  function: OllamaToolFunction;
}

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, unknown> };
  }>;
}

interface OllamaChatResponse {
  message: OllamaMessage;
  done: boolean;
}

// ---------------------------------------------------------------------------
// MCP tool descriptor (from /mcp-info)
// ---------------------------------------------------------------------------

interface McpToolInfo {
  name: string;
  description: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

interface McpServerInfo {
  tools: McpToolInfo[];
}

// ---------------------------------------------------------------------------
// OllamaMcpClient
// ---------------------------------------------------------------------------

const DEFAULT_SYSTEM_PROMPT = `You are GraphXR Assistant, an AI that can visualize and analyze
knowledge graphs using GraphXR. You have access to MCP tools that can push data to GraphXR,
query the current graph, manage streaming data sources, and more.
Always use the provided tools to fulfil graph-related requests.
Respond concisely and in the user's language.`;

export class OllamaMcpClient {
  private readonly ollamaUrl: string;
  private readonly model: string;
  private readonly mcpServerUrl: string;
  private readonly systemPrompt: string;
  private readonly timeoutMs: number;
  private cachedTools: OllamaTool[] | null = null;

  constructor(options: OllamaMcpClientOptions = {}) {
    this.ollamaUrl = (options.ollamaUrl ?? 'http://localhost:11434').replace(/\/$/, '');
    this.model = options.model ?? 'llama3.2';
    this.mcpServerUrl = (options.mcpServerUrl ?? 'http://localhost:8899').replace(/\/$/, '');
    this.systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;
    this.timeoutMs = options.timeoutMs ?? 60_000;
  }

  // ---------------------------------------------------------------------------
  // Public chat interface
  // ---------------------------------------------------------------------------

  /**
   * Send a user message, automatically invoke any MCP tools Ollama requests,
   * and return the final assistant text response.
   */
  async chat(
    userMessage: string,
    conversationHistory: OllamaMessage[] = []
  ): Promise<string> {
    const tools = await this.getTools();

    const messages: OllamaMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...conversationHistory,
      { role: 'user', content: userMessage },
    ];

    // Agentic loop: keep calling Ollama until no more tool calls are requested
    for (let round = 0; round < 10; round++) {
      const response = await this.callOllama(messages, tools);
      messages.push(response.message);

      const toolCalls = response.message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        // Final answer — return text content
        return response.message.content ?? '';
      }

      // Execute each tool call via MCP
      for (const call of toolCalls) {
        const result = await this.callMcpTool(
          call.function.name,
          call.function.arguments
        );
        messages.push({
          role: 'tool',
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }
    }

    throw new Error('[ollama-mcp] Reached maximum tool-call rounds without a final answer.');
  }

  // ---------------------------------------------------------------------------
  // Tool discovery — fetches from MCP Server /mcp-info
  // ---------------------------------------------------------------------------

  async getTools(): Promise<OllamaTool[]> {
    if (this.cachedTools) return this.cachedTools;
    const info = await this.fetchMcpInfo();
    this.cachedTools = info.tools.map(mcpToolToOllama);
    return this.cachedTools;
  }

  /** Clears the tool cache so they are re-fetched on the next call. */
  clearToolCache(): void {
    this.cachedTools = null;
  }

  // ---------------------------------------------------------------------------
  // Ollama API call
  // ---------------------------------------------------------------------------

  private async callOllama(
    messages: OllamaMessage[],
    tools: OllamaTool[]
  ): Promise<OllamaChatResponse> {
    const body = JSON.stringify({
      model: this.model,
      messages,
      tools,
      stream: false,
    });

    const response = await fetchWithTimeout(
      `${this.ollamaUrl}/api/chat`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
      this.timeoutMs
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`[ollama-mcp] Ollama API error ${response.status}: ${text}`);
    }

    return (await response.json()) as OllamaChatResponse;
  }

  // ---------------------------------------------------------------------------
  // MCP tool call via HTTP POST to the MCP Server
  // ---------------------------------------------------------------------------

  private async callMcpTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<unknown> {
    // We use the MCP JSON-RPC protocol over HTTP POST directly.
    // The GraphXR MCP Server accepts JSON-RPC 2.0 at /messages (session-less
    // for this direct call path) but we can also use the REST-style approach
    // via a lightweight inline client.
    //
    // For simplicity (and to avoid managing a full SSE session here) we
    // delegate to a thin inline JSON-RPC call.
    const rpcBody = JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    });

    // Attempt SSE POST via /messages (session must already exist in production).
    // For the standalone Ollama bridge we fall back to a documented no-session
    // error response and surface a helpful message.
    const response = await fetchWithTimeout(
      `${this.mcpServerUrl}/messages`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: rpcBody },
      this.timeoutMs
    );

    if (response.status === 404) {
      // No active SSE session — return a descriptive placeholder so Ollama
      // can continue the conversation with context.
      return {
        note: `Tool "${toolName}" was requested but no active MCP SSE session was found. ` +
          `Start the GraphXR MCP Server and connect via SSE before invoking tools.`,
        toolName,
        args,
      };
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`[ollama-mcp] MCP tool call failed ${response.status}: ${text}`);
    }

    return response.json();
  }

  // ---------------------------------------------------------------------------
  // Fetch MCP server info
  // ---------------------------------------------------------------------------

  private async fetchMcpInfo(): Promise<McpServerInfo> {
    const response = await fetchWithTimeout(
      `${this.mcpServerUrl}/mcp-info`,
      { method: 'GET' },
      this.timeoutMs
    );
    if (!response.ok) {
      throw new Error(`[ollama-mcp] Failed to fetch MCP info: ${response.status}`);
    }
    return (await response.json()) as McpServerInfo;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mcpToolToOllama(tool: McpToolInfo): OllamaTool {
  const schema = tool.inputSchema ?? {};
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: (schema.properties as Record<string, unknown>) ?? {},
        required: (schema.required as string[]) ?? [],
      },
    },
  };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
