#!/usr/bin/env node
import { ensureToolsYaml } from '../graphxr_mcp_server/ensure_tools_yaml';

const result = ensureToolsYaml();

switch (result.action) {
  case 'existed':
    console.log(`[ensure-tools-yaml] ${result.path} already exists — no change`);
    break;
  case 'copied':
    console.log(`[ensure-tools-yaml] Created ${result.path} from tools.yaml.example`);
    break;
  case 'created':
    console.log(`[ensure-tools-yaml] Created ${result.path} with empty shell (no .example found)`);
    break;
}
