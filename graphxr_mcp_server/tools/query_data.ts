/**
 * Tool: query_data
 *
 * Executes SQL queries against data loaded in DuckDB.
 * Optionally transforms results to GraphData and pushes to GraphXR.
 */

import { z } from 'zod';
import { DuckDBManager } from '../duckdb_manager';
import { IGraphXRClient } from '../graphxr_bridge';
import { csvResultToGraph } from '../../semantic_layer/transformers/csv_transformer';
import { attachLineage, generateOperationId, LineageTracker } from '../../semantic_layer/lineage';

const QueryDataArgsSchema = z.object({
  /** SQL query to execute against loaded data. */
  sql: z.string(),
  /** If true, transform results to graph data and push to GraphXR. */
  push_to_graphxr: z.boolean().optional().default(false),
  /** Configuration for graph transformation (used when push_to_graphxr is true). */
  transform_config: z.object({
    nodeCategory: z.string().optional(),
    idColumn: z.string().optional(),
    targetColumn: z.string().optional(),
    relationship: z.string().optional(),
  }).optional(),
});

export async function queryData(
  duckdb: DuckDBManager,
  graphxrClient: IGraphXRClient,
  args: unknown,
  lineageTracker?: LineageTracker
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { sql, push_to_graphxr, transform_config } = QueryDataArgsSchema.parse(args);

  if (!duckdb.isInitialized) {
    return {
      content: [{
        type: 'text',
        text: 'No data loaded. Use ingest_file first to load a data file.',
      }],
    };
  }

  try {
    const { rows, rowCount } = await duckdb.querySQL(sql);

    if (!push_to_graphxr) {
      return {
        content: [{
          type: 'text',
          text: `Query returned ${rowCount} row(s).\n\n${JSON.stringify(rows, null, 2)}`,
        }],
      };
    }

    // Transform to graph and push
    const graphData = csvResultToGraph(rows, {
      nodeCategory: transform_config?.nodeCategory ?? 'Record',
      idColumn: transform_config?.idColumn ?? 'id',
      targetColumn: transform_config?.targetColumn ?? undefined,
      relationship: transform_config?.relationship ?? 'RELATED_TO',
    });

    // Attach lineage
    const operationId = generateOperationId();
    const lineage = {
      source: `duckdb:${sql.slice(0, 50)}`,
      operation: 'query_data',
      timestamp: new Date().toISOString(),
      operationId,
    };
    const tagged = attachLineage(graphData, lineage);

    await graphxrClient.pushGraph(tagged);
    lineageTracker?.record({
      ...lineage,
      nodeCount: tagged.nodes.length,
      edgeCount: tagged.edges.length,
    });

    return {
      content: [{
        type: 'text',
        text: `Query returned ${rowCount} row(s). Pushed to GraphXR: ${tagged.nodes.length} node(s), ${tagged.edges.length} edge(s). [${operationId}]`,
      }],
    };
  } catch (err) {
    return {
      content: [{
        type: 'text',
        text: `Query error: ${err instanceof Error ? err.message : String(err)}`,
      }],
    };
  }
}
