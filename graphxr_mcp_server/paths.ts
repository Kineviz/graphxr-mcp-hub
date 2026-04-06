/**
 * Path resolution utilities for npm/npx/Docker/local-dev compatibility.
 *
 * Config lookup order:
 *   1. GRAPHXR_CONFIG_DIR env var
 *   2. process.cwd()/config/   (local dev, Docker)
 *   3. <package-root>/config/  (npx / global install)
 */

import { resolve, dirname } from 'path';
import { existsSync } from 'fs';

/** Walk up from __dirname until we find the directory containing package.json. */
export function getPackageRoot(): string {
  let dir = __dirname;
  while (true) {
    if (existsSync(resolve(dir, 'package.json'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break; // filesystem root
    dir = parent;
  }
  // fallback: one level up from dist/graphxr_mcp_server/
  return resolve(__dirname, '..', '..');
}

/**
 * Resolve a config file (e.g. 'hub_config.yaml') by searching multiple locations.
 * Returns the first path that exists, or falls back to package-root location.
 */
export function resolveConfigPath(filename: string): string {
  const candidates: string[] = [];

  // 1. Env override
  if (process.env.GRAPHXR_CONFIG_DIR) {
    candidates.push(resolve(process.env.GRAPHXR_CONFIG_DIR, filename));
  }

  // 2. CWD (local dev / Docker)
  candidates.push(resolve(process.cwd(), 'config', filename));

  // 3. Package install directory
  candidates.push(resolve(getPackageRoot(), 'config', filename));

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  // Return package-root path even if it doesn't exist yet (for error messages)
  return candidates[candidates.length - 1];
}

/**
 * Resolve admin_ui/dist directory.
 * Returns the path if found, or null if the admin UI is not available.
 */
export function resolveAdminDist(): string | null {
  const candidates = [
    resolve(process.cwd(), 'admin_ui', 'dist'),
    resolve(getPackageRoot(), 'admin_ui', 'dist'),
  ];

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  return null;
}
