/**
 * Tests for the Kafka message transformer.
 */

import { describe, it, expect } from 'vitest';
import { buildKafkaTransform, KafkaTransformConfig } from '../semantic_layer/transformers/kafka_transformer.js';
import type { KafkaMessage } from '../streaming/websocket_stream.js';

function makeMsg(value: unknown, overrides: Partial<KafkaMessage> = {}): KafkaMessage {
  return { key: 'k1', value, topic: 'test-topic', offset: 42, ...overrides };
}

describe('buildKafkaTransform — basic node creation', () => {
  it('creates a node from a single-object payload using idField', () => {
    const transform = buildKafkaTransform({ nodeCategory: 'Event', idField: 'event_id' });
    const result = transform(makeMsg({ event_id: 'e1', name: 'click' }), 'kafka-test');
    expect(result).not.toBeNull();
    expect(result!.nodes).toHaveLength(1);
    expect(result!.nodes[0].id).toBe('e1');
    expect(result!.nodes[0].category).toBe('Event');
  });

  it('falls back to message key when idField is missing', () => {
    const transform = buildKafkaTransform({ idField: 'id' });
    const result = transform(makeMsg({ name: 'no-id-field' }, { key: 'kafka-key' }), 'src');
    expect(result!.nodes[0].id).toBe('kafka-key');
  });

  it('uses default nodeCategory KafkaEvent when not specified', () => {
    const transform = buildKafkaTransform();
    const result = transform(makeMsg({ id: '1' }), 'src');
    expect(result!.nodes[0].category).toBe('KafkaEvent');
  });

  it('returns null for null payload', () => {
    const transform = buildKafkaTransform();
    expect(transform(makeMsg(null), 'src')).toBeNull();
  });

  it('returns null for undefined payload', () => {
    const transform = buildKafkaTransform();
    expect(transform(makeMsg(undefined), 'src')).toBeNull();
  });

  it('handles array payloads — creates one node per item', () => {
    const transform = buildKafkaTransform({ nodeCategory: 'Item', idField: 'id' });
    const result = transform(makeMsg([{ id: 'a' }, { id: 'b' }, { id: 'c' }]), 'src');
    expect(result!.nodes).toHaveLength(3);
    expect(result!.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('buildKafkaTransform — edge creation', () => {
  it('creates edges when targetField is provided', () => {
    const transform = buildKafkaTransform({
      idField: 'from',
      targetField: 'to',
      relationship: 'FOLLOWS',
    });
    const result = transform(
      makeMsg([
        { from: 'u1', to: 'u2' },
        { from: 'u2', to: 'u3' },
      ]),
      'src'
    );
    expect(result!.edges).toHaveLength(2);
    expect(result!.edges[0].source).toBe('u1');
    expect(result!.edges[0].target).toBe('u2');
    expect(result!.edges[0].relationship).toBe('FOLLOWS');
  });

  it('skips edges when targetField value is null', () => {
    const transform = buildKafkaTransform({ idField: 'id', targetField: 'parent_id' });
    const result = transform(makeMsg([{ id: '1', parent_id: null }, { id: '2', parent_id: '1' }]), 'src');
    expect(result!.edges).toHaveLength(1);
    expect(result!.edges[0].source).toBe('2');
    expect(result!.edges[0].target).toBe('1');
  });

  it('produces no edges when targetField is not set', () => {
    const transform = buildKafkaTransform({ idField: 'id' });
    const result = transform(makeMsg({ id: 'x' }), 'src');
    expect(result!.edges).toHaveLength(0);
  });
});

describe('buildKafkaTransform — field selection', () => {
  it('includes only selected fields when selectFields is true', () => {
    const transform = buildKafkaTransform({
      idField: 'id',
      selectFields: true,
      includeFields: ['name', 'age'],
    } as KafkaTransformConfig);
    const result = transform(makeMsg({ id: '1', name: 'Alice', age: 30, secret: 'hidden' }), 'src');
    expect(result!.nodes[0].properties['name']).toBe('Alice');
    expect(result!.nodes[0].properties['age']).toBe(30);
    expect(result!.nodes[0].properties['secret']).toBeUndefined();
  });
});

describe('buildKafkaTransform — lineage', () => {
  it('attaches lineage with source name, topic, and offset', () => {
    const transform = buildKafkaTransform({ idField: 'id' });
    const result = transform(
      makeMsg({ id: 'e1' }, { topic: 'my-topic', offset: 99 }),
      'kafka-prod'
    );
    const lineage = result!.nodes[0]._lineage;
    expect(lineage?.source).toBe('kafka-prod');
    expect(lineage?.file).toBe('my-topic');
    expect(lineage?.query).toBe('offset:99');
    expect(lineage?.fetchedAt).toBeTruthy();
  });
});
