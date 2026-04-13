#!/usr/bin/env node
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { ensureConfigFiles } from '../graphxr_mcp_server/ensure_config';

/**
 * Run as part of prestart/predev to bootstrap missing config files.
 *
 * Searches for templates in the following order:
 *   1. <cwd>/config-defaults/       (Docker image baked-in defaults)
 *   2. <package-root>/config-defaults/
 *   3. <cwd>/config/*.example       (handled inside ensureConfigFiles)
 *   4. Hardcoded minimal fallback   (handled inside ensureConfigFiles)
 */

const candidates = [
  resolve(process.cwd(), 'config-defaults'),
  resolve(__dirname, '..', 'config-defaults'),
];

const defaultsDir = candidates.find((p) => existsSync(p));
const results = ensureConfigFiles({ baseDir: process.cwd(), defaultsDir });

for (const result of results) {
  switch (result.action) {
    case 'existed':
      console.log(`[ensure-config] ${result.path} already exists — no change`);
      break;
    case 'copied':
      console.log(`[ensure-config] Created ${result.path} from ${result.source}`);
      break;
    case 'created':
      console.log(`[ensure-config] Created ${result.path} with minimal fallback`);
      break;
  }
}
