/**
 * Tool: get_edges
 * Queries edges from the graph currently displayed in GraphXR.
 */

import { z } from 'zod';
import { IGraphXRClient } from '../graphxr_bridge';

const GetEdgesArgsSchema = z.object({
  filter: z.record(z.unknown()).optional(),
});

export async function getEdges(
  client: IGraphXRClient,
  args: unknown
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { filter } = GetEdgesArgsSchema.parse(args ?? {});
  const edges = await client.getEdges(filter);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(edges, null, 2),
      },
    ],
  };
}
