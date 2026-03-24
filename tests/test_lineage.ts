/**
 * Tests for data lineage tracking in the semantic layer.
 */

import { describe, it, expect } from 'vitest';
import { makeLineage } from '../semantic_layer/graph_schema.js';
import { csvResultToGraph } from '../semantic_layer/transformers/csv_transformer.js';
import { jsonToGraph } from '../semantic_layer/transformers/json_transformer.js';
import { neo4jResultToGraph } from '../semantic_layer/transformers/neo4j_transformer.js';
import { spannerResultToGraph } from '../semantic_layer/transformers/spanner_transformer.js';

describe('makeLineage', () => {
  it('creates a lineage object with the current timestamp', () => {
    const before = new Date().toISOString();
    const lineage = makeLineage('duckdb', { file: '/data/users.csv' });
    const after = new Date().toISOString();

    expect(lineage.source).toBe('duckdb');
    expect(lineage.file).toBe('/data/users.csv');
    expect(lineage.fetchedAt >= before).toBe(true);
    expect(lineage.fetchedAt <= after).toBe(true);
  });

  it('works without extras', () => {
    const lineage = makeLineage('neo4j');
    expect(lineage.source).toBe('neo4j');
    expect(lineage.file).toBeUndefined();
    expect(lineage.query).toBeUndefined();
  });
});

describe('csvResultToGraph — lineage', () => {
  const rows = [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob', friend_id: '1' }];

  it('attaches lineage to nodes when provided', () => {
    const graph = csvResultToGraph(rows, {
      lineage: { source: 'duckdb', file: '/data/sample.csv', query: 'SELECT * FROM ...' },
    });
    expect(graph.nodes[0]._lineage?.source).toBe('duckdb');
    expect(graph.nodes[0]._lineage?.file).toBe('/data/sample.csv');
    expect(graph.nodes[0]._lineage?.query).toBe('SELECT * FROM ...');
    expect(graph.nodes[0]._lineage?.fetchedAt).toBeTruthy();
  });

  it('attaches lineage to edges when provided', () => {
    const graph = csvResultToGraph(rows, {
      targetColumn: 'friend_id',
      lineage: { source: 'duckdb' },
    });
    expect(graph.edges[0]._lineage?.source).toBe('duckdb');
  });

  it('omits _lineage when no lineage config provided', () => {
    const graph = csvResultToGraph(rows);
    expect(graph.nodes[0]._lineage).toBeUndefined();
    expect(graph.edges).toHaveLength(0);
  });

  it('all nodes share the same fetchedAt timestamp from a single transform call', () => {
    const graph = csvResultToGraph(rows, { lineage: { source: 'duckdb' } });
    expect(graph.nodes[0]._lineage?.fetchedAt).toBe(graph.nodes[1]._lineage?.fetchedAt);
  });
});

describe('jsonToGraph — lineage', () => {
  it('attaches lineage when provided', () => {
    const data = [{ id: 'p1', title: 'Post 1' }];
    const graph = jsonToGraph(data, { lineage: { source: 'http-api', file: 'https://api.example.com/posts' } });
    expect(graph.nodes[0]._lineage?.source).toBe('http-api');
    expect(graph.nodes[0]._lineage?.file).toBe('https://api.example.com/posts');
  });

  it('omits _lineage when not provided', () => {
    const graph = jsonToGraph([{ id: '1' }]);
    expect(graph.nodes[0]._lineage).toBeUndefined();
  });
});

describe('neo4jResultToGraph — lineage', () => {
  const records = [
    {
      keys: ['n'],
      _fields: [
        { identity: { low: 1 }, labels: ['User'], properties: { name: 'Alice' } },
      ],
    },
  ];

  it('attaches lineage when provided', () => {
    const graph = neo4jResultToGraph(records, {
      lineage: { source: 'neo4j', query: 'MATCH (n:User) RETURN n' },
    });
    expect(graph.nodes[0]._lineage?.source).toBe('neo4j');
    expect(graph.nodes[0]._lineage?.query).toBe('MATCH (n:User) RETURN n');
  });

  it('omits _lineage when not provided', () => {
    const graph = neo4jResultToGraph(records);
    expect(graph.nodes[0]._lineage).toBeUndefined();
  });
});

describe('spannerResultToGraph — lineage', () => {
  const rows = [{ id: '1', src: 'A', tgt: 'B' }];

  it('attaches lineage to nodes and edges', () => {
    const graph = spannerResultToGraph(rows, {
      idColumn: 'id',
      sourceColumn: 'src',
      targetColumn: 'tgt',
      lineage: { source: 'spanner', query: 'SELECT id, src, tgt FROM table' },
    });
    expect(graph.nodes[0]._lineage?.source).toBe('spanner');
    expect(graph.edges[0]._lineage?.source).toBe('spanner');
  });

  it('omits _lineage when not provided', () => {
    const graph = spannerResultToGraph(rows);
    expect(graph.nodes[0]._lineage).toBeUndefined();
  });
});
