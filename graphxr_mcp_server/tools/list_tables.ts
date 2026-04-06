/**
 * Tool: list_tables
 *
 * Lists all tables currently loaded in the Hub's built-in DuckDB.
 */

import { DuckDBManager } from '../duckdb_manager';

export async function listTables(
  duckdb: DuckDBManager
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  if (!duckdb.isInitialized) {
    return {
      content: [{
        type: 'text',
        text: 'No data loaded yet. Use ingest_file to load a data file first.',
      }],
    };
  }

  try {
    const tables = await duckdb.listTables();

    if (tables.length === 0) {
      return {
        content: [{
          type: 'text',
          text: 'No tables loaded.',
        }],
      };
    }

    const summary = tables.map((t) => {
      const cols = t.columns.map((c) => `${c.name}:${c.type}`).join(', ');
      return `  ${t.name} (${t.rowCount} rows) — [${cols}]`;
    }).join('\n');

    return {
      content: [{
        type: 'text',
        text: `${tables.length} table(s) loaded:\n${summary}\n\n${JSON.stringify(tables, null, 2)}`,
      }],
    };
  } catch (err) {
    return {
      content: [{
        type: 'text',
        text: `Error listing tables: ${err instanceof Error ? err.message : String(err)}`,
      }],
    };
  }
}
