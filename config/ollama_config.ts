/**
 * Ollama Local LLM Configuration
 *
 * Generates MCP client configuration for connecting Ollama (local LLM)
 * to the GraphXR MCP Hub, enabling local model-driven graph operations.
 *
 * Usage:
 *   npx ts-node config/ollama_config.ts [--model llama3] [--ollama-url http://localhost:11434]
 *
 * Output:
 *   Prints the MCP client configuration JSON to stdout, which can be
 *   used by Ollama-compatible MCP clients.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OllamaConfig {
  /** Ollama API base URL (default: http://localhost:11434) */
  ollamaUrl: string;
  /** Model to use (default: llama3) */
  model: string;
  /** GraphXR MCP Server URL (default: http://localhost:8899) */
  mcpServerUrl: string;
  /** MCP transport mode */
  transport: 'sse' | 'stdio';
}

export interface OllamaMcpClientConfig {
  ollama: {
    url: string;
    model: string;
  };
  mcpServers: {
    graphxr: {
      transport: string;
      url?: string;
      command?: string;
      args?: string[];
      description: string;
    };
  };
}

// ---------------------------------------------------------------------------
// Config generator
// ---------------------------------------------------------------------------

export function generateOllamaConfig(options: Partial<OllamaConfig> = {}): OllamaMcpClientConfig {
  const {
    ollamaUrl = 'http://localhost:11434',
    model = 'llama3',
    mcpServerUrl = 'http://localhost:8899',
    transport = 'sse',
  } = options;

  if (transport === 'sse') {
    return {
      ollama: { url: ollamaUrl, model },
      mcpServers: {
        graphxr: {
          transport: 'sse',
          url: `${mcpServerUrl}/sse`,
          description: 'GraphXR MCP Server — push and query graph data in GraphXR WebGL',
        },
      },
    };
  }

  // STDIO transport
  return {
    ollama: { url: ollamaUrl, model },
    mcpServers: {
      graphxr: {
        transport: 'stdio',
        command: 'node',
        args: ['dist/graphxr_mcp_server/index.js', '--stdio'],
        description: 'GraphXR MCP Server — push and query graph data in GraphXR WebGL',
      },
    },
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

if (require.main === module) {
  const args = process.argv.slice(2);
  const options: Partial<OllamaConfig> = {};

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--model':
        options.model = args[++i];
        break;
      case '--ollama-url':
        options.ollamaUrl = args[++i];
        break;
      case '--mcp-url':
        options.mcpServerUrl = args[++i];
        break;
      case '--transport':
        options.transport = args[++i] as 'sse' | 'stdio';
        break;
    }
  }

  const config = generateOllamaConfig(options);
  console.log(JSON.stringify(config, null, 2));
}
