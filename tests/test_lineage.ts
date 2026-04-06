/**
 * Tests for data lineage tracking.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  attachLineage,
  extractLineage,
  generateOperationId,
  LineageTracker,
  LineageMetadata,
} from '../semantic_layer/lineage';
import { GraphData } from '../semantic_layer/graph_schema';

const sampleLineage: LineageMetadata = {
  source: 'csv:data/sample.csv',
  operation: 'push_graph',
  timestamp: '2026-03-26T10:00:00Z',
  operationId: 'op_test_1',
};

const sampleGraph: GraphData = {
  nodes: [
    { id: '1', category: 'User', properties: { name: 'Alice' } },
    { id: '2', category: 'User', properties: { name: 'Bob' } },
  ],
  edges: [
    { id: 'e1', source: '1', target: '2', relationship: 'KNOWS', properties: {} },
  ],
};

describe('attachLineage', () => {
  it('injects _lineage into all nodes and edges', () => {
    const tagged = attachLineage(sampleGraph, sampleLineage);

    expect(tagged.nodes).toHaveLength(2);
    expect(tagged.edges).toHaveLength(1);
    expect(tagged.nodes[0].properties._lineage).toEqual(sampleLineage);
    expect(tagged.nodes[1].properties._lineage).toEqual(sampleLineage);
    expect(tagged.edges[0].properties._lineage).toEqual(sampleLineage);
  });

  it('preserves original properties', () => {
    const tagged = attachLineage(sampleGraph, sampleLineage);
    expect(tagged.nodes[0].properties.name).toBe('Alice');
  });

  it('does not mutate the original graph', () => {
    const tagged = attachLineage(sampleGraph, sampleLineage);
    expect(sampleGraph.nodes[0].properties._lineage).toBeUndefined();
    expect(tagged.nodes[0].properties._lineage).toBeDefined();
  });
});

describe('extractLineage', () => {
  it('extracts lineage from a tagged node', () => {
    const tagged = attachLineage(sampleGraph, sampleLineage);
    const lineage = extractLineage(tagged.nodes[0]);
    expect(lineage).toEqual(sampleLineage);
  });

  it('returns null for untagged nodes', () => {
    expect(extractLineage(sampleGraph.nodes[0])).toBeNull();
  });
});

describe('generateOperationId', () => {
  it('generates unique IDs', () => {
    const id1 = generateOperationId();
    const id2 = generateOperationId();
    expect(id1).not.toBe(id2);
    expect(id1).toMatch(/^op_\d+_\d+$/);
  });
});

describe('LineageTracker', () => {
  let tracker: LineageTracker;

  beforeEach(() => {
    tracker = new LineageTracker(100);
  });

  it('records and retrieves operations', () => {
    tracker.record({
      operationId: 'op1',
      operation: 'push_graph',
      source: 'csv:test.csv',
      timestamp: '2026-03-26T10:00:00Z',
      nodeCount: 5,
      edgeCount: 3,
    });

    expect(tracker.count).toBe(1);
    const recent = tracker.getRecent();
    expect(recent).toHaveLength(1);
    expect(recent[0].operationId).toBe('op1');
  });

  it('returns recent operations in reverse chronological order', () => {
    tracker.record({ operationId: 'op1', operation: 'push_graph', source: 'a', timestamp: 't1', nodeCount: 1, edgeCount: 0 });
    tracker.record({ operationId: 'op2', operation: 'add_nodes', source: 'b', timestamp: 't2', nodeCount: 2, edgeCount: 0 });

    const recent = tracker.getRecent();
    expect(recent[0].operationId).toBe('op2');
    expect(recent[1].operationId).toBe('op1');
  });

  it('filters by source', () => {
    tracker.record({ operationId: 'op1', operation: 'push_graph', source: 'csv:a.csv', timestamp: 't1', nodeCount: 1, edgeCount: 0 });
    tracker.record({ operationId: 'op2', operation: 'add_nodes', source: 'neo4j:bolt', timestamp: 't2', nodeCount: 2, edgeCount: 0 });

    expect(tracker.getBySource('csv:a.csv')).toHaveLength(1);
    expect(tracker.getBySource('neo4j:bolt')).toHaveLength(1);
    expect(tracker.getBySource('unknown')).toHaveLength(0);
  });

  it('enforces max records limit', () => {
    const smallTracker = new LineageTracker(3);
    for (let i = 0; i < 5; i++) {
      smallTracker.record({ operationId: `op${i}`, operation: 'test', source: 's', timestamp: 't', nodeCount: 0, edgeCount: 0 });
    }
    expect(smallTracker.count).toBe(3);
  });

  it('clears all records', () => {
    tracker.record({ operationId: 'op1', operation: 'test', source: 's', timestamp: 't', nodeCount: 0, edgeCount: 0 });
    tracker.clear();
    expect(tracker.count).toBe(0);
  });
});
