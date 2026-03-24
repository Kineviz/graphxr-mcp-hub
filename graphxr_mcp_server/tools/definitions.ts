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
];
