/**
 * Tool: get_nodes
 * Queries nodes from the graph currently displayed in GraphXR.
 */

import { z } from 'zod';
import { IGraphXRClient } from '../graphxr_bridge';

const GetNodesArgsSchema = z.object({
  filter: z.record(z.unknown()).optional(),
});

export async function getNodes(
  client: IGraphXRClient,
  args: unknown
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { filter } = GetNodesArgsSchema.parse(args ?? {});
  const nodes = await client.getNodes(filter);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(nodes, null, 2),
      },
    ],
  };
}
