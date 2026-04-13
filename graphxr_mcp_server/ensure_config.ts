import { existsSync, copyFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

export type EnsureAction = 'existed' | 'copied' | 'created';

export interface EnsureFileResult {
  file: string;
  action: EnsureAction;
  path: string;
  source?: string;
}

export interface EnsureConfigOptions {
  baseDir?: string;
  defaultsDir?: string;
}

interface ManagedFile {
  /** Path relative to the base directory (e.g. 'config/hub_config.yaml'). */
  relPath: string;
  /** Minimal content used when no template is found anywhere. */
  fallback: string | null;
}

const MINIMAL_TOOLS_YAML = 'sources: {}\ntools: {}\n';

const MINIMAL_HUB_CONFIG = `graphxr_mcp_server:
  enabled: true
  port: 8899
  graphxr_ws_url: \${GRAPHXR_WS_URL:-ws://localhost:8080}
  transport: http
toolbox:
  enabled: true
  transport: sse
  url: \${GENAI_TOOLBOX_URL:-http://localhost:5000/mcp/sse}
  tools_file: config/tools.yaml
  description: Google genai-toolbox database adapter
mcp_servers: []
`;

const MANAGED_FILES: ManagedFile[] = [
  { relPath: 'config/hub_config.yaml', fallback: MINIMAL_HUB_CONFIG },
  { relPath: 'config/tools.yaml', fallback: MINIMAL_TOOLS_YAML },
  { relPath: 'config/tools.yaml.example', fallback: null },
  { relPath: 'config/ollama_config.ts', fallback: null },
];

/**
 * Resolve the defaults directory that ships with a Docker image.
 *
 * docker-compose mounts ./config over /app/config, shadowing any files
 * baked into the image. We keep a second copy at /app/config-defaults/
 * (populated by the Dockerfile) so we can re-hydrate the mounted volume
 * on first run.
 */
function defaultDefaultsDir(baseDir: string): string | null {
  const candidate = resolve(baseDir, 'config-defaults');
  return existsSync(candidate) ? candidate : null;
}

/**
 * Ensure all managed config files exist in the target base directory.
 *
 * For each file:
 *   1. If the target already exists → leave it (action = 'existed').
 *   2. Else if a template exists in `defaultsDir` → copy it ('copied').
 *   3. Else if a matching `.example` sibling exists → copy it ('copied').
 *   4. Else if the file has a hardcoded fallback → write it ('created').
 *   5. Else → skip the file.
 */
export function ensureConfigFiles(options: EnsureConfigOptions = {}): EnsureFileResult[] {
  const baseDir = options.baseDir ?? process.cwd();
  const defaultsDir = options.defaultsDir ?? defaultDefaultsDir(baseDir);

  const results: EnsureFileResult[] = [];

  for (const file of MANAGED_FILES) {
    const target = resolve(baseDir, file.relPath);

    if (existsSync(target)) {
      results.push({ file: file.relPath, action: 'existed', path: target });
      continue;
    }

    mkdirSync(dirname(target), { recursive: true });

    const basename = file.relPath.split('/').pop()!;

    if (defaultsDir) {
      const candidate = resolve(defaultsDir, basename);
      if (existsSync(candidate)) {
        copyFileSync(candidate, target);
        results.push({ file: file.relPath, action: 'copied', path: target, source: candidate });
        continue;
      }
    }

    const exampleSibling = resolve(baseDir, `${file.relPath}.example`);
    if (existsSync(exampleSibling) && exampleSibling !== target) {
      copyFileSync(exampleSibling, target);
      results.push({ file: file.relPath, action: 'copied', path: target, source: exampleSibling });
      continue;
    }

    if (file.fallback !== null) {
      writeFileSync(target, file.fallback, 'utf-8');
      results.push({ file: file.relPath, action: 'created', path: target });
      continue;
    }
  }

  return results;
}

/**
 * Backwards-compatible single-file helper.
 *
 * Returns the result for config/tools.yaml from ensureConfigFiles().
 */
export function ensureToolsYaml(baseDir: string = process.cwd()): { action: EnsureAction; path: string } {
  const results = ensureConfigFiles({ baseDir });
  const toolsResult = results.find((r) => r.file === 'config/tools.yaml');
  if (toolsResult) {
    return { action: toolsResult.action, path: toolsResult.path };
  }
  return { action: 'existed', path: resolve(baseDir, 'config/tools.yaml') };
}
