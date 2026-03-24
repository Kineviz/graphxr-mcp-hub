/**
 * DuckDB MCP pipeline integration tests.
 *
 * These tests validate the full CSV/JSON → transform → GraphData pipeline
 * that would be used with the DuckDB MCP Server.
 * They do NOT require DuckDB to be installed — they simulate what DuckDB
 * returns (rows of plain JS objects) and verify the pipeline downstream.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { csvResultToGraph } from '../semantic_layer/transformers/csv_transformer.js';
import { jsonToGraph } from '../semantic_layer/transformers/json_transformer.js';
import { validateGraphData } from '../semantic_layer/validators.js';

// ---------------------------------------------------------------------------
// Helper: parse the sample CSV manually (simulates DuckDB read_csv_auto)
// ---------------------------------------------------------------------------

function parseCsvFile(filePath: string): Record<string, unknown>[] {
  const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    const row: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      row[h.trim()] = values[i]?.trim() ?? null;
    });
    return row;
  });
}

// Resolve paths relative to this test file so tests work regardless of cwd
const REPO_ROOT = path.resolve(__dirname, '..');
const SAMPLE_CSV = path.join(REPO_ROOT, 'data', 'sample.csv');
const SAMPLE_JSON = path.join(REPO_ROOT, 'data', 'sample.json');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DuckDB pipeline — CSV file', () => {
  it('parses sample.csv into rows', () => {
    const rows = parseCsvFile(SAMPLE_CSV);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('id');
    expect(rows[0]).toHaveProperty('name');
  });

  it('transforms CSV rows to valid GraphData', () => {
    const rows = parseCsvFile(SAMPLE_CSV);
    const graph = csvResultToGraph(rows, {
      nodeCategory: 'Person',
      idColumn: 'id',
      targetColumn: 'friend_id',
      relationship: 'KNOWS',
      lineage: { source: 'duckdb', file: SAMPLE_CSV },
    });
    expect(() => validateGraphData(graph)).not.toThrow();
    expect(graph.nodes.length).toBe(rows.length);
    expect(graph.nodes[0].category).toBe('Person');
  });

  it('creates edges from friend_id column', () => {
    const rows = parseCsvFile(SAMPLE_CSV);
    const graph = csvResultToGraph(rows, {
      nodeCategory: 'Person',
      idColumn: 'id',
      targetColumn: 'friend_id',
      relationship: 'KNOWS',
    });
    // Every row has a friend_id so every row should produce an edge
    const edgesWithTarget = rows.filter((r) => r['friend_id'] != null && r['friend_id'] !== '');
    expect(graph.edges.length).toBe(edgesWithTarget.length);
    expect(graph.edges[0].relationship).toBe('KNOWS');
  });

  it('attaches DuckDB lineage metadata to every node', () => {
    const rows = parseCsvFile(SAMPLE_CSV);
    const graph = csvResultToGraph(rows, {
      lineage: { source: 'duckdb', file: SAMPLE_CSV, query: `SELECT * FROM read_csv_auto('${SAMPLE_CSV}')` },
    });
    for (const node of graph.nodes) {
      expect(node._lineage?.source).toBe('duckdb');
      expect(node._lineage?.file).toBe(SAMPLE_CSV);
    }
  });

  it('node properties contain raw CSV column values', () => {
    const rows = parseCsvFile(SAMPLE_CSV);
    const graph = csvResultToGraph(rows, { idColumn: 'id', nodeCategory: 'Person' });
    const alice = graph.nodes.find((n) => n.id === '1');
    expect(alice).toBeDefined();
    expect(alice?.properties['name']).toBe('Alice');
    expect(alice?.properties['city']).toBe('New York');
  });
});

describe('DuckDB pipeline — JSON file', () => {
  it('parses sample.json and transforms to valid GraphData', () => {
    const raw = fs.readFileSync(SAMPLE_JSON, 'utf8');
    const data = JSON.parse(raw) as unknown;
    const graph = jsonToGraph(data, {
      nodeCategory: 'Post',
      idField: 'id',
      lineage: { source: 'json', file: SAMPLE_JSON },
    });
    expect(() => validateGraphData(graph)).not.toThrow();
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.nodes[0].category).toBe('Post');
    expect(graph.nodes[0]._lineage?.source).toBe('json');
  });

  it('assigns correct ids from the id field', () => {
    const raw = fs.readFileSync(SAMPLE_JSON, 'utf8');
    const data = JSON.parse(raw) as unknown;
    const graph = jsonToGraph(data, { idField: 'id' });
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain('p1');
    expect(ids).toContain('p2');
    expect(ids).toContain('p3');
  });
});

describe('DuckDB pipeline — cross-file merge', () => {
  it('merges CSV nodes and JSON nodes into one GraphData structure', () => {
    // Simulate combining results from two DuckDB queries
    const csvRows = parseCsvFile(SAMPLE_CSV);
    const csvGraph = csvResultToGraph(csvRows, { nodeCategory: 'Person', idColumn: 'id' });

    const raw = fs.readFileSync(SAMPLE_JSON, 'utf8');
    const jsonGraph = jsonToGraph(JSON.parse(raw) as unknown, { nodeCategory: 'Post', idField: 'id' });

    const merged = {
      nodes: [...csvGraph.nodes, ...jsonGraph.nodes],
      edges: [...csvGraph.edges, ...jsonGraph.edges],
    };

    expect(() => validateGraphData(merged)).not.toThrow();
    expect(merged.nodes.some((n) => n.category === 'Person')).toBe(true);
    expect(merged.nodes.some((n) => n.category === 'Post')).toBe(true);
  });
});
