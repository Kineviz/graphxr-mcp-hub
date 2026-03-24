/**
 * MCP tool: stream_subscribe
 *
 * Registers a real-time streaming data source (WebSocket / Kafka-over-WS)
 * and begins pushing incremental graph updates to GraphXR as messages arrive.
 *
 * Returns a subscription ID that can be passed to stream_unsubscribe to stop.
 */

import { StreamManager } from '../../streaming/stream_manager.js';
import { WebSocketStreamAdapter } from '../../streaming/websocket_stream.js';
import { buildKafkaTransform, KafkaTransformConfig } from '../../semantic_layer/transformers/kafka_transformer.js';

export async function streamSubscribe(
  streamManager: StreamManager,
  args: Record<string, unknown> | undefined
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const url = args?.['url'] as string | undefined;
  if (!url) {
    throw new Error('stream_subscribe: "url" argument is required.');
  }

  const name = (args?.['name'] as string | undefined) ?? 'kafka-stream';
  const mode = (args?.['mode'] as 'incremental' | 'replace' | undefined) ?? 'incremental';
  const transformConfig = (args?.['transform'] as KafkaTransformConfig | undefined) ?? {};

  const adapter = new WebSocketStreamAdapter({
    name,
    url,
    mode,
    autoReconnect: true,
    reconnectDelayMs: 3_000,
    transform: buildKafkaTransform(transformConfig),
  });

  const subscriptionId = await streamManager.subscribe(adapter);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          subscriptionId,
          url,
          name,
          mode,
          status: 'connecting',
          message: `Stream subscription started. Use stream_unsubscribe with id "${subscriptionId}" to stop.`,
        }),
      },
    ],
  };
}
