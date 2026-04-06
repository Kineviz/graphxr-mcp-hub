/**
 * DuckDB integration pipeline tests.
 *
 * Validates the end-to-end flow: DuckDB-style query results → transformer → validated GraphData.
 * Uses realistic data shapes matching what mcp-server-duckdb returns for read_csv_auto / read_json_auto.
 */

import { describe, it, expect } from 'vitest';
import { csvResultToGraph } from '../semantic_layer/transformers/csv_transformer.js';
import { jsonToGraph } from '../semantic_layer/transformers/json_transformer.js';
import { validateGraphData } from '../semantic_layer/validators.js';
import { GraphDataSchema } from '../semantic_layer/graph_schema.js';

// ---------- Realistic DuckDB output fixtures ----------

/** Simulates: SELECT * FROM read_csv_auto('data/sample.csv') */
const DUCKDB_CSV_USERS = [
  { id: '1', name: 'Alice', age: 30, city: 'New York', friend_id: '2' },
  { id: '2', name: 'Bob', age: 25, city: 'San Francisco', friend_id: '3' },
  { id: '3', name: 'Carol', age: 35, city: 'Chicago', friend_id: '1' },
  { id: '4', name: 'Dave', age: 28, city: 'New York', friend_id: '1' },
  { id: '5', name: 'Eve', age: 32, city: 'Los Angeles', friend_id: '2' },
];

/** Simulates: SELECT city, COUNT(*) as cnt FROM read_csv_auto('data/sample.csv') GROUP BY city */
const DUCKDB_AGGREGATE = [
  { city: 'New York', cnt: 2 },
  { city: 'San Francisco', cnt: 1 },
  { city: 'Chicago', cnt: 1 },
  { city: 'Los Angeles', cnt: 1 },
];

/** Simulates a JOIN: SELECT u.id as user_id, u.name, o.order_id, o.product FROM users u JOIN orders o ON u.id = o.user_id */
const DUCKDB_JOIN_RESULT = [
  { user_id: '1', name: 'Alice', order_id: 'o1', product: 'Widget' },
  { user_id: '1', name: 'Alice', order_id: 'o2', product: 'Gadget' },
  { user_id: '2', name: 'Bob', order_id: 'o3', product: 'Widget' },
];

/** Simulates: SELECT * FROM read_json_auto('data/sample.json') */
const DUCKDB_JSON_POSTS = [
  { id: 'p1', title: 'GraphXR Overview', author: 'Alice', tags: ['graph', 'viz'], related: 'p2' },
  { id: 'p2', title: 'MCP Protocol Guide', author: 'Bob', tags: ['mcp', 'protocol'], related: 'p3' },
  { id: 'p3', title: 'Neo4j Best Practices', author: 'Carol', tags: ['neo4j', 'graph'], related: 'p1' },
];

// ---------- Tests ----------

describe('DuckDB CSV Pipeline', () => {
  it('transforms full CSV result into valid GraphData with nodes and edges', () => {
    const graph = csvResultToGraph(DUCKDB_CSV_USERS, {
      nodeCategory: 'User',
      idColumn: 'id',
      targetColumn: 'friend_id',
      relationship: 'KNOWS',
    });

    expect(graph.nodes).toHaveLength(5);
    expect(graph.edges).toHaveLength(5);
    expect(graph.nodes.every((n) => n.category === 'User')).toBe(true);
    expect(graph.edges.every((e) => e.relationship === 'KNOWS')).toBe(true);

    // Validate with Zod schema
    expect(() => validateGraphData(graph)).not.toThrow();
  });

  it('handles aggregate query output (nodes only, no edges)', () => {
    const graph = csvResultToGraph(DUCKDB_AGGREGATE, {
      nodeCategory: 'City',
      idColumn: 'city',
    });

    expect(graph.nodes).toHaveLength(4);
    expect(graph.edges).toHaveLength(0);
    expect(graph.nodes[0].id).toBe('New York');
    expect(graph.nodes[0].properties).toHaveProperty('cnt', 2);

    expect(() => validateGraphData(graph)).not.toThrow();
  });

  it('handles JOIN result producing cross-entity edges', () => {
    const graph = csvResultToGraph(DUCKDB_JOIN_RESULT, {
      nodeCategory: 'User',
      idColumn: 'user_id',
      targetColumn: 'order_id',
      relationship: 'ORDERED',
    });

    expect(graph.nodes).toHaveLength(3);
    expect(graph.edges).toHaveLength(3);
    expect(graph.edges[0].source).toBe('1');
    expect(graph.edges[0].target).toBe('o1');
    expect(graph.edges[0].relationship).toBe('ORDERED');

    expect(() => validateGraphData(graph)).not.toThrow();
  });

  it('handles empty DuckDB result set', () => {
    const graph = csvResultToGraph([]);

    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
    expect(() => validateGraphData(graph)).not.toThrow();
  });

  it('handles rows with missing id column using fallback', () => {
    const rows = [
      { name: 'Alice', city: 'New York' },
      { name: 'Bob', city: 'Chicago' },
    ];
    const graph = csvResultToGraph(rows, { nodeCategory: 'Person', idColumn: 'id' });

    expect(graph.nodes).toHaveLength(2);
    // Each node should have a generated id (not undefined)
    expect(graph.nodes.every((n) => n.id !== undefined && n.id !== 'undefined')).toBe(true);
    expect(() => validateGraphData(graph)).not.toThrow();
  });
});

describe('DuckDB JSON Pipeline', () => {
  it('transforms JSON query results into valid GraphData', () => {
    const graph = jsonToGraph(DUCKDB_JSON_POSTS, {
      nodeCategory: 'Post',
      idField: 'id',
    });

    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes[0].category).toBe('Post');
    expect(graph.nodes[0].id).toBe('p1');
    expect(graph.nodes[0].properties).toHaveProperty('title', 'GraphXR Overview');

    expect(() => validateGraphData(graph)).not.toThrow();
  });

  it('preserves nested/array fields in properties', () => {
    const graph = jsonToGraph(DUCKDB_JSON_POSTS, {
      nodeCategory: 'Post',
      idField: 'id',
    });

    // tags array should be preserved as-is in properties
    expect(graph.nodes[0].properties).toHaveProperty('tags');
    expect(Array.isArray((graph.nodes[0].properties as Record<string, unknown>).tags)).toBe(true);
  });
});

describe('End-to-end: DuckDB result → validate → push_graph compatibility', () => {
  it('produces output matching push_graph input schema', () => {
    const graph = csvResultToGraph(DUCKDB_CSV_USERS, {
      nodeCategory: 'User',
      idColumn: 'id',
      targetColumn: 'friend_id',
      relationship: 'KNOWS',
    });

    // Validate with the full GraphDataSchema (same schema push_graph uses)
    const parsed = GraphDataSchema.parse(graph);

    // Verify structure matches push_graph expectations
    expect(parsed).toHaveProperty('nodes');
    expect(parsed).toHaveProperty('edges');
    expect(parsed.nodes[0]).toHaveProperty('id');
    expect(parsed.nodes[0]).toHaveProperty('category');
    expect(parsed.nodes[0]).toHaveProperty('properties');
    expect(parsed.edges[0]).toHaveProperty('id');
    expect(parsed.edges[0]).toHaveProperty('source');
    expect(parsed.edges[0]).toHaveProperty('target');
    expect(parsed.edges[0]).toHaveProperty('relationship');
  });

  it('JSON pipeline output is also push_graph compatible', () => {
    const graph = jsonToGraph(DUCKDB_JSON_POSTS, { nodeCategory: 'Post', idField: 'id' });
    const parsed = GraphDataSchema.parse(graph);

    expect(parsed.nodes).toHaveLength(3);
    expect(parsed.edges).toHaveLength(0);
  });
});
