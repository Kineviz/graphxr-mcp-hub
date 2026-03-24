# GraphXR MCP Hub — 项目方案文档

> 多数据源 × MCP 协议 × 统一图语义层 × GraphXR Agent 功能增强平台

---

## 1. 项目背景与定位

### 1.1 现状

**GraphXR** 和 **GraphXR Agent** 已经由 Kineviz 以 **Node.js** 实现并投入使用。GraphXR Agent 当前具备基本的 LLM 驱动的图分析能力，但受限于数据接入范围——主要依赖已配置的固定数据源。

### 1.2 本项目目标

**graphxr-mcp-hub 不是重新实现 GraphXR Agent，而是为其提供"数据源扩展底座"：**

- 让现有的 GraphXR Agent（Node.js）能够**按需动态连接**更多数据源（CSV、JSON、Neo4j、Spanner、数据库等）
- 通过 **MCP 协议**标准化数据源接入，新增数据源无需修改 Agent 核心代码
- 将多源数据统一转换为**图语义结构**，推送到 GraphXR 可视化，增强当前 Agent 的实用性

### 1.3 关键澄清

| 问题 | 结论 |
|---|---|
| GraphXR Agent 是否需要重写？ | **否**。保持现有 Node.js 实现不变 |
| graphxr_mcp_server 是否需要双向支持？ | **是**（见 §3.3），Agent 既可推送图数据，也可查询当前图状态 |
| MCP Hub 是否需要 AI 调用支持？ | **是**，所有数据源均通过 MCP Tools 协议暴露，供 LLM/Agent 直接调用 |
| CSV/JSON 数据源如何接入？ | **通过 DuckDB MCP Server**（genai-toolbox 不支持文件类数据源） |

---

## 2. 数据源接入方案选型

### 2.1 genai-toolbox 是否支持 CSV/JSON？

**答：不支持。**

官方文档 [Sources | MCP Toolbox for Databases](https://googleapis.github.io/genai-toolbox/resources/sources/) 明确指出：genai-toolbox 的数据源（Sources）是**数据库连接**，不支持直接读取 CSV/JSON 文件。

> genai-toolbox 定位是"数据库 MCP Toolbox"，不是通用文件数据源接入工具。

### 2.2 CSV/JSON 数据源解决方案：DuckDB MCP Server

**[ktanaka101/mcp-server-duckdb](https://github.com/ktanaka101/mcp-server-duckdb)** 是目前最优的 CSV/JSON 文件类数据源 MCP 方案：

#### 为什么选 DuckDB？

| 能力 | 说明 |
|---|---|
| **原生读 CSV** | `SELECT * FROM read_csv_auto('data.csv')` |
| **原生读 JSON** | `SELECT * FROM read_json_auto('data.json')` |
| **原生读 Parquet** | `SELECT * FROM read_parquet('data.parquet')` |
| **无需导入** | 直接对文件执行 SQL，不需要先建表 |
| **支持 S3/HTTP** | `read_csv_auto('s3://bucket/file.csv')` |
| **MCP 标准接口** | 通过 `query` 工具暴露，LLM/Agent 直接调用 SQL |
| **轻量嵌入式** | 无需单独数据库服务，本地文件即可启动 |

#### 与 genai-toolbox 互补关系

```
文件类数据源（CSV / JSON / Parquet）
         │
         ▼
  DuckDB MCP Server          ←── 唯一推荐方案
  (ktanaka101/mcp-server-duckdb)
  
数据库类数据源（Neo4j / Spanner / PostgreSQL / MySQL / BigQuery）
         │
         ▼
  googleapis/genai-toolbox   ←── 首选方案
```

### 2.3 数据源覆盖全景图

| 数据源类型 | 接入方案 | 备注 |
|---|---|---|
| **CSV / JSON / Parquet** | DuckDB MCP Server ⭐ | genai-toolbox 不支持，DuckDB 完美覆盖 |
| **Neo4j** | genai-toolbox | tools.yaml 声明即接入 |
| **Google Spanner** | genai-toolbox | 原生一流支持 |
| **PostgreSQL / MySQL** | genai-toolbox | 自托管或 Cloud SQL |
| **BigQuery / AlloyDB** | genai-toolbox | GCP 原生 |
| **SQLite** | genai-toolbox 或 DuckDB | 均支持 |
| **HTTP REST API** | MCP Registry: fetch-mcp | 通用 HTTP 抓取 |
| **文件系统** | MCP Registry: filesystem-mcp | 读写本地文件 |
| **Oracle / DynamoDB** | MCP Registry 社区 Server | genai-toolbox 不支持 |
| **向量数据库（Pinecone 等）** | MCP Registry 社区 Server | genai-toolbox 不支持 |

---

## 3. 整体架构（面向现有 GraphXR Agent 增强）

### 3.1 架构定位：GraphXR Agent 的"数据源扩展层"

```
┌─────────────────────────────────────────────────────────────────────┐
│              现有系统（已有，保持不变）                                │
│                                                                     │
│   GraphXR Agent（Node.js）── MCP Client ──► GraphXR UI             │
│   • 已有 LLM 推理能力                       • 知识图谱可视化          │
│   • 已有基础数据源                                                    │
└────────────────────────────┬────────────────────────────────────────┘
                             │  通过 MCP 协议扩展工具列表
┌────────────────────────────▼────────────────────────────────────────┐
│              graphxr-mcp-hub（本仓库，新增部分）                      │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  A. DuckDB MCP Server（CSV/JSON/Parquet 文件类数据源）        │   │
│  │     → 现有 Agent 无法读取的文件数据，现在可以了               │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │  B. googleapis/genai-toolbox（数据库类数据源）               │   │
│  │     → Neo4j / Spanner / PostgreSQL / BigQuery 等            │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │  C. MCP Registry 按需加载（补充覆盖）                        │   │
���  │     → fetch / filesystem / Oracle / DynamoDB 等             │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │  D. GraphXR MCP Server（双向，唯一自实现）                   │   │
│  │     → 推送图数据到 GraphXR + 查询当前图状态                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 数据流全景

```
用户在 GraphXR Agent 中提问
         │
         ▼
GraphXR Agent（Node.js，现有）
  调用 MCP Client，查询可用工具列表
         │
         ├─► DuckDB MCP Server 工具（query_csv / query_json 等）
         │       SQL on CSV/JSON 文件 → 原始表格数据
         │
         ├─► genai-toolbox 工具（neo4j-query / spanner-query 等）
         │       数据库查询 → 结构化数据
         │
         ├─► Registry MCP 工具（fetch / read_file 等）
         │       HTTP API / 本地文件 → 原始内容
         │
         ▼
   Data Transformer（图语义转换）
         │
         ▼
   graphxr_mcp_server（双向）
         ├─► push_graph()        推送节点和边到 GraphXR
         ├─► get_graph_state()   查询当前图状态（反馈给 Agent）
         ├─► add_nodes() / add_edges()   增量追加
         └─► clear_graph()       清空画布
         │
         ▼
   GraphXR UI 实时展示 ✅
```

### 3.3 GraphXR MCP Server 双向支持详解

GraphXR Agent（Node.js）需要与 GraphXR 进行**双向交互**，因此 `graphxr_mcp_server` 必须同时支持：

#### 推送方向（Agent → GraphXR）

| 工具 | 说明 |
|---|---|
| `push_graph(nodes, edges)` | 批量推送完整图数据 |
| `add_nodes(nodes)` | 增量添加节点 |
| `add_edges(edges)` | 增量添加边 |
| `update_node(id, properties)` | 更新节点属性 |
| `clear_graph()` | 清空当前图 |

#### 查询方向（Agent ← GraphXR）

| 工具 | 说明 |
|---|---|
| `get_graph_state()` | 获取当前图的节点数、边数、概要统计 |
| `get_nodes(filter?)` | 按条件查询当前图中的节点 |
| `get_edges(filter?)` | 按条件查询当前图中的边 |
| `find_neighbors(node_id)` | 查询指定节点的邻居 |

#### 为什么需要双向？

```
Agent 执行推理：
  "把 CSV 用户数据和 Neo4j 关系合并展示"
           ↓ push_graph()
       GraphXR 展示图  
  
用户在 GraphXR 中选中几个节点后说：
  "分析我选中的这些节点的共同特征"
           ↓ get_graph_state() / get_nodes()
  Agent 读取当前图状态，基于现有图继续推理
           ↓ add_edges()
  Agent 追加分析结果到图中
```

没有查询方向，Agent 就是"盲写"——每次都要重建整个图，无法基于用户的图操作进行增量推理。

---

## 4. GraphXR Agent（Node.js）如何接入本 Hub

### 4.1 接入方式：MCP Client 扩展

GraphXR Agent 已经实现，接入 Hub 只需在其 MCP Client 配置中**增加新的 MCP Server 连接**，不需要修改 Agent 核心逻辑：

```json
// GraphXR Agent 的 MCP 客户端配置（新增部分）
{
  "mcpServers": {
    // ── 新增：CSV/JSON 文件数据源 ──────────────────────
    "duckdb": {
      "command": "uvx",
      "args": ["mcp-server-duckdb", "--db-path", ":memory:"],
      "description": "DuckDB：支持 CSV/JSON/Parquet 文件的 SQL 查询"
    },

    // ── 新增：数据库数据源（genai-toolbox）────────────────
    "genai-toolbox": {
      "transport": "sse",
      "url": "http://localhost:5000/sse",
      "description": "Google genai-toolbox：Neo4j/Spanner/PostgreSQL 等"
    },

    // ── 新增：GraphXR 双向 MCP Server ──────────────────
    "graphxr": {
      "transport": "sse",
      "url": "http://localhost:3100/sse",
      "description": "GraphXR 推送与查询（双向）"
    },

    // ── 新增：通用文件系统 ──────────────────────────────
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"],
      "description": "本地文件读写"
    }
  }
}
```

### 4.2 Node.js 技术栈对齐

由于 GraphXR Agent 是 Node.js，本 Hub 中直接与 Agent 对接的组件也优先选用 Node.js/TypeScript 实现：

| 组件 | 语言 | 说明 |
|---|---|---|
| `graphxr_mcp_server` | **Node.js / TypeScript** | 与现有 Agent 同栈，直接引用 GraphXR API |
| `mcp_client/hub.js` | **Node.js / TypeScript** | MCP Client Hub，管理多个 MCP Server 连接 |
| `data_transformer.js` | **Node.js / TypeScript** | 多源数据 → 统一图语义结构转换 |
| `genai-toolbox` | Go 二进制 | Google 官方，独立进程，SSE 接口 |
| `mcp-server-duckdb` | Python（uvx/pip） | 独立进程，STDIO 接口 |

---

## 5. DuckDB MCP Server 详细配置

### 5.1 启动方式

```bash
# 方式一：uvx（推荐，无需安装）
uvx mcp-server-duckdb --db-path :memory:

# 方式二：pip 安装后运行
pip install mcp-server-duckdb
mcp-server-duckdb --db-path ./data/analytics.duckdb

# 方式三：指定持久化数据库文件（数据跨会话保留）
mcp-server-duckdb --db-path ./data/hub.duckdb
```

### 5.2 CSV/JSON 查询示例

DuckDB MCP Server 暴露的 `query` 工具，Agent 可直接调用：

```sql
-- 直接查询 CSV（无需导入）
SELECT * FROM read_csv_auto('/data/sample.csv') LIMIT 10;

-- 直接查询 JSON
SELECT * FROM read_json_auto('/data/sample.json');

-- 查询远程 S3 上的 CSV
SELECT * FROM read_csv_auto('s3://my-bucket/users.csv');

-- 跨文件 JOIN
SELECT u.name, o.order_id
FROM read_csv_auto('/data/users.csv') u
JOIN read_csv_auto('/data/orders.csv') o ON u.id = o.user_id;

-- 聚合分析
SELECT category, COUNT(*) as cnt, AVG(price) as avg_price
FROM read_csv_auto('/data/products.csv')
GROUP BY category
ORDER BY cnt DESC;
```

### 5.3 图语义转换示例

```javascript
// data_transformer.js（Node.js）
// DuckDB CSV 查询结果 → 统一图语义结构

function csvResultToGraph(rows, config = {}) {
  const {
    nodeCategory = 'Record',
    idColumn = 'id',
    relationColumn = null,
    targetColumn = null,
    relationship = 'RELATED_TO'
  } = config;

  const nodes = rows.map(row => ({
    id: String(row[idColumn]),
    category: nodeCategory,
    properties: row
  }));

  const edges = relationColumn ? rows
    .filter(row => row[relationColumn])
    .map((row, i) => ({
      id: `edge_${i}`,
      source: String(row[idColumn]),
      target: String(row[targetColumn || relationColumn]),
      relationship,
      properties: {}
    })) : [];

  return { nodes, edges };
}
```

---

## 6. 统一图语义层（Graph Schema）

所有数据源输出，在推送到 GraphXR 前，统一转换为以下结构：

```typescript
// semantic_layer/graph_schema.ts
interface GraphNode {
  id: string;
  category: string;           // 节点类型，如 "User", "Product"
  properties: Record<string, unknown>;
}

interface GraphEdge {
  id: string;
  source: string;             // 源节点 id
  target: string;             // 目标节点 id
  relationship: string;       // 关系类型，如 "PURCHASED", "KNOWS"
  properties: Record<string, unknown>;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}
```

**各数据源转换规则：**

| 数据源 | 节点 | 边 |
|---|---|---|
| CSV 行 | 每行 → 节点（category = 表名/文件名） | 外键列 → 边 |
| JSON 对象 | 顶层对象 → 节点 | 嵌套数组关系 → 边 |
| Neo4j | 原生节点 → 节点（直接映射） | 原生关系 → 边 |
| Spanner 行 | 每行 → 节点 | 外键约束 → 边 |
| HTTP API | 响应对象 → 节点 | 关联字段 → 边 |

---

## 7. 工程目录结构

```
graphxr-mcp-hub/
├── docs/
│   └── project.md                          # 本文档
│
├── graphxr_mcp_server/                     # ⭐ 唯一自实现的 MCP Server（Node.js/TS）
│   ├── index.ts                            # MCP Server 入口（SSE + STDIO 双模式）
│   ├── tools/
│   │   ├── push_graph.ts                   # 推送图数据到 GraphXR
│   │   ├── get_graph_state.ts              # 查询当前图状态（双向）
│   │   ├── add_nodes.ts                    # 增量添加节点
│   │   ├── add_edges.ts                    # 增量添加边
│   │   ├── update_node.ts                  # 更新节点属性
│   │   ├── find_neighbors.ts               # 查询节点邻居
│   │   └── clear_graph.ts                  # 清空图
│   └── graphxr_client.ts                   # GraphXR HTTP API 封装
│
├── semantic_layer/                          # 统一图语义层（Node.js/TS）
│   ├── graph_schema.ts                     # TypeScript 类型定义
│   ├── validators.ts                       # 数据合法性校验
│   └── transformers/
│       ├── csv_transformer.ts              # CSV/DuckDB 结果 → GraphData
│       ├── json_transformer.ts             # JSON → GraphData
│       ├── neo4j_transformer.ts            # Neo4j 查询结果 → GraphData
│       └── spanner_transformer.ts          # Spanner SQL 结果 → GraphData
│
├── mcp_client/                              # MCP Client Hub（Node.js/TS）
│   ├── hub.ts                              # 按需加载管理器
│   ├── registry_resolver.ts               # 查询官方 MCP Registry
│   └── transports/
│       ├── stdio_transport.ts
│       └── sse_transport.ts
│
├── config/
│   ├── hub_config.yaml                     # ⭐ 总控：按需开启/关闭各数据源
│   └── tools.yaml                          # ⭐ genai-toolbox 数据库配置
│
├── data/
│   ├── sample.csv
│   └── sample.json
│
├── tests/
│   ├── test_graphxr_mcp.ts
│   ├── test_duckdb_mcp.ts
│   ├── test_transformer.ts
│   └── test_hub.ts
│
├── docker-compose.yml                      # genai-toolbox + graphxr-mcp-server
├── .env.example
├── package.json                            # Node.js 依赖（主体）
├── tsconfig.json
├── requirements.txt                        # Python 依赖（mcp-server-duckdb）
└── README.md
```

---

## 8. 按需加载配置

### 8.1 hub_config.yaml

```yaml
# config/hub_config.yaml —— 总控配置

# A. DuckDB MCP Server（CSV/JSON/Parquet 文件数据源）
duckdb:
  enabled: true
  transport: stdio
  command: "uvx"
  args: ["mcp-server-duckdb", "--db-path", ":memory:"]
  description: "CSV/JSON/Parquet 文件 SQL 查询"

# B. googleapis/genai-toolbox（数据库数据源）
toolbox:
  enabled: true
  url: "http://localhost:5000/sse"
  tools_file: "config/tools.yaml"

# C. MCP Registry 按需加载
mcp_servers:
  - name: filesystem
    enabled: true
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-filesystem", "${DATA_DIR}"]

  - name: fetch
    enabled: true
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-fetch"]

  - name: github
    enabled: false         # 按需开启
    command: "npx"
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"

# D. GraphXR MCP Server（本仓库实现）
graphxr_mcp_server:
  enabled: true
  port: 3100
  graphxr_api_url: "${GRAPHXR_API_URL}"
  graphxr_api_key: "${GRAPHXR_API_KEY}"
```

### 8.2 tools.yaml（genai-toolbox 数据库配置）

```yaml
# config/tools.yaml

sources:
  neo4j:
    kind: neo4j
    uri: "${NEO4J_URI}"
    user: "${NEO4J_USER}"
    password: "${NEO4J_PASSWORD}"

  spanner:
    kind: spanner
    project: "${GCP_PROJECT}"
    instance: "${SPANNER_INSTANCE}"
    database: "${SPANNER_DATABASE}"

tools:
  neo4j-query:
    kind: neo4j-cypher
    source: neo4j
    description: "执行 Cypher 查询 Neo4j 图数据库"
    statement: "${cypher_query}"

  spanner-query:
    kind: spanner-sql
    source: spanner
    description: "执行 SQL 查询 Google Spanner"
    statement: "${sql_query}"
```

---

## 9. 技术选型

| 类别 | 选型 | 说明 |
|---|---|---|
| **主体语言** | **Node.js / TypeScript** | 与现有 GraphXR Agent 同栈，最小化集成摩擦 |
| MCP 协议 SDK | `@modelcontextprotocol/sdk` (npm) | Anthropic 官方 Node.js MCP SDK |
| **文件数据源 MCP** | **mcp-server-duckdb** ⭐ | CSV/JSON/Parquet 文件直接 SQL 查询，genai-toolbox 不支持的唯一完美替代 |
| **数据库 MCP（主）** | **googleapis/genai-toolbox** (Go) | Google 官方，Neo4j/Spanner/PostgreSQL/BigQuery 等 |
| **数据库 MCP（补）** | MCP Registry 社区 Server | Oracle/DynamoDB 等 toolbox 不支持的 |
| 非数据库 MCP | @modelcontextprotocol/server-* | filesystem、fetch、github 等官方 npm 包 |
| 数据验证 | Zod（TypeScript） | 统一图语义层类型校验，与 TS 生态一致 |
| 容器化 | Docker Compose | genai-toolbox（Go）+ graphxr-mcp-server（Node.js） |
| 测试框架 | Vitest / Jest | TypeScript 友好 |

---

## 10. 数据流示例

### 示例 A：CSV 文件数据 → GraphXR 图可视化

```
用户：把 /data/users.csv 的用户关系展示到 GraphXR

GraphXR Agent
  ├─► 调用 duckdb.query("SELECT * FROM read_csv_auto('/data/users.csv')")
  │       → 返回用户表格数据
  ├─► Data Transformer: CSV rows → GraphData
  │       nodes: [{id:"1", category:"User", properties:{name:"Alice"}}]
  │       edges: [{source:"1", target:"2", relationship:"KNOWS"}]
  └─► 调用 graphxr.push_graph(GraphData)
           → GraphXR UI 展示用户关系图 ✅
```

### 示例 B：跨源数据合并（CSV + Neo4j）→ GraphXR

```
用户：把 CSV 里的用户和 Neo4j 里的订单关系合并展示

GraphXR Agent
  ├─► duckdb.query(SQL on users.csv)    → 用户节点（50个）
  ├─► genai-toolbox/neo4j-query(Cypher) → 订单关系（200条）
  ├─► Data Transformer: 合并为统一 GraphData
  └─► graphxr.push_graph(merged GraphData)
           → GraphXR 同时展示用户节点 + 订单关系 ✅
```

### 示例 C：基于现有图状态的增量推理

```
用户在 GraphXR 中已有一张图，然后说：
"给当前图中所有 User 节点查询他们在 Neo4j 中的朋友关系"

GraphXR Agent
  ├─► graphxr.get_nodes({category: "User"}) → 当前图中的 User 节点列表
  ├─► 遍历每个 User，调用 neo4j-query(MATCH (u)-[:KNOWS]->(f))
  ├─► Data Transformer: 新关系 → GraphEdge[]
  └─► graphxr.add_edges(new_edges)         → 增量追加到现有图 ✅
          （不清空原有图，只是新增边）
```

---

## 11. 接入新数据源决策树

```
遇到新数据源？
      │
      ▼
是否是文件类（CSV / JSON / Parquet）？
      │
   ┌──┴──┐
  是      否
  │        │
  ▼        ▼
DuckDB   genai-toolbox 是否支持？
MCP      │
Server   ├── 是 → 修改 tools.yaml（1分钟）
（已有）  │
         └── 否 → MCP Registry 是否有社区 Server？
                    ├── 是 → hub_config.yaml 中 enabled=true（1分钟）
                    └── 否 → 自实现 MCP Server（参考 graphxr_mcp_server）
```

---

## 12. 快速启动

```bash
# 1. 克隆仓库
git clone https://github.com/Kineviz/graphxr-mcp-hub.git
cd graphxr-mcp-hub

# 2. 配置环境变量
cp .env.example .env
# 填入 GraphXR API Key、Neo4j 连接信息等

# 3. 安装 Node.js 依赖
npm install

# 4. 安装 Python 依赖（DuckDB MCP Server）
pip install mcp-server-duckdb
# 或使用 uvx（无需安装，推荐）

# 5. 按需配置数据源
vim config/hub_config.yaml   # 开启/关闭各数据源
vim config/tools.yaml         # 配置 genai-toolbox 支持的数据库

# 6. 启动 genai-toolbox（如需数据库数据源）
docker-compose up -d genai-toolbox

# 7. 启动 GraphXR MCP Server
npm run start:graphxr-mcp

# 8. 在 GraphXR Agent 的 MCP 配置中添加以上 Server 连接（见 §4.1）
```

---

## 13. 后续规划

- [ ] GraphXR MCP Server 完整实现（Node.js/TypeScript）
- [ ] DuckDB MCP 集成测试（CSV/JSON/Parquet → GraphXR）
- [ ] 支持实时流数据源（Kafka WebSocket MCP）
- [ ] 数据血缘追踪（从哪个数据源、哪个文件来的节点）
- [ ] 多 Agent 协作：多个 GraphXR Agent 共享同一 MCP Hub
- [ ] Web 管理 UI（可视化配置 hub_config.yaml）
- [ ] 支持更多 LLM 后端（Ollama 本地模型）

---

## 参考资料

- [googleapis/genai-toolbox GitHub](https://github.com/googleapis/genai-toolbox)
- [genai-toolbox Sources 官方文档](https://googleapis.github.io/genai-toolbox/resources/sources/) —— 确认不支持 CSV/JSON
- [ktanaka101/mcp-server-duckdb](https://github.com/ktanaka101/mcp-server-duckdb) —— CSV/JSON 首选方案
- [DuckDB read_csv 文档](https://duckdb.org/docs/data/csv/overview.html)
- [官方 MCP Registry](https://registry.modelcontextprotocol.io)
- [@modelcontextprotocol/sdk (npm)](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- [GraphXR API Reference](https://graphxr.dev/docs/graphxr-api/reference)

---

*文档版本：v0.5.0 | 更新日期：2026-03-24 | 维护团队：Kineviz*