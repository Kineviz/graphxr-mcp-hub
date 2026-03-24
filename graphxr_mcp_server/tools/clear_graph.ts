/**
 * Tool: clear_graph
 * Removes all nodes and edges from the GraphXR canvas.
 */

import { GraphXRClient } from '../graphxr_client.js';

export async function clearGraph(
  client: GraphXRClient,
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
