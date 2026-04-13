import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureToolsYaml } from '../graphxr_mcp_server/ensure_tools_yaml';

describe('ensureToolsYaml', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'ensure-tools-yaml-'));
    mkdirSync(join(baseDir, 'config'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('returns "existed" and does not touch file when tools.yaml already exists', () => {
    const target = join(baseDir, 'config/tools.yaml');
    writeFileSync(target, 'custom user content\n', 'utf-8');

    const result = ensureToolsYaml(baseDir);

    expect(result.action).toBe('existed');
    expect(result.path).toBe(target);
    expect(readFileSync(target, 'utf-8')).toBe('custom user content\n');
  });

  it('copies tools.yaml.example when example exists and tools.yaml does not', () => {
    const example = join(baseDir, 'config/tools.yaml.example');
    writeFileSync(example, 'example template content\n', 'utf-8');

    const result = ensureToolsYaml(baseDir);

    expect(result.action).toBe('copied');
    const target = join(baseDir, 'config/tools.yaml');
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf-8')).toBe('example template content\n');
  });

  it('writes minimal empty shell when neither tools.yaml nor example exist', () => {
    const result = ensureToolsYaml(baseDir);

    expect(result.action).toBe('created');
    const target = join(baseDir, 'config/tools.yaml');
    expect(readFileSync(target, 'utf-8')).toBe('sources: {}\ntools: {}\n');
  });
});
