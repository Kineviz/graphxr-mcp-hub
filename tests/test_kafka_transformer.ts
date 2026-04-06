/**
 * Tests for Kafka message transformer.
 */

import { describe, it, expect } from 'vitest';
import { kafkaMessageToGraph, KafkaMessage } from '../semantic_layer/transformers/kafka_transformer';
import { validateGraphData } from '../semantic_layer/validators';

const sampleMessages: KafkaMessage[] = [
  {
    key: 'user-1',
    value: { name: 'Alice', age: 30, friend_id: 'user-2' },
    topic: 'users',
    partition: 0,
    offset: 0,
    timestamp: 1711440000000,
  },
  {
    key: 'user-2',
    value: { name: 'Bob', age: 25, friend_id: 'user-3' },
    topic: 'users',
    partition: 0,
    offset: 1,
    timestamp: 1711440001000,
  },
  {
    key: 'user-3',
    value: { name: 'Carol', age: 35 },
    topic: 'users',
    partition: 0,
    offset: 2,
    timestamp: 1711440002000,
  },
];

describe('kafkaMessageToGraph', () => {
  it('converts messages to nodes using key as ID', () => {
    const graph = kafkaMessageToGraph(sampleMessages);

    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes[0].id).toBe('user-1');
    expect(graph.nodes[0].category).toBe('users');
    expect(graph.nodes[0].properties.name).toBe('Alice');
    expect(graph.edges).toHaveLength(0);
    expect(() => validateGraphData(graph)).not.toThrow();
  });

  it('creates edges when targetField is specified', () => {
    const graph = kafkaMessageToGraph(sampleMessages, {
      targetField: 'friend_id',
      relationship: 'KNOWS',
    });

    // Only 2 messages have friend_id
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges[0].source).toBe('user-1');
    expect(graph.edges[0].target).toBe('user-2');
    expect(graph.edges[0].relationship).toBe('KNOWS');
    expect(() => validateGraphData(graph)).not.toThrow();
  });

  it('uses custom nodeCategory', () => {
    const graph = kafkaMessageToGraph(sampleMessages, { nodeCategory: 'Person' });

    expect(graph.nodes.every((n) => n.category === 'Person')).toBe(true);
  });

  it('uses idField from value when specified', () => {
    const messages: KafkaMessage[] = [
      { key: null, value: { user_id: 'u1', name: 'Alice' }, topic: 'data' },
    ];
    const graph = kafkaMessageToGraph(messages, { idField: 'user_id' });

    expect(graph.nodes[0].id).toBe('u1');
  });

  it('falls back to topic+offset for ID when key and idField are absent', () => {
    const messages: KafkaMessage[] = [
      { key: null, value: { name: 'X' }, topic: 'events', offset: 42 },
    ];
    const graph = kafkaMessageToGraph(messages);

    expect(graph.nodes[0].id).toBe('kafka_events_42');
  });

  it('includes Kafka metadata when includeMetadata is true', () => {
    const graph = kafkaMessageToGraph(sampleMessages, { includeMetadata: true });

    const kafka = graph.nodes[0].properties._kafka as Record<string, unknown>;
    expect(kafka.topic).toBe('users');
    expect(kafka.partition).toBe(0);
    expect(kafka.offset).toBe(0);
  });

  it('excludes Kafka metadata when includeMetadata is false', () => {
    const graph = kafkaMessageToGraph(sampleMessages, { includeMetadata: false });

    expect(graph.nodes[0].properties._kafka).toBeUndefined();
  });

  it('handles empty message array', () => {
    const graph = kafkaMessageToGraph([]);

    expect(graph.nodes).toHaveLength(0);
    expect(graph.edges).toHaveLength(0);
    expect(() => validateGraphData(graph)).not.toThrow();
  });
});
