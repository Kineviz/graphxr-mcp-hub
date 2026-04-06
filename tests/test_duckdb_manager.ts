/**
 * Tests for DuckDB Manager and data ingestion tools.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DuckDBManager } from '../graphxr_mcp_server/duckdb_manager';
import { ingestFile } from '../graphxr_mcp_server/tools/ingest_file';
import { listTables } from '../graphxr_mcp_server/tools/list_tables';
import { resolve } from 'path';

describe('DuckDBManager', () => {
  let db: DuckDBManager;

  beforeEach(() => {
    db = new DuckDBManager();
  });

  afterEach(() => {
    db.close();
  });

  it('starts uninitialized', () => {
    expect(db.isInitialized).toBe(false);
  });

  it('auto-initializes on first ingest', async () => {
    const csvPath = resolve(process.cwd(), 'data/sample.csv');
    await db.ingestFile(csvPath, 'users');
    expect(db.isInitialized).toBe(true);
  });

  it('ingests CSV file and returns schema', async () => {
    const csvPath = resolve(process.cwd(), 'data/sample.csv');
    const result = await db.ingestFile(csvPath, 'users');

    expect(result.tableName).toBe('users');
    expect(result.fileFormat).toBe('csv');
    expect(result.rowCount).toBeGreaterThan(0);
    expect(result.columns.length).toBeGreaterThan(0);
    expect(result.columns.some((c) => c.name === 'name')).toBe(true);
    expect(result.sampleRows.length).toBeGreaterThan(0);
    expect(result.sampleRows.length).toBeLessThanOrEqual(5);
  });

  it('ingests JSON file and returns schema', async () => {
    const jsonPath = resolve(process.cwd(), 'data/sample.json');
    const result = await db.ingestFile(jsonPath, 'posts');

    expect(result.tableName).toBe('posts');
    expect(result.fileFormat).toBe('json');
    expect(result.rowCount).toBeGreaterThan(0);
    expect(result.columns.some((c) => c.name === 'title')).toBe(true);
  });

  it('ingests raw CSV content', async () => {
    const csvContent = 'id,name,age\n1,Alice,30\n2,Bob,25\n3,Carol,35';
    const result = await db.ingestContent(csvContent, 'csv', 'inline_users');

    expect(result.tableName).toBe('inline_users');
    expect(result.rowCount).toBe(3);
    expect(result.columns.some((c) => c.name === 'name')).toBe(true);
  });

  it('ingests raw JSON content', async () => {
    const jsonContent = '[{"id":"1","name":"Alice"},{"id":"2","name":"Bob"}]';
    const result = await db.ingestContent(jsonContent, 'json', 'inline_json');

    expect(result.tableName).toBe('inline_json');
    expect(result.rowCount).toBe(2);
  });

  it('executes SQL queries on loaded data', async () => {
    const csvContent = 'id,name,age\n1,Alice,30\n2,Bob,25\n3,Carol,35';
    await db.ingestContent(csvContent, 'csv', 'people');

    const { rows, rowCount } = await db.querySQL('SELECT * FROM people WHERE age > 26');
    expect(rowCount).toBe(2);
    expect(rows.every((r) => (r.age as number) > 26)).toBe(true);
  });

  it('supports aggregate queries', async () => {
    const csvContent = 'id,name,city\n1,Alice,NY\n2,Bob,NY\n3,Carol,LA';
    await db.ingestContent(csvContent, 'csv', 'cities');

    const { rows } = await db.querySQL('SELECT city, COUNT(*) as cnt FROM cities GROUP BY city ORDER BY cnt DESC');
    expect(rows[0].city).toBe('NY');
    expect(rows[0].cnt).toBe(2);
  });

  it('lists loaded tables', async () => {
    await db.ingestContent('id,name\n1,A\n2,B', 'csv', 'table_a');
    await db.ingestContent('id,val\n1,X', 'csv', 'table_b');

    const tables = await db.listTables();
    expect(tables.length).toBe(2);
    expect(tables.map((t) => t.name).sort()).toEqual(['table_a', 'table_b']);
  });

  it('replaces table on re-ingest', async () => {
    await db.ingestContent('id,name\n1,A\n2,B', 'csv', 'tbl');
    let result = await db.querySQL('SELECT COUNT(*) as cnt FROM tbl');
    expect(result.rows[0].cnt).toBe(2);

    await db.ingestContent('id,name\n1,X\n2,Y\n3,Z', 'csv', 'tbl');
    result = await db.querySQL('SELECT COUNT(*) as cnt FROM tbl');
    expect(result.rows[0].cnt).toBe(3);
  });
});

describe('ingest_file tool', () => {
  let db: DuckDBManager;

  beforeEach(() => {
    db = new DuckDBManager();
  });

  afterEach(() => {
    db.close();
  });

  it('ingests CSV via file_content', async () => {
    const result = await ingestFile(db, {
      file_content: 'id,name\n1,Alice\n2,Bob',
      format: 'csv',
      table_name: 'test_csv',
    });

    expect(result.content[0].text).toContain('test_csv');
    expect(result.content[0].text).toContain('2 rows');
  });

  it('returns error when no file_path or file_content', async () => {
    const result = await ingestFile(db, {});
    expect(result.content[0].text).toContain('Error');
  });
});

describe('list_tables tool', () => {
  let db: DuckDBManager;

  beforeEach(() => {
    db = new DuckDBManager();
  });

  afterEach(() => {
    db.close();
  });

  it('reports no data when uninitialized', async () => {
    const result = await listTables(db);
    expect(result.content[0].text).toContain('No data loaded');
  });

  it('lists tables after ingestion', async () => {
    await db.ingestContent('id,v\n1,a', 'csv', 'my_table');
    const result = await listTables(db);
    expect(result.content[0].text).toContain('my_table');
    expect(result.content[0].text).toContain('1 table(s)');
  });
});
