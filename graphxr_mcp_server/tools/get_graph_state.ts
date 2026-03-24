/**
 * Tool: get_graph_state
 * Returns a summary of the graph currently displayed in GraphXR.
 */

import { GraphXRClient } from '../graphxr_client.js';

export async function getGraphState(
  client: GraphXRClient,
  _args: unknown
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const state = await client.getGraphState();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(state, null, 2),
      },
    ],
  };
}
