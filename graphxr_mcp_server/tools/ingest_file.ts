/**
 * Tool: ingest_file
 *
 * Loads a data file (CSV, JSON, Parquet) into the Hub's built-in DuckDB
 * and returns the schema + sample data. DuckDB is auto-initialized on first call.
 *
 * Accepts either a file_path or raw file_content (for inline data from Agent).
 */

import { z } from 'zod';
import { DuckDBManager } from '../duckdb_manager';

const IngestFileArgsSchema = z.object({
  /** Path to the data file (CSV, JSON, Parquet). */
  file_path: z.string().optional(),
  /** Raw file content (CSV or JSON string). Used when Agent passes inline data. */
  file_content: z.string().optional(),
  /** File format hint: "csv", "json", "parquet". Auto-detected from file_path if omitted. */
  format: z.enum(['csv', 'json', 'parquet']).optional(),
  /** Custom table name. Auto-generated from filename if omitted. */
  table_name: z.string().optional(),
});

export async function ingestFile(
  duckdb: DuckDBManager,
  args: unknown
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { file_path, file_content, format, table_name } = IngestFileArgsSchema.parse(args);

  if (!file_path && !file_content) {
    return {
      content: [{
        type: 'text',
        text: 'Error: Either file_path or file_content must be provided.',
      }],
    };
  }

  try {
    let result;
    if (file_content) {
      result = await duckdb.ingestContent(file_content, format ?? 'csv', table_name);
    } else {
      result = await duckdb.ingestFile(file_path!, table_name);
    }

    const schemaStr = result.columns
      .map((c) => `  ${c.name}: ${c.type}`)
      .join('\n');

    const response = {
      table_name: result.tableName,
      columns: result.columns,
      row_count: result.rowCount,
      file_format: result.fileFormat,
      sample_rows: result.sampleRows,
    };

    return {
      content: [{
        type: 'text',
        text: `Data loaded into table "${result.tableName}" (${result.fileFormat.toUpperCase()}, ${result.rowCount} rows).\n\nSchema:\n${schemaStr}\n\nYou can now query this data using the query_data tool with SQL like:\n  SELECT * FROM "${result.tableName}"\n\nFull result:\n${JSON.stringify(response, null, 2)}`,
      }],
    };
  } catch (err) {
    return {
      content: [{
        type: 'text',
        text: `Error ingesting file: ${err instanceof Error ? err.message : String(err)}`,
      }],
    };
  }
}
