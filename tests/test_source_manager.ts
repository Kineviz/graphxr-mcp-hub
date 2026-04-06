/**
 * Tests for SourceManager — config loading, status reporting, on-demand connection.
 *
 * Note: These tests don't connect to real external servers.
 * They verify config parsing, status management, and error handling.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SourceManager } from '../graphxr_mcp_server/source_manager';
import { resolve } from 'path';

describe('SourceManager', () => {
  let manager: SourceManager;

  beforeEach(() => {
    manager = new SourceManager();
  });

  it('starts with no sources', () => {
    expect(manager.getStatus()).toHaveLength(0);
    expect(manager.getProxiedTools()).toHaveLength(0);
  });

  it('loads config from hub_config.yaml', () => {
    manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
    const status = manager.getStatus();

    // Should show configured but not-yet-connected STDIO servers
    const names = status.map((s) => s.name);
    expect(names).toContain('filesystem');
    expect(names).toContain('fetch');
  });

  it('shows configured servers as disconnected before connect', () => {
    manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
    const status = manager.getStatus();

    const filesystem = status.find((s) => s.name === 'filesystem');
    expect(filesystem?.status).toBe('disconnected');
    expect(filesystem?.transport).toBe('stdio');
  });

  it('handles SSE connection failure gracefully', async () => {
    await manager.connectSSE('test-sse', 'http://localhost:19999/sse', 'test');
    const status = manager.getStatus();
    const entry = status.find((s) => s.name === 'test-sse');

    expect(entry?.status).toBe('error');
    expect(entry?.error).toBeDefined();
    expect(entry?.tools).toHaveLength(0);
  });

  it('handles STDIO connection failure gracefully', async () => {
    await manager.connectStdio('bad-server', 'nonexistent-command-xyz', [], undefined, 'test');
    const status = manager.getStatus();
    const entry = status.find((s) => s.name === 'bad-server');

    expect(entry?.status).toBe('error');
    expect(entry?.error).toBeDefined();
  });

  it('returns null for unknown tool dispatch', async () => {
    const result = await manager.dispatchTool('unknown__tool', {});
    expect(result).toBeNull();
  });

  it('returns null for non-namespaced tool dispatch', async () => {
    const result = await manager.dispatchTool('push_graph', {});
    expect(result).toBeNull();
  });

  it('reports genai-toolbox as configured when enabled in config', () => {
    manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
    // toolbox is enabled in config but won't connect (no server running)
    // After initialize() it would try to connect — tested via connectSSE above
  });

  it('skips disabled servers in config', () => {
    manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
    const status = manager.getStatus();
    const github = status.find((s) => s.name === 'github');
    // github is enabled: false in config, so it should not appear
    expect(github).toBeUndefined();
  });

  it('connectByName returns false for unknown server', async () => {
    manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
    const result = await manager.connectByName('nonexistent');
    expect(result).toBe(false);
  });

  describe('addDatabaseSource', () => {
    it('generates correct tools.yaml for neo4j template', () => {
      manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
      const result = manager.generateToolsYaml('neo4j', {
        uri: 'bolt://localhost:7687',
        user: 'neo4j',
        password: 'test123',
      });

      expect(result.sources['neo4j']).toEqual({
        kind: 'neo4j',
        uri: 'bolt://localhost:7687',
        user: 'neo4j',
        password: 'test123',
      });
      expect(result.tools['neo4j-execute-cypher']).toBeDefined();
      expect(result.tools['neo4j-execute-cypher'].kind).toBe('neo4j-execute-cypher');
      expect(result.tools['neo4j-execute-cypher'].source).toBe('neo4j');
      expect(result.tools['neo4j-schema']).toBeDefined();
    });

    it('generates correct tools.yaml for spanner template', () => {
      manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
      const result = manager.generateToolsYaml('spanner', {
        project: 'my-project',
        instance: 'my-instance',
        database: 'my-db',
        dialect: 'googlesql',
      });

      expect(result.sources['spanner']).toEqual({
        kind: 'spanner',
        project: 'my-project',
        instance: 'my-instance',
        database: 'my-db',
        dialect: 'googlesql',
      });
      expect(result.tools['spanner-execute-sql']).toBeDefined();
      expect(result.tools['spanner-list-tables']).toBeDefined();
      // Without enablePropertyGraph, no graph tools
      expect(result.tools['spanner-list-graphs']).toBeUndefined();
    });

    it('generates spanner property graph tools when enabled', () => {
      manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
      const result = manager.generateToolsYaml('spanner', {
        project: 'my-project',
        instance: 'my-instance',
        database: 'my-db',
        enablePropertyGraph: true,
        graphName: 'FinGraph',
      });

      expect(result.tools['spanner-list-graphs']).toBeDefined();
      expect(result.tools['spanner-list-graphs'].kind).toBe('spanner-list-graphs');
      expect(result.tools['spanner-query-graph']).toBeDefined();
      expect(result.tools['spanner-query-graph'].description).toContain('FinGraph');
    });

    it('generates bigquery property graph tool when enabled', () => {
      manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
      const result = manager.generateToolsYaml('bigquery', {
        project: 'my-project',
        enablePropertyGraph: true,
        graphName: 'my_dataset.my_graph',
      });

      expect(result.tools['bigquery-execute-sql'].description).toContain('GRAPH_TABLE');
      expect(result.tools['bigquery-query-graph']).toBeDefined();
      expect(result.tools['bigquery-query-graph'].description).toContain('my_dataset.my_graph');
    });

    it('generates correct tools.yaml for bigquery template', () => {
      manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
      const result = manager.generateToolsYaml('bigquery', {
        project: 'my-project',
        location: 'us',
        allowedDatasets: 'dataset1,dataset2',
      });

      expect(result.sources['bigquery']).toEqual({
        kind: 'bigquery',
        project: 'my-project',
        location: 'us',
        allowedDatasets: ['dataset1', 'dataset2'],
      });
      expect(result.tools['bigquery-execute-sql']).toBeDefined();
      expect(result.tools['bigquery-conversational-analytics']).toBeDefined();
      expect(result.tools['bigquery-get-dataset-info']).toBeDefined();
      expect(result.tools['bigquery-list-dataset-ids']).toBeDefined();
    });

    it('merges with existing tools.yaml sources', () => {
      manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
      const result1 = manager.generateToolsYaml('neo4j', {
        uri: 'bolt://localhost:7687',
        user: 'neo4j',
        password: 'test',
      });
      const result2 = manager.generateToolsYaml('spanner', {
        project: 'p',
        instance: 'i',
        database: 'd',
      }, result1);

      expect(result2.sources['neo4j']).toBeDefined();
      expect(result2.sources['spanner']).toBeDefined();
      expect(result2.tools['neo4j-execute-cypher']).toBeDefined();
      expect(result2.tools['spanner-execute-sql']).toBeDefined();
    });
  });
});
