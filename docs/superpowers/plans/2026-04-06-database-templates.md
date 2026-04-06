# Database Templates & ADC Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Neo4j, Spanner, BigQuery quick-add templates in Admin UI Sources page, with Google ADC authentication support, auto-generating `tools.yaml` and enabling genai-toolbox connection.

**Architecture:** Admin UI gets a new "Database Templates" tab with three preset cards. When a user fills in database-specific fields and submits, the backend updates `config/tools.yaml` with the new source + tools, enables `toolbox` in `hub_config.yaml`, and auto-connects via SSE. Docker Compose is updated to mount GCP ADC credentials.

**Tech Stack:** React 18 + Ant Design 5 (dark theme) frontend, Express + TypeScript backend, YAML config generation, genai-toolbox SSE proxy.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `admin_ui/src/types/index.ts` | Modify | Add `DatabaseTemplateParams` type |
| `admin_ui/src/api/client.ts` | Modify | Add `addDatabaseSource()` API call |
| `admin_ui/src/components/SourcesPage.tsx` | Modify | Add "Database Templates" tab with Neo4j/Spanner/BigQuery cards |
| `graphxr_mcp_server/source_manager.ts` | Modify | Add `addDatabaseSource()` method that writes `tools.yaml` + enables toolbox |
| `graphxr_mcp_server/admin_ui.ts` | Modify | Add `POST /api/sources/database` route |
| `docker-compose.yml` | Modify | Mount GCP ADC credentials for genai-toolbox |
| `.env.example` | Modify | Add `GOOGLE_APPLICATION_CREDENTIALS` |
| `tests/test_source_manager.ts` | Modify | Add tests for `addDatabaseSource()` |

---

### Task 1: Add TypeScript types for database templates

**Files:**
- Modify: `admin_ui/src/types/index.ts`

- [ ] **Step 1: Add DatabaseTemplateParams type**

Add after the existing `AddSourceParams` interface (line 41):

```typescript
export type DatabaseType = 'neo4j' | 'spanner' | 'bigquery';

export interface DatabaseTemplateParams {
  type: DatabaseType;
  // Neo4j
  uri?: string;
  user?: string;
  password?: string;
  // Spanner
  project?: string;
  instance?: string;
  database?: string;
  dialect?: 'googlesql' | 'postgresql';
  // BigQuery
  location?: string;
  allowedDatasets?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add admin_ui/src/types/index.ts
git commit -m "feat: add DatabaseTemplateParams type for database source templates"
```

---

### Task 2: Add API client method for database templates

**Files:**
- Modify: `admin_ui/src/api/client.ts`

- [ ] **Step 1: Add addDatabaseSource function**

Add after the existing `addSource` function (after line 36):

```typescript
export async function addDatabaseSource(params: DatabaseTemplateParams): Promise<SourceInfo[]> {
  const data = await request<{ sources: SourceInfo[] }>('/sources/database', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return data.sources;
}
```

- [ ] **Step 2: Add the import for DatabaseTemplateParams**

Update the import on line 1:

```typescript
import type { SourceInfo, AddSourceParams, SessionInfo, LineageEntry, RegistryResult, DatabaseTemplateParams } from '../types';
```

- [ ] **Step 3: Commit**

```bash
git add admin_ui/src/api/client.ts
git commit -m "feat: add addDatabaseSource API client method"
```

---

### Task 3: Add backend route and SourceManager method for database templates

**Files:**
- Modify: `graphxr_mcp_server/source_manager.ts`
- Modify: `graphxr_mcp_server/admin_ui.ts`

- [ ] **Step 1: Write failing test for addDatabaseSource**

Add to `tests/test_source_manager.ts`:

```typescript
import { readFileSync } from 'fs';
import { resolve } from 'path';
import YAML from 'yaml';

// Add these tests inside the existing describe('SourceManager', ...) block:

  describe('addDatabaseSource', () => {
    const testToolsPath = resolve(process.cwd(), 'config/tools.yaml');

    it('generates correct tools.yaml for neo4j template', () => {
      manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
      const result = manager.generateToolsYaml('neo4j', {
        uri: 'bolt://localhost:7687',
        user: 'neo4j',
        password: 'test123',
      });

      expect(result.sources['neo4j']).toEqual({
        kind: 'neo4j',
        uri: 'bolt://localhost:7687',
        user: 'neo4j',
        password: 'test123',
      });
      expect(result.tools['neo4j-execute-cypher']).toBeDefined();
      expect(result.tools['neo4j-execute-cypher'].kind).toBe('neo4j-execute-cypher');
      expect(result.tools['neo4j-execute-cypher'].source).toBe('neo4j');
      expect(result.tools['neo4j-schema']).toBeDefined();
    });

    it('generates correct tools.yaml for spanner template', () => {
      manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
      const result = manager.generateToolsYaml('spanner', {
        project: 'my-project',
        instance: 'my-instance',
        database: 'my-db',
        dialect: 'googlesql',
      });

      expect(result.sources['spanner']).toEqual({
        kind: 'spanner',
        project: 'my-project',
        instance: 'my-instance',
        database: 'my-db',
        dialect: 'googlesql',
      });
      expect(result.tools['spanner-execute-sql']).toBeDefined();
      expect(result.tools['spanner-list-tables']).toBeDefined();
      expect(result.tools['spanner-list-graphs']).toBeDefined();
    });

    it('generates correct tools.yaml for bigquery template', () => {
      manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));
      const result = manager.generateToolsYaml('bigquery', {
        project: 'my-project',
        location: 'us',
        allowedDatasets: 'dataset1,dataset2',
      });

      expect(result.sources['bigquery']).toEqual({
        kind: 'bigquery',
        project: 'my-project',
        location: 'us',
        allowedDatasets: ['dataset1', 'dataset2'],
      });
      expect(result.tools['bigquery-execute-sql']).toBeDefined();
      expect(result.tools['bigquery-conversational-analytics']).toBeDefined();
      expect(result.tools['bigquery-get-dataset-info']).toBeDefined();
      expect(result.tools['bigquery-list-dataset-ids']).toBeDefined();
    });

    it('merges with existing tools.yaml sources', () => {
      manager.loadConfig(resolve(process.cwd(), 'config/hub_config.yaml'));

      // First add neo4j
      const result1 = manager.generateToolsYaml('neo4j', {
        uri: 'bolt://localhost:7687',
        user: 'neo4j',
        password: 'test',
      });

      // Then add spanner on top
      const result2 = manager.generateToolsYaml('spanner', {
        project: 'p',
        instance: 'i',
        database: 'd',
      }, result1);

      // Both should exist
      expect(result2.sources['neo4j']).toBeDefined();
      expect(result2.sources['spanner']).toBeDefined();
      expect(result2.tools['neo4j-execute-cypher']).toBeDefined();
      expect(result2.tools['spanner-execute-sql']).toBeDefined();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/test_source_manager.ts`
Expected: FAIL — `manager.generateToolsYaml is not a function`

- [ ] **Step 3: Implement generateToolsYaml in SourceManager**

Add to `graphxr_mcp_server/source_manager.ts`, inside the `SourceManager` class, before the `private saveConfig()` method:

```typescript
  // ---------------------------------------------------------------------------
  // Database template support — generate tools.yaml for genai-toolbox
  // ---------------------------------------------------------------------------

  interface ToolsYamlConfig {
    sources: Record<string, Record<string, unknown>>;
    tools: Record<string, Record<string, unknown>>;
  }

  /**
   * Generate a tools.yaml configuration for a database template.
   * Merges with an optional existing config to support multiple databases.
   */
  generateToolsYaml(
    dbType: 'neo4j' | 'spanner' | 'bigquery',
    params: Record<string, unknown>,
    existing?: { sources: Record<string, Record<string, unknown>>; tools: Record<string, Record<string, unknown>> },
  ): { sources: Record<string, Record<string, unknown>>; tools: Record<string, Record<string, unknown>> } {
    const sources = { ...(existing?.sources ?? {}) };
    const tools = { ...(existing?.tools ?? {}) };

    switch (dbType) {
      case 'neo4j':
        sources['neo4j'] = {
          kind: 'neo4j',
          uri: params.uri as string,
          user: params.user as string,
          password: params.password as string,
        };
        tools['neo4j-execute-cypher'] = {
          kind: 'neo4j-execute-cypher',
          source: 'neo4j',
          description: 'Execute Cypher queries on Neo4j graph database',
        };
        tools['neo4j-schema'] = {
          kind: 'neo4j-schema',
          source: 'neo4j',
          description: 'Extract schema from Neo4j database',
        };
        break;

      case 'spanner':
        sources['spanner'] = {
          kind: 'spanner',
          project: params.project as string,
          instance: params.instance as string,
          database: params.database as string,
          ...(params.dialect ? { dialect: params.dialect as string } : {}),
        };
        tools['spanner-execute-sql'] = {
          kind: 'spanner-execute-sql',
          source: 'spanner',
          description: 'Execute SQL queries on Google Cloud Spanner',
        };
        tools['spanner-list-tables'] = {
          kind: 'spanner-list-tables',
          source: 'spanner',
          description: 'List tables in Spanner database',
        };
        tools['spanner-list-graphs'] = {
          kind: 'spanner-list-graphs',
          source: 'spanner',
          description: 'List property graphs in Spanner database',
        };
        break;

      case 'bigquery': {
        const allowedDatasets = params.allowedDatasets
          ? (params.allowedDatasets as string).split(',').map((s: string) => s.trim()).filter(Boolean)
          : undefined;
        sources['bigquery'] = {
          kind: 'bigquery',
          project: params.project as string,
          ...(params.location ? { location: params.location as string } : {}),
          ...(allowedDatasets ? { allowedDatasets } : {}),
        };
        tools['bigquery-execute-sql'] = {
          kind: 'bigquery-execute-sql',
          source: 'bigquery',
          description: 'Execute SQL queries on BigQuery',
        };
        tools['bigquery-conversational-analytics'] = {
          kind: 'bigquery-conversational-analytics',
          source: 'bigquery',
          description: 'Conversational analytics on BigQuery datasets',
        };
        tools['bigquery-get-dataset-info'] = {
          kind: 'bigquery-get-dataset-info',
          source: 'bigquery',
          description: 'Get BigQuery dataset metadata',
        };
        tools['bigquery-list-dataset-ids'] = {
          kind: 'bigquery-list-dataset-ids',
          source: 'bigquery',
          description: 'List BigQuery dataset IDs',
        };
        break;
      }
    }

    return { sources, tools };
  }

  /**
   * Add a database source via template: writes tools.yaml, enables toolbox,
   * and connects to genai-toolbox SSE.
   */
  async addDatabaseSource(
    dbType: 'neo4j' | 'spanner' | 'bigquery',
    params: Record<string, unknown>,
  ): Promise<{ connected: boolean; error?: string }> {
    // 1. Read existing tools.yaml (if any)
    const toolsPath = resolve(process.cwd(), 'config/tools.yaml');
    let existing: { sources: Record<string, Record<string, unknown>>; tools: Record<string, Record<string, unknown>> } | undefined;
    try {
      const raw = readFileSync(toolsPath, 'utf-8');
      existing = YAML.parse(raw) ?? undefined;
    } catch { /* first time — no existing file */ }

    // 2. Generate merged config
    const config = this.generateToolsYaml(dbType, params, existing);

    // 3. Write tools.yaml
    writeFileSync(toolsPath, YAML.stringify(config, { indent: 2 }), 'utf-8');

    // 4. Enable toolbox in hub_config.yaml
    try {
      const hubRaw = readFileSync(this.configPath, 'utf-8');
      const hubConfig = YAML.parse(hubRaw) ?? {};
      if (hubConfig.toolbox) {
        hubConfig.toolbox.enabled = true;
      } else {
        hubConfig.toolbox = {
          enabled: true,
          transport: 'sse',
          url: '${GENAI_TOOLBOX_URL:-http://localhost:5000/sse}',
          description: 'Google genai-toolbox: database sources',
        };
      }
      writeFileSync(this.configPath, YAML.stringify(hubConfig, { indent: 2 }), 'utf-8');
      this.loadConfig();
    } catch (err) {
      return { connected: false, error: `Failed to update hub_config.yaml: ${err}` };
    }

    // 5. Connect to toolbox SSE (or reconnect if already connected)
    await this.disconnect('toolbox');
    const toolboxUrl = this.config.toolbox?.url ?? 'http://localhost:5000/sse';
    await this.connectSSE('toolbox', toolboxUrl, this.config.toolbox?.description ?? 'genai-toolbox');

    const entry = this.sources.get('toolbox');
    if (entry?.status === 'connected') {
      return { connected: true };
    }
    return { connected: false, error: entry?.error ?? 'Failed to connect to genai-toolbox' };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/test_source_manager.ts`
Expected: PASS

- [ ] **Step 5: Add the API route in admin_ui.ts**

Add after the `router.post('/api/sources', ...)` block (after line 86) in `graphxr_mcp_server/admin_ui.ts`:

```typescript
  router.post('/api/sources/database', async (req, res) => {
    if (!sourceManager) { res.status(500).json({ error: 'SourceManager not available' }); return; }
    const { type, ...params } = req.body;
    if (!type || !['neo4j', 'spanner', 'bigquery'].includes(type)) {
      res.status(400).json({ error: 'type must be one of: neo4j, spanner, bigquery' });
      return;
    }
    const result = await sourceManager.addDatabaseSource(type, params);
    res.json({ type, ...result, sources: sourceManager.getStatus() });
  });
```

**IMPORTANT:** This route must be placed BEFORE the `router.delete('/api/sources/:name', ...)` route, because Express would match `/api/sources/database` as `/api/sources/:name` with `name = "database"` otherwise.

- [ ] **Step 6: Commit**

```bash
git add graphxr_mcp_server/source_manager.ts graphxr_mcp_server/admin_ui.ts tests/test_source_manager.ts
git commit -m "feat: add database template backend — generateToolsYaml + addDatabaseSource + API route"
```

---

### Task 4: Add Database Templates tab in Admin UI

**Files:**
- Modify: `admin_ui/src/components/SourcesPage.tsx`

- [ ] **Step 1: Add imports and template definitions**

Update the imports at the top of the file. Replace the existing import block (lines 1-12):

```typescript
import { useState, useCallback } from 'react';
import {
  Table, Tag, Button, Form, Input, Select, Popconfirm, Space, Statistic,
  Row, Col, Card, message, Tabs, Typography, Tooltip, Popover, Spin, List, Empty, theme,
} from 'antd';
import {
  ReloadOutlined, PlusOutlined, LinkOutlined, DisconnectOutlined,
  DeleteOutlined, DownloadOutlined, SearchOutlined, DatabaseOutlined,
} from '@ant-design/icons';
import type { SourceInfo, AddSourceParams, RegistryResult, DatabaseType, DatabaseTemplateParams } from '../types';
import { usePolling } from '../hooks/usePolling';
import * as api from '../api/client';

const { Text } = Typography;
const { Search } = Input;

interface TemplateConfig {
  type: DatabaseType;
  title: string;
  description: string;
  color: string;
  fields: Array<{
    name: string;
    label: string;
    placeholder: string;
    required?: boolean;
    type?: 'password' | 'select';
    options?: Array<{ label: string; value: string }>;
  }>;
}

const TEMPLATES: TemplateConfig[] = [
  {
    type: 'neo4j',
    title: 'Neo4j',
    description: 'Graph database — Cypher queries, schema extraction',
    color: '#018BFF',
    fields: [
      { name: 'uri', label: 'URI', placeholder: 'bolt://localhost:7687', required: true },
      { name: 'user', label: 'User', placeholder: 'neo4j', required: true },
      { name: 'password', label: 'Password', placeholder: 'password', type: 'password', required: true },
    ],
  },
  {
    type: 'spanner',
    title: 'Google Spanner',
    description: 'Property graph + SQL — execute SQL, list tables & graphs',
    color: '#4285F4',
    fields: [
      { name: 'project', label: 'GCP Project', placeholder: 'my-gcp-project', required: true },
      { name: 'instance', label: 'Instance', placeholder: 'my-spanner-instance', required: true },
      { name: 'database', label: 'Database', placeholder: 'my-database', required: true },
      {
        name: 'dialect', label: 'Dialect', placeholder: 'googlesql', type: 'select',
        options: [
          { label: 'GoogleSQL (default)', value: 'googlesql' },
          { label: 'PostgreSQL', value: 'postgresql' },
        ],
      },
    ],
  },
  {
    type: 'bigquery',
    title: 'BigQuery',
    description: 'Property graph analytics — SQL, conversational analytics, dataset discovery',
    color: '#669DF6',
    fields: [
      { name: 'project', label: 'GCP Project', placeholder: 'my-gcp-project', required: true },
      { name: 'location', label: 'Location', placeholder: 'us (optional)' },
      { name: 'allowedDatasets', label: 'Allowed Datasets', placeholder: 'dataset1, dataset2 (comma separated, optional)' },
    ],
  },
];
```

- [ ] **Step 2: Add database template state and handler**

Inside the `SourcesPage` component, after the `const [installing, setInstalling] = useState<string | null>(null);` line (line 25), add:

```typescript
  // Database template state
  const [dbForms] = useState(() => {
    const forms: Record<string, ReturnType<typeof Form.useForm>[0]> = {};
    return forms;
  });
  const [addingDb, setAddingDb] = useState<string | null>(null);
```

After the `handleInstall` function (after line 80), add:

```typescript
  // ── Database template actions ──────────────────────────────────────

  const handleAddDatabase = async (template: TemplateConfig, values: Record<string, unknown>) => {
    setAddingDb(template.type);
    try {
      const params: DatabaseTemplateParams = { type: template.type, ...values };
      await api.addDatabaseSource(params);
      message.success(`${template.title} source added and toolbox enabled`);
      refresh();
    } catch (err) {
      message.error(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAddingDb(null);
    }
  };
```

- [ ] **Step 3: Add the Database Templates tab**

In the `<Tabs>` component's `items` array, add a third item after the `registry` tab (before the closing `]}` of Tabs items, around line 319):

```typescript
          {
            key: 'database',
            label: <span><DatabaseOutlined /> Database Templates</span>,
            children: (
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                  Quick-add database sources via genai-toolbox. Requires ADC or service account credentials for GCP databases.
                </Text>
                <Row gutter={[16, 16]}>
                  {TEMPLATES.map((tpl) => (
                    <Col xs={24} lg={8} key={tpl.type}>
                      <Card
                        title={
                          <span>
                            <DatabaseOutlined style={{ color: tpl.color, marginRight: 8 }} />
                            {tpl.title}
                          </span>
                        }
                        size="small"
                        style={{ borderTop: `2px solid ${tpl.color}` }}
                      >
                        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                          {tpl.description}
                        </Text>
                        <Form
                          layout="vertical"
                          size="small"
                          onFinish={(values) => handleAddDatabase(tpl, values)}
                        >
                          {tpl.fields.map((field) => (
                            <Form.Item
                              key={field.name}
                              name={field.name}
                              label={field.label}
                              rules={field.required ? [{ required: true, message: `${field.label} is required` }] : []}
                            >
                              {field.type === 'password' ? (
                                <Input.Password placeholder={field.placeholder} />
                              ) : field.type === 'select' ? (
                                <Select placeholder={field.placeholder}>
                                  {field.options?.map((opt) => (
                                    <Select.Option key={opt.value} value={opt.value}>{opt.label}</Select.Option>
                                  ))}
                                </Select>
                              ) : (
                                <Input placeholder={field.placeholder} />
                              )}
                            </Form.Item>
                          ))}
                          <Button
                            type="primary"
                            htmlType="submit"
                            icon={<PlusOutlined />}
                            loading={addingDb === tpl.type}
                            block
                          >
                            Add {tpl.title}
                          </Button>
                        </Form>
                      </Card>
                    </Col>
                  ))}
                </Row>
              </div>
            ),
          },
```

- [ ] **Step 4: Commit**

```bash
git add admin_ui/src/components/SourcesPage.tsx
git commit -m "feat: add Database Templates tab with Neo4j, Spanner, BigQuery cards"
```

---

### Task 5: Add ADC support in Docker and environment config

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`

- [ ] **Step 1: Update docker-compose.yml — mount GCP credentials for genai-toolbox**

In the `genai-toolbox` service, add volume mounts and environment variable for ADC. Replace the `volumes` and `environment` sections of the `genai-toolbox` service (lines 33-48):

```yaml
    volumes:
      - ./config/tools.yaml:/app/tools.yaml:ro
      - ${GOOGLE_APPLICATION_CREDENTIALS:-/dev/null}:/app/service-account.json:ro
      - ${CLOUDSDK_CONFIG:-~/.config/gcloud}:/root/.config/gcloud:ro
    command: ["--tools-file", "/app/tools.yaml", "--address", "0.0.0.0:5000"]
    environment:
      - GOOGLE_APPLICATION_CREDENTIALS=${GOOGLE_APPLICATION_CREDENTIALS:+/app/service-account.json}
      - CLOUDSDK_CONFIG=/root/.config/gcloud
      - NEO4J_URI=${NEO4J_URI:-bolt://host.docker.internal:7687}
      - NEO4J_USER=${NEO4J_USER:-neo4j}
      - NEO4J_PASSWORD=${NEO4J_PASSWORD:-}
      - GCP_PROJECT=${GCP_PROJECT:-}
      - SPANNER_INSTANCE=${SPANNER_INSTANCE:-}
      - SPANNER_DATABASE=${SPANNER_DATABASE:-}
      - POSTGRES_HOST=${POSTGRES_HOST:-host.docker.internal}
      - POSTGRES_PORT=${POSTGRES_PORT:-5432}
      - POSTGRES_DB=${POSTGRES_DB:-}
      - POSTGRES_USER=${POSTGRES_USER:-}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-}
```

- [ ] **Step 2: Update .env.example — add ADC variables**

Add after line 26 (`SPANNER_DATABASE=`):

```bash

# ── Google Cloud ADC Authentication (optional) ───────────────────────
# Option 1: Service account key file path (for Docker)
# GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
# Option 2: gcloud CLI config directory (for local dev, uses `gcloud auth application-default login`)
# CLOUDSDK_CONFIG=~/.config/gcloud

# ── BigQuery (optional) ──────────────────────────────────────────────
BIGQUERY_PROJECT=
BIGQUERY_LOCATION=us
BIGQUERY_ALLOWED_DATASETS=
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "feat: add Google ADC support in Docker + BigQuery env vars"
```

---

### Task 6: Run full test suite and build verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: TypeScript type check**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Build admin UI**

Run: `cd admin_ui && yarn install && yarn build`
Expected: Build succeeds, output in `admin_ui/dist/`

- [ ] **Step 4: Build server**

Run: `npx tsc`
Expected: Build succeeds, output in `dist/`

- [ ] **Step 5: Final commit (if any fixes needed)**

```bash
git add -A
git commit -m "fix: address build/test issues from database templates feature"
```
