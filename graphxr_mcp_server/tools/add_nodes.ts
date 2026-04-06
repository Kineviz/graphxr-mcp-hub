/**
 * Tool: add_nodes
 * Incrementally adds nodes to the current GraphXR graph.
 */

import { z } from 'zod';
import { IGraphXRClient } from '../graphxr_bridge';
import { GraphNodeSchema } from '../../semantic_layer/graph_schema';
import { generateOperationId, LineageTracker } from '../../semantic_layer/lineage';

const AddNodesArgsSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  source: z.string().optional(),
});

export async function addNodes(
  client: IGraphXRClient,
  args: unknown,
  lineageTracker?: LineageTracker
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { nodes, source } = AddNodesArgsSchema.parse(args);
  const operationId = generateOperationId();
  const lineage = {
    source: source ?? 'mcp-client',
    operation: 'add_nodes',
    timestamp: new Date().toISOString(),
    operationId,
  };
  await client.addNodes(nodes);
  lineageTracker?.record({ ...lineage, nodeCount: nodes.length, edgeCount: 0 });
  return {
    content: [
      {
        type: 'text',
        text: `Added ${nodes.length} node(s) to GraphXR. [${operationId}]`,
      },
    ],
  };
}
