/**
 * MCP tools: stream_unsubscribe + stream_list
 *
 * stream_unsubscribe — stops a running stream subscription by ID.
 * stream_list        — lists all active stream subscriptions.
 */

import { StreamManager } from '../../streaming/stream_manager.js';

export function streamUnsubscribe(
  streamManager: StreamManager,
  args: Record<string, unknown> | undefined
): { content: Array<{ type: string; text: string }> } {
  const id = args?.['id'] as string | undefined;
  if (!id) {
    throw new Error('stream_unsubscribe: "id" argument is required.');
  }
  const ok = streamManager.unsubscribe(id);
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          id,
          success: ok,
          message: ok ? `Subscription "${id}" stopped.` : `Subscription "${id}" not found.`,
        }),
      },
    ],
  };
}

export function streamList(
  streamManager: StreamManager
): { content: Array<{ type: string; text: string }> } {
  const subs = streamManager.listSubscriptions();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({ subscriptions: subs, total: subs.length }),
      },
    ],
  };
}
