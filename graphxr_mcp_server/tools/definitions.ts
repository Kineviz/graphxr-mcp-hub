/**
 * Canonical MCP tool definitions for the GraphXR MCP Server.
 *
 * These definitions are served via ListTools and also used in the
 * /mcp-info auto-discovery endpoint so that GraphXR Agent, Claude
 * Desktop, Codex, and other clients know what capabilities are available.
 */

import { Tool } from '@modelcontextprotocol/sdk/types.js';

export const ALL_TOOL_DEFINITIONS: Tool[] = [
  // ── Push direction (Client → GraphXR) ──────────────────────────────────
  {
    name: 'push_graph',
    description:
      'Replace the entire graph displayed in GraphXR with the provided nodes and edges. ' +
      'Use this to render a completely new graph from any data source.',
    inputSchema: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          description: 'Array of graph nodes to push.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique node identifier.' },
              category: { type: 'string', description: 'Node type/label (e.g. "User", "Product").' },
              properties: { type: 'object', description: 'Arbitrary key-value properties.' },
            },
            required: ['id', 'category'],
          },
        },
        edges: {
          type: 'array',
          description: 'Array of edges connecting nodes.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique edge identifier.' },
              source: { type: 'string', description: 'Source node id.' },
              target: { type: 'string', description: 'Target node id.' },
              relationship: { type: 'string', description: 'Relationship type (e.g. "KNOWS").' },
              properties: { type: 'object', description: 'Arbitrary key-value properties.' },
            },
            required: ['id', 'source', 'target', 'relationship'],
          },
        },
      },
      required: ['nodes', 'edges'],
    },
  },

  {
    name: 'add_nodes',
    description:
      'Incrementally add nodes to the current GraphXR graph without clearing existing data.',
    inputSchema: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              category: { type: 'string' },
              properties: { type: 'object' },
            },
            required: ['id', 'category'],
          },
        },
      },
      required: ['nodes'],
    },
  },

  {
    name: 'add_edges',
    description:
      'Incrementally add edges to the current GraphXR graph without clearing existing data.',
    inputSchema: {
      type: 'object',
      properties: {
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              source: { type: 'string' },
              target: { type: 'string' },
              relationship: { type: 'string' },
              properties: { type: 'object' },
            },
            required: ['id', 'source', 'target', 'relationship'],
          },
        },
      },
      required: ['edges'],
    },
  },

  {
    name: 'update_node',
    description: 'Update properties of an existing node in the GraphXR graph.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Node id to update.' },
        properties: { type: 'object', description: 'Properties to merge into the node.' },
      },
      required: ['id', 'properties'],
    },
  },

  {
    name: 'clear_graph',
    description: 'Clear all nodes and edges from the GraphXR canvas.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  // ── Query direction (GraphXR → Client) ─────────────────────────────────
  {
    name: 'get_graph_state',
    description:
      'Get a summary of the graph currently displayed in GraphXR: node count, edge count, ' +
      'category breakdown, and basic statistics.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  {
    name: 'get_nodes',
    description:
      'Query nodes from the graph currently displayed in GraphXR. ' +
      'An optional filter object narrows the results (e.g. {"category": "User"}).',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          description: 'Optional filter criteria. Supported keys: category, property name-value pairs.',
        },
      },
      required: [],
    },
  },

  {
    name: 'get_edges',
    description:
      'Query edges from the graph currently displayed in GraphXR. ' +
      'An optional filter object narrows the results (e.g. {"relationship": "KNOWS"}).',
    inputSchema: {
      type: 'object',
      properties: {
        filter: {
          type: 'object',
          description: 'Optional filter criteria. Supported keys: relationship, source, target.',
        },
      },
      required: [],
    },
  },

  {
    name: 'find_neighbors',
    description:
      'Find all nodes and edges directly connected to a specified node in the current GraphXR graph.',
    inputSchema: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: 'The node whose neighbors to retrieve.' },
      },
      required: ['node_id'],
    },
  },

  // ── Data ingestion & query (built-in DuckDB) ────────────────────────────
  {
    name: 'ingest_file',
    description:
      'Load a data file (CSV, JSON, or Parquet) into the Hub\'s built-in database. ' +
      'Returns the table schema (column names and types), row count, and sample rows. ' +
      'After ingestion, use query_data to run SQL queries on the loaded data. ' +
      'Accepts either a file_path or raw file_content (for inline data).',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: {
          type: 'string',
          description: 'Path to the data file (CSV, JSON, Parquet). Format is auto-detected from extension.',
        },
        file_content: {
          type: 'string',
          description: 'Raw file content as a string (CSV or JSON). Used when passing inline data instead of a file path.',
        },
        format: {
          type: 'string',
          enum: ['csv', 'json', 'parquet'],
          description: 'File format hint. Auto-detected from file_path extension if omitted.',
        },
        table_name: {
          type: 'string',
          description: 'Custom table name. Auto-generated from filename if omitted.',
        },
      },
      required: [],
    },
  },

  {
    name: 'query_data',
    description:
      'Execute a SQL query against data loaded via ingest_file. ' +
      'Supports full SQL syntax (SELECT, JOIN, GROUP BY, etc.). ' +
      'Set push_to_graphxr=true to automatically transform query results into graph nodes/edges ' +
      'and push them to GraphXR for visualization. Use transform_config to control how rows ' +
      'map to nodes and edges (nodeCategory, idColumn, targetColumn, relationship).',
    inputSchema: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'SQL query to execute (e.g., SELECT * FROM users WHERE age > 25).',
        },
        push_to_graphxr: {
          type: 'boolean',
          description: 'If true, transform results to graph data and push to GraphXR.',
        },
        transform_config: {
          type: 'object',
          description: 'Configuration for graph transformation when push_to_graphxr is true.',
          properties: {
            nodeCategory: { type: 'string', description: 'Category/label for nodes (e.g., "User", "Product").' },
            idColumn: { type: 'string', description: 'Column to use as node ID (default: "id").' },
            targetColumn: { type: 'string', description: 'Column whose values become edge targets. If set, edges are created.' },
            relationship: { type: 'string', description: 'Relationship type for edges (default: "RELATED_TO").' },
          },
        },
      },
      required: ['sql'],
    },
  },

  {
    name: 'list_tables',
    description:
      'List all data tables currently loaded in the Hub\'s built-in database. ' +
      'Shows table names, column schemas, and row counts.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  // ── Source management ───────────────────────────────────────────────────
  {
    name: 'connect_source',
    description:
      'Connect to an external data source (MCP server) on-demand. ' +
      'For pre-configured sources, just provide the name (e.g., "toolbox", "filesystem"). ' +
      'For new sources, provide transport details (sse url or stdio command). ' +
      'Once connected, the source\'s tools become available with the prefix "{name}__".',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Source name (e.g., "toolbox", "filesystem", "my-neo4j").' },
        transport: { type: 'string', enum: ['sse', 'stdio'], description: 'Transport type. Required for new sources.' },
        url: { type: 'string', description: 'SSE endpoint URL (for transport=sse).' },
        command: { type: 'string', description: 'Command to spawn (for transport=stdio, e.g., "npx").' },
        args: { type: 'array', items: { type: 'string' }, description: 'Command arguments (for transport=stdio).' },
        description: { type: 'string', description: 'Human-readable description of the source.' },
      },
      required: ['name'],
    },
  },
];
