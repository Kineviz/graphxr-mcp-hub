/**
 * Tests for the semantic layer transformers.
 */

import { describe, it, expect } from 'vitest';
import { csvResultToGraph } from '../semantic_layer/transformers/csv_transformer.js';
import { jsonToGraph } from '../semantic_layer/transformers/json_transformer.js';
import { neo4jResultToGraph } from '../semantic_layer/transformers/neo4j_transformer.js';
import { spannerResultToGraph } from '../semantic_layer/transformers/spanner_transformer.js';
import { validateGraphData, isValidGraphData } from '../semantic_layer/validators.js';

describe('csvResultToGraph', () => {
  it('converts rows to nodes with default config', () => {
    const rows = [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ];
    const graph = csvResultToGraph(rows);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes[0].id).toBe('1');
    expect(graph.nodes[0].category).toBe('Record');
  });

  it('creates edges when targetColumn is specified', () => {
    const rows = [
      { id: '1', name: 'Alice', friend_id: '2' },
      { id: '2', name: 'Bob', friend_id: '3' },
    ];
    const graph = csvResultToGraph(rows, {
      nodeCategory: 'User',
      idColumn: 'id',
      targetColumn: 'friend_id',
      relationship: 'KNOWS',
    });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0].relationship).toBe('KNOWS');
    expect(graph.edges[0].source).toBe('1');
    expect(graph.edges[0].target).toBe('2');
  });

  it('skips edges when targetColumn rows have null values', () => {
    const rows = [
      { id: '1', name: 'Alice', friend_id: null },
      { id: '2', name: 'Bob', friend_id: '1' },
    ];
    const graph = csvResultToGraph(rows, { targetColumn: 'friend_id' });
    expect(graph.edges).toHaveLength(1);
  });
});

describe('jsonToGraph', () => {
  it('converts JSON array to nodes', () => {
    const data = [
      { id: 'p1', title: 'Post 1' },
      { id: 'p2', title: 'Post 2' },
    ];
    const graph = jsonToGraph(data, { nodeCategory: 'Post', idField: 'id' });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0].category).toBe('Post');
    expect(graph.nodes[0].id).toBe('p1');
  });

  it('converts single JSON object to one node', () => {
    const data = { id: 'x1', value: 42 };
    const graph = jsonToGraph(data);
    expect(graph.nodes).toHaveLength(1);
  });

  it('falls back to index-based id when idField is missing', () => {
    const data = [{ name: 'no-id-field' }];
    const graph = jsonToGraph(data, { idField: 'id' });
    expect(graph.nodes[0].id).toBe('node_0');
  });
});

describe('spannerResultToGraph', () => {
  it('converts rows to nodes without edges', () => {
    const rows = [{ id: '1', name: 'Row1' }];
    const graph = spannerResultToGraph(rows, { nodeCategory: 'Record', idColumn: 'id' });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.edges).toHaveLength(0);
  });

  it('creates edges when sourceColumn and targetColumn are given', () => {
    const rows = [{ id: '1', src: 'A', tgt: 'B' }];
    const graph = spannerResultToGraph(rows, {
      idColumn: 'id',
      sourceColumn: 'src',
      targetColumn: 'tgt',
      relationship: 'LINKS',
    });
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].relationship).toBe('LINKS');
  });
});

describe('neo4jResultToGraph', () => {
  it('extracts nodes and relationships from Neo4j records', () => {
    const records = [
      {
        keys: ['n', 'r', 'm'],
        _fields: [
          { identity: { low: 1 }, labels: ['User'], properties: { name: 'Alice' } },
          { identity: { low: 10 }, start: { low: 1 }, end: { low: 2 }, type: 'KNOWS', properties: {} },
          { identity: { low: 2 }, labels: ['User'], properties: { name: 'Bob' } },
        ],
      },
    ];
    const graph = neo4jResultToGraph(records as Parameters<typeof neo4jResultToGraph>[0]);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].relationship).toBe('KNOWS');
  });
});

describe('validateGraphData', () => {
  it('accepts valid GraphData', () => {
    const data = {
      nodes: [{ id: '1', category: 'User', properties: { name: 'Alice' } }],
      edges: [{ id: 'e1', source: '1', target: '2', relationship: 'KNOWS', properties: {} }],
    };
    expect(() => validateGraphData(data)).not.toThrow();
  });

  it('rejects invalid GraphData (missing id)', () => {
    const data = {
      nodes: [{ category: 'User' }],
      edges: [],
    };
    expect(() => validateGraphData(data)).toThrow();
  });

  it('isValidGraphData returns false for invalid data', () => {
    expect(isValidGraphData({ nodes: 'bad', edges: [] })).toBe(false);
  });
});
