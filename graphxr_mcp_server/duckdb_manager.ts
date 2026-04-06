/**
 * DuckDB Manager — In-process database for file data ingestion
 *
 * Lazily initializes an in-memory DuckDB instance. Supports loading
 * CSV, JSON, and Parquet files into queryable tables, with automatic
 * schema inference.
 *
 * Supported file formats:
 *   - CSV  → read_csv_auto()
 *   - JSON → read_json_auto()
 *   - Parquet → read_parquet()
 */

import duckdb from 'duckdb';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join, basename, extname } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ColumnSchema {
  name: string;
  type: string;
}

export interface TableInfo {
  name: string;
  columns: ColumnSchema[];
  rowCount: number;
}

export interface IngestResult {
  tableName: string;
  columns: ColumnSchema[];
  rowCount: number;
  sampleRows: Record<string, unknown>[];
  fileFormat: string;
}

// ---------------------------------------------------------------------------
// DuckDB Manager (singleton, lazy-init)
// ---------------------------------------------------------------------------

export class DuckDBManager {
  private db: duckdb.Database | null = null;
  private conn: duckdb.Connection | null = null;
  private tables = new Map<string, TableInfo>();

  /** Ensure DuckDB is initialized. */
  private ensureInit(): duckdb.Connection {
    if (!this.db) {
      this.db = new duckdb.Database(':memory:');
      this.conn = this.db.connect();
    }
    return this.conn!;
  }

  /** Promisified query returning all rows (BigInts converted to Numbers). */
  private query(sql: string): Promise<duckdb.TableData> {
    const conn = this.ensureInit();
    return new Promise((resolve, reject) => {
      conn.all(sql, (err: duckdb.DuckDbError | null, rows: duckdb.TableData) => {
        if (err) reject(err);
        else resolve(rows.map((row) => this.convertBigInts(row)));
      });
    });
  }

  /** Convert BigInt values to regular numbers (DuckDB returns BigInt for integer columns). */
  private convertBigInts(row: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'bigint') {
        result[key] = Number(value);
      } else if (Array.isArray(value)) {
        result[key] = value.map((v) => typeof v === 'bigint' ? Number(v) : v);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /** Promisified exec (no result). */
  private exec(sql: string): Promise<void> {
    const conn = this.ensureInit();
    return new Promise((resolve, reject) => {
      conn.exec(sql, (err: duckdb.DuckDbError | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Detect file format from extension. */
  private detectFormat(filePath: string): string {
    const ext = extname(filePath).toLowerCase();
    switch (ext) {
      case '.csv': case '.tsv': return 'csv';
      case '.json': case '.jsonl': case '.ndjson': return 'json';
      case '.parquet': case '.pq': return 'parquet';
      default: return 'csv'; // default to CSV
    }
  }

  /** Get the DuckDB read function for a file format. */
  private getReadFunction(format: string): string {
    switch (format) {
      case 'csv': return 'read_csv_auto';
      case 'json': return 'read_json_auto';
      case 'parquet': return 'read_parquet';
      default: return 'read_csv_auto';
    }
  }

  /**
   * Ingest a file (by path) into DuckDB as a new table.
   * Supports CSV, JSON, Parquet — auto-detects format from extension.
   */
  async ingestFile(filePath: string, tableName?: string): Promise<IngestResult> {
    const format = this.detectFormat(filePath);
    const readFn = this.getReadFunction(format);
    const name = tableName ?? this.sanitizeTableName(basename(filePath, extname(filePath)));
    const escapedPath = filePath.replace(/\\/g, '/'); // DuckDB uses forward slashes

    // Drop table if exists, then create from file
    await this.exec(`DROP TABLE IF EXISTS "${name}"`);
    await this.exec(`CREATE TABLE "${name}" AS SELECT * FROM ${readFn}('${escapedPath}')`);

    return this.getTableResult(name, format);
  }

  /**
   * Ingest raw content (CSV/JSON string) into DuckDB.
   * Writes to a temp file, loads it, then cleans up.
   */
  async ingestContent(content: string, format: string = 'csv', tableName?: string): Promise<IngestResult> {
    const ext = format === 'json' ? '.json' : '.csv';
    const name = tableName ?? `data_${Date.now()}`;
    const tmpPath = join(tmpdir(), `graphxr_mcp_${name}${ext}`);

    try {
      writeFileSync(tmpPath, content, 'utf-8');
      return await this.ingestFile(tmpPath, name);
    } finally {
      try { unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }

  /** Execute a SQL query and return results. */
  async querySQL(sql: string): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> {
    this.ensureInit();
    const rows = await this.query(sql);
    return { rows, rowCount: rows.length };
  }

  /** List all loaded tables. */
  async listTables(): Promise<TableInfo[]> {
    this.ensureInit();
    const tables = await this.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'main'`
    );

    const result: TableInfo[] = [];
    for (const row of tables) {
      const name = row.table_name as string;
      const cached = this.tables.get(name);
      if (cached) {
        result.push(cached);
      } else {
        const info = await this.describeTable(name);
        if (info) result.push(info);
      }
    }
    return result;
  }

  /** Get column schema for a table. */
  async describeTable(tableName: string): Promise<TableInfo | null> {
    try {
      const cols = await this.query(`DESCRIBE "${tableName}"`);
      const countResult = await this.query(`SELECT COUNT(*) as cnt FROM "${tableName}"`);

      const info: TableInfo = {
        name: tableName,
        columns: cols.map((c) => ({
          name: c.column_name as string,
          type: c.column_type as string,
        })),
        rowCount: (countResult[0]?.cnt as number) ?? 0,
      };
      this.tables.set(tableName, info);
      return info;
    } catch {
      return null;
    }
  }

  /** Whether the manager has been initialized (any table loaded). */
  get isInitialized(): boolean {
    return this.db !== null;
  }

  /** Close DuckDB. */
  close(): void {
    this.conn?.close();
    this.db?.close();
    this.conn = null;
    this.db = null;
    this.tables.clear();
  }

  private async getTableResult(name: string, format: string): Promise<IngestResult> {
    const cols = await this.query(`DESCRIBE "${name}"`);
    const countResult = await this.query(`SELECT COUNT(*) as cnt FROM "${name}"`);
    const sampleRows = await this.query(`SELECT * FROM "${name}" LIMIT 5`);

    const columns = cols.map((c) => ({
      name: c.column_name as string,
      type: c.column_type as string,
    }));
    const rowCount = (countResult[0]?.cnt as number) ?? 0;

    this.tables.set(name, { name, columns, rowCount });

    return { tableName: name, columns, rowCount, sampleRows, fileFormat: format };
  }

  private sanitizeTableName(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
  }
}
