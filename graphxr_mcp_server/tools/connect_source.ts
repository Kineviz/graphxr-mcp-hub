/**
 * Tool: connect_source
 *
 * Allows the Agent to dynamically connect to a data source on-demand.
 * Supports both pre-configured sources (by name) and new sources (with full params).
 */

import { z } from 'zod';
import { SourceManager } from '../source_manager';

const ConnectSourceArgsSchema = z.object({
  /** Name of a pre-configured source to connect (e.g., "toolbox", "filesystem"). */
  name: z.string(),
  /** Transport type for new sources: "sse" or "stdio". */
  transport: z.enum(['sse', 'stdio']).optional(),
  /** SSE URL (for transport=sse). */
  url: z.string().optional(),
  /** Command to spawn (for transport=stdio). */
  command: z.string().optional(),
  /** Command arguments (for transport=stdio). */
  args: z.array(z.string()).optional(),
  /** Description of the data source. */
  description: z.string().optional(),
});

export async function connectSource(
  sourceManager: SourceManager,
  toolArgs: unknown
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const { name, transport, url, command, args, description } = ConnectSourceArgsSchema.parse(toolArgs);

  // If transport is provided, this is a new source — add and connect
  if (transport) {
    const result = await sourceManager.addSource({
      name,
      transport,
      url,
      command,
      args,
      description,
    });

    if (result.connected) {
      const status = sourceManager.getStatus().find((s) => s.name === name);
      return {
        content: [{
          type: 'text',
          text: `Source "${name}" connected successfully.\nAvailable tools: ${status?.tools.join(', ') ?? 'none'}`,
        }],
      };
    }
    return {
      content: [{
        type: 'text',
        text: `Failed to connect source "${name}": ${result.error}`,
      }],
    };
  }

  // Otherwise, try to connect a pre-configured source by name
  const connected = await sourceManager.connectByName(name);
  if (connected) {
    const status = sourceManager.getStatus().find((s) => s.name === name);
    return {
      content: [{
        type: 'text',
        text: `Source "${name}" connected successfully.\nAvailable tools: ${status?.tools.join(', ') ?? 'none'}`,
      }],
    };
  }

  // Not found in config — provide guidance
  return {
    content: [{
      type: 'text',
      text: `Source "${name}" not found in configuration.\n\nTo connect a new source, provide transport details:\n` +
        `  connect_source({ name: "${name}", transport: "stdio", command: "npx", args: ["-y", "@package/name"] })\n` +
        `  connect_source({ name: "${name}", transport: "sse", url: "http://localhost:PORT/sse" })`,
    }],
  };
}
