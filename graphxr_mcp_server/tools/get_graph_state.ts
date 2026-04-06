/**
 * Tool: get_graph_state
 * Returns a summary of the graph currently displayed in GraphXR.
 */

import { IGraphXRClient } from '../graphxr_bridge';

export async function getGraphState(
  client: IGraphXRClient,
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
