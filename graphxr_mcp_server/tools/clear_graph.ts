/**
 * Tool: clear_graph
 * Removes all nodes and edges from the GraphXR canvas.
 */

import { IGraphXRClient } from '../graphxr_bridge';

export async function clearGraph(
  client: IGraphXRClient,
  _args: unknown
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  await client.clearGraph();
  return {
    content: [
      {
        type: 'text',
        text: 'GraphXR canvas cleared.',
      },
    ],
  };
}
