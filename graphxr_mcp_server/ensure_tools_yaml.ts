import { existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type EnsureAction = 'existed' | 'copied' | 'created';

export interface EnsureResult {
  action: EnsureAction;
  path: string;
}

/**
 * Ensure config/tools.yaml exists in the given base directory.
 *
 * - tools.yaml exists → no-op (action = 'existed')
 * - tools.yaml.example exists → copy it (action = 'copied')
 * - neither exists → write minimal empty shell (action = 'created')
 */
export function ensureToolsYaml(baseDir: string = process.cwd()): EnsureResult {
  const target = resolve(baseDir, 'config/tools.yaml');
  const template = resolve(baseDir, 'config/tools.yaml.example');

  if (existsSync(target)) {
    return { action: 'existed', path: target };
  }

  if (existsSync(template)) {
    copyFileSync(template, target);
    return { action: 'copied', path: target };
  }

  writeFileSync(target, 'sources: {}\ntools: {}\n', 'utf-8');
  return { action: 'created', path: target };
}
