import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ensureConfigFiles, ensureToolsYaml } from '../graphxr_mcp_server/ensure_config';

describe('ensureConfigFiles', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'ensure-config-'));
    mkdirSync(join(baseDir, 'config'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('leaves existing files untouched', () => {
    const target = join(baseDir, 'config/hub_config.yaml');
    writeFileSync(target, 'custom: yes\n', 'utf-8');

    const results = ensureConfigFiles({ baseDir });
    const hub = results.find((r) => r.file === 'config/hub_config.yaml')!;

    expect(hub.action).toBe('existed');
    expect(readFileSync(target, 'utf-8')).toBe('custom: yes\n');
  });

  it('copies from defaultsDir when target is missing', () => {
    const defaultsDir = join(baseDir, 'config-defaults');
    mkdirSync(defaultsDir);
    writeFileSync(join(defaultsDir, 'hub_config.yaml'), 'from: defaults\n', 'utf-8');
    writeFileSync(join(defaultsDir, 'tools.yaml.example'), 'example: yes\n', 'utf-8');
    writeFileSync(join(defaultsDir, 'ollama_config.ts'), '// ollama template\n', 'utf-8');

    const results = ensureConfigFiles({ baseDir, defaultsDir });

    const hub = results.find((r) => r.file === 'config/hub_config.yaml')!;
    expect(hub.action).toBe('copied');
    expect(readFileSync(join(baseDir, 'config/hub_config.yaml'), 'utf-8')).toBe('from: defaults\n');

    const toolsExample = results.find((r) => r.file === 'config/tools.yaml.example')!;
    expect(toolsExample.action).toBe('copied');

    const ollama = results.find((r) => r.file === 'config/ollama_config.ts')!;
    expect(ollama.action).toBe('copied');
  });

  it('copies tools.yaml from tools.yaml.example when defaultsDir missing it', () => {
    writeFileSync(join(baseDir, 'config/tools.yaml.example'), 'example template\n', 'utf-8');

    const results = ensureConfigFiles({ baseDir });
    const toolsYaml = results.find((r) => r.file === 'config/tools.yaml')!;

    expect(toolsYaml.action).toBe('copied');
    expect(readFileSync(join(baseDir, 'config/tools.yaml'), 'utf-8')).toBe('example template\n');
  });

  it('falls back to minimal shell when neither defaults nor example exist', () => {
    const results = ensureConfigFiles({ baseDir });

    const toolsYaml = results.find((r) => r.file === 'config/tools.yaml')!;
    expect(toolsYaml.action).toBe('created');
    expect(readFileSync(join(baseDir, 'config/tools.yaml'), 'utf-8')).toBe('sources: {}\ntools: {}\n');

    const hub = results.find((r) => r.file === 'config/hub_config.yaml')!;
    expect(hub.action).toBe('created');
    const hubContent = readFileSync(join(baseDir, 'config/hub_config.yaml'), 'utf-8');
    expect(hubContent).toContain('toolbox:');
    expect(hubContent).toContain('enabled: true');
  });

  it('auto-discovers config-defaults/ beside the base directory', () => {
    const defaultsDir = join(baseDir, 'config-defaults');
    mkdirSync(defaultsDir);
    writeFileSync(join(defaultsDir, 'hub_config.yaml'), 'auto: discovered\n', 'utf-8');

    const results = ensureConfigFiles({ baseDir });
    const hub = results.find((r) => r.file === 'config/hub_config.yaml')!;

    expect(hub.action).toBe('copied');
    expect(readFileSync(join(baseDir, 'config/hub_config.yaml'), 'utf-8')).toBe('auto: discovered\n');
  });
});

describe('ensureToolsYaml (back-compat)', () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), 'ensure-tools-yaml-'));
    mkdirSync(join(baseDir, 'config'));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('still writes minimal empty shell when no template exists', () => {
    const result = ensureToolsYaml(baseDir);

    expect(result.action).toBe('created');
    const target = join(baseDir, 'config/tools.yaml');
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target, 'utf-8')).toBe('sources: {}\ntools: {}\n');
  });

  it('still copies from .example when present', () => {
    const example = join(baseDir, 'config/tools.yaml.example');
    writeFileSync(example, 'example template content\n', 'utf-8');

    const result = ensureToolsYaml(baseDir);

    expect(result.action).toBe('copied');
    expect(readFileSync(join(baseDir, 'config/tools.yaml'), 'utf-8')).toBe('example template content\n');
  });
});
