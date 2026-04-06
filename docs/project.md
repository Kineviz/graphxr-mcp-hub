# GraphXR MCP Hub — 项目方案文档

> 多数据源 × MCP 协议 × 统一图语义层 × GraphXR 双向集成平台

---

## 1. 项目背景与定位

### 1.1 现状

**GraphXR** 是 Kineviz 开发的知识图谱 WebGL 可视化应用（运行在浏览器中）。  
**GraphXR Agent** 是 GraphXR **web 前端内置的 chat 页面**，通过 LLM 驱动，可直接读写 GraphXR WebGL 中显示的图数据，实现对话式图分析。Agent 并非独立的 Node.js 后端服务，而是与 GraphXR WebGL 紧密结合的前端功能。

### 1.2 本项目目标

**graphxr-mcp-hub 为 GraphXR 生态提供标准化的 MCP 数据源接入层：**

- 运行一个 **GraphXR MCP Server**（默认端口 `localhost:8899`），提供双向图数据通道
- GraphXR Agent（web chat 页面）**可选**连接此 MCP Server，实现多数据源接入
- Claude Desktop、Codex、其他 LLM 客户端也可**可选**连接同一 MCP Server
- 支持**推送**图数据到 GraphXR WebGL；也支持**查询**当前 GraphXR WebGL 中的图状态
- 通过 **MCP 协议**标准化数据源接入，新增数据源无需修改 Agent 核心代码

### 1.3 关键澄清（v1.0 修正）

| 问题 | 修正后的结论 |
|---|---|
| GraphXR Agent 是什么？ | **web 前端 chat 页面**，直接操作 GraphXR WebGL，不是独立的 Node.js 服务器 |
| GraphXR MCP Server 的默认端口？ | **`localhost:8899`**（不是 3100） |
| Agent 如何连接 MCP Server？ | 前端**自动探测**端口 8899 的 `/health` + `/mcp-info`，确认后**可选**连接 |
| Claude/Codex 是否必须连接？ | **可选**，通过标准 MCP 协议（SSE 或 STDIO）连接同一端口 |
| graphxr_mcp_server 是否需要双向支持？ | **是**（见 §3.3），通过 SSE+REST 被动桥接实现推送和查询 |
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

## 3. 整体架构（面向 GraphXR 生态的 MCP 数据通道）

### 3.1 架构定位：GraphXR 生态的双向 MCP 桥接层

```
┌──────────────────────────────────────────────────────────────────────┐
│  GraphXR Web App（浏览器端）                                          │
│                                                                      │
│  ┌───────────────────────┐    ┌──────────────────────────────────┐  │
│  │  GraphXR WebGL 图     │◄──►│  GraphXR Agent Chat 页面         │  │
│  │  （知识图谱可视化）    │    │  （LLM 驱动的对话式图分析）      │  │
│  └───────────┬───────────┘    └────────────────┬─────────────────┘  │
│              │ 自动发现 Hub                     │ 自动发现 Hub        │
│              │ GET /graphxr/events (SSE)        │ GET /sse (MCP SSE)  │
│              │ POST /graphxr/results            │ POST /messages      │
└──────────────┼─────────────────────────────────┼────────────────────┘
               │                                  │
               ▼                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│   GraphXR MCP Hub  (localhost:8899)                                   │
│                                                                       │
│   GET  /health          → 存活探针（自动发现）                        │
│   GET  /mcp-info        → 能力清单 + 工具列表 + 桥接端点              │
│   GET  /sse             → SSE MCP 传输通道（LLM Agent / Agent Chat）  │
│   POST /messages        → MCP 消息通道                                │
│   GET  /graphxr/events  → SSE 命令推送通道（GraphXR WebGL 桥接）      │
│   POST /graphxr/results → REST 结果回传通道（GraphXR WebGL 桥接）     │
│   GET  /graphxr/status  → 桥接连接状态                                │
│   GET  /admin           → Web 管理 UI                                 │
│   --stdio               → STDIO 传输通道（Claude Desktop 等）         │
└──────────────────────────────────────────────────────────────────────┘

外部 LLM 客户端（可选，均通过标准 MCP 协议连接）
  • Claude Desktop  → STDIO（--stdio 模式）或 SSE
  • Codex / GPT     → SSE (http://localhost:8899/sse)
  • 其他 MCP 客户端  → 同上
```

**架构要点：**
- **连接方向反转**：GraphXR WebGL **主动发现并连接** Hub（而非 Hub 连接 GraphXR），消除启动顺序依赖
- GraphXR Agent 是**浏览器内的 chat 页面**，不是独立的后端服务
- GraphXR MCP Server 是独立进程，运行在宿主机的 `localhost:8899`
- 前端通过**自动发现**（轮询 `/health` 和 `/mcp-info`）决定是否提示用户连接，**连接始终可选**
- **全链路 SSE + REST**：LLM → Hub 和 Hub → GraphXR 均采用 SSE + REST，协议模式一致
- Claude、Codex 等外部 LLM 客户端也可以连接同一端口，与 GraphXR Agent 并行使用

### 3.2 数据流全景

```
用户在 GraphXR Agent Chat 中提问（或 Claude/Codex 中）
         │
         ▼
MCP Client（GraphXR Agent 前端 / Claude Desktop / Codex 等）
  调用 MCP 工具列表
         │
         ├─► DuckDB MCP Server 工具（query CSV/JSON/Parquet）
         │       SQL on 文件 → 表格数据
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
   graphxr_mcp_server（localhost:8899，双向）
         ├─► push_graph()        推送节点和边到 GraphXR WebGL
         ├─► get_graph_state()   查询当前图状态（反馈给 Agent/LLM）
         ├─► add_nodes() / add_edges()   增量追加
         └─► clear_graph()       清空画布
         │ SSE（GET /graphxr/events）+ REST（POST /graphxr/results）
         ▼
   GraphXR WebGL 实时展示 ✅
```

### 3.3 GraphXR 桥接层详解（SSE + REST，被动模式）

Hub 与 GraphXR WebGL 之间采用 **SSE + REST** 被动桥接（`GraphXRBridge`），替代了早期的 WebSocket 主动连接方案。

#### 通信协议

```
GraphXR WebGL                          MCP Hub (:8899)
     │                                      │
     ├── GET /graphxr/events (SSE) ────────►│  订阅命令流
     │◄── event: command {requestId,        │  Hub 推送命令
     │         method, params}              │
     │                                      │
     ├── POST /graphxr/results ────────────►│  回传执行结果
     │   {requestId, result?, error?}       │
     │                                      │
     ├── event: heartbeat ◄─────────────────│  30s 心跳保活
     └──────────────────────────────────────┘
```

**为什么用 SSE + REST 替代 WebSocket：**

| 维度 | WebSocket（旧） | SSE + REST（新） |
|---|---|---|
| 连接方向 | Hub 主动连接 GraphXR（需要 `GRAPHXR_WS_URL`） | GraphXR 主动连接 Hub（自动发现，零配置） |
| 启动依赖 | Hub 依赖 GraphXR 先启动 | Hub 独立运行，GraphXR 随时接入/断开 |
| 浏览器兼容 | 需要 WebSocket 升级握手 | `EventSource` 原生支持，自动重连 |
| 协议一致性 | MCP 用 SSE，桥接用 WS，两套协议 | 全链路 SSE + REST，一致的通信范式 |
| 代理/CDN | WebSocket 需要特殊配置 | 标准 HTTP，代理/CORS 处理简单 |
| 多实例 | 单连接 | 支持多个 GraphXR 实例同时连接（广播） |

#### 推送方向（Agent → GraphXR）

MCP 工具被调用时，Hub 通过 SSE `command` 事件推送到 GraphXR：

| 工具 | 说明 |
|---|---|
| `push_graph(nodes, edges)` | 批量推送完整图数据 |
| `add_nodes(nodes)` | 增量添加节点 |
| `add_edges(edges)` | 增量添加边 |
| `update_node(id, properties)` | 更新节点属性 |
| `clear_graph()` | 清空当前图 |

#### 查询方向（Agent ← GraphXR）

Hub 通过 SSE 推送查询命令，GraphXR 执行后通过 `POST /graphxr/results` 回传结果：

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
           ↓ push_graph()（SSE command 事件）
       GraphXR 展示图  
  
用户在 GraphXR 中选中几个节点后说：
  "分析我选中的这些节点的共同特征"
           ↓ get_graph_state() / get_nodes()（SSE command → POST results）
  Agent 读取当前图状态，基于现有图继续推理
           ↓ add_edges()（SSE command 事件）
  Agent 追加分析结果到图中
```

没有查询方向，Agent 就是"盲写"——每次都要重建整个图，无法基于用户的图操作进行增量推理。

---

## 4. 各类客户端如何连接 GraphXR MCP Server

### 4.1 GraphXR Agent（web 前端 chat 页面）— 自动发现连接

GraphXR Agent 的 chat 页面在初始化时自动执行以下发现流程：

```
1. GET http://localhost:8899/health
   → 如果返回 {"status":"ok"}，则继续

2. GET http://localhost:8899/mcp-info
   → 检查 graphxrCompatible === true
   → 读取 graphxrBridge.eventsEndpoint / resultsEndpoint
   → 展示工具列表，提示用户可选连接

3. 用户确认连接后（两条通道并行建立）
   a) MCP 通道：GET /sse → Agent Chat 调用 MCP 工具
   b) 桥接通道：GET /graphxr/events (SSE) → GraphXR WebGL 接收命令
      GraphXR 执行命令后 POST /graphxr/results 回传结果
```

连接始终是**可选的**——如果端口 8899 没有响应，Agent 正常工作，不受影响。

### 4.2 Claude Desktop — STDIO 模式（可选）

在 `claude_desktop_config.json` 中添加：

```json
{
  "mcpServers": {
    "graphxr": {
      "command": "node",
      "args": ["/path/to/graphxr-mcp-hub/dist/graphxr_mcp_server/index.js", "--stdio"],
      "description": "GraphXR 双向 MCP：推送图数据 + 查询当前图状态"
    }
  }
}
```

### 4.3 其他 LLM 客户端（Codex、自定义 Agent 等）— SSE 模式（可选）

```json
{
  "mcpServers": {
    "graphxr": {
      "transport": "sse",
      "url": "http://localhost:8899/sse",
      "description": "GraphXR MCP Server（端口 8899）"
    },

    // ── 可选：CSV/JSON 文件数据源 ──────────────────────────
    "duckdb": {
      "command": "uvx",
      "args": ["mcp-server-duckdb", "--db-path", ":memory:"],
      "description": "DuckDB：支持 CSV/JSON/Parquet 文件的 SQL 查询"
    },

    // ── 可选：数据库数据源（genai-toolbox）─────────────────
    "genai-toolbox": {
      "transport": "sse",
      "url": "http://localhost:5000/sse",
      "description": "Google genai-toolbox：Neo4j/Spanner/PostgreSQL 等"
    },

    // ── 可选：通用文件系统 ──────────────────────────────────
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/data"],
      "description": "本地文件读写"
    }
  }
}
```

### 4.4 技术栈

| 组件 | 语言 | 说明 |
|---|---|---|
| `graphxr_mcp_server` | **Node.js / TypeScript** | MCP Server 主体，端口 8899，SSE + STDIO 双模式，GraphXR 桥接（SSE+REST 被动模式） |
| `semantic_layer` | **Node.js / TypeScript** | 统一图语义类型 + 数据转换器 |
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
│   ├── index.ts                            # MCP Server 入口（端口 8899，SSE + STDIO 双模式）
│   ├── graphxr_bridge.ts                   # GraphXR SSE+REST 被动桥接层（替代 WebSocket）
│   ├── graphxr_client.ts                   # [已废弃] 旧版 WebSocket 客户端，将在 v0.2.0 移除
│   └── tools/
│       ├── definitions.ts                  # 所有工具的 MCP 定义（含 /mcp-info 清单）
│       ├── push_graph.ts                   # 推送完整图数据到 GraphXR WebGL
│       ├── add_nodes.ts                    # 增量添加节点
│       ├── add_edges.ts                    # 增量添加边
│       ├── update_node.ts                  # 更新节点属性
│       ├── clear_graph.ts                  # 清空图
│       ├── get_graph_state.ts              # 查询当前图状态
│       ├── get_nodes.ts                    # 按条件查询节点
│       ├── get_edges.ts                    # 按条件查询边
│       └── find_neighbors.ts              # 查询节点邻居
│
├── semantic_layer/                          # 统一图语义层（Node.js/TS）
│   ├── graph_schema.ts                     # TypeScript 类型定义（Zod Schema）
│   ├── validators.ts                       # 数据合法性校验
│   └── transformers/
│       ├── csv_transformer.ts              # CSV/DuckDB 结果 → GraphData
│       ├── json_transformer.ts             # JSON → GraphData
│       ├── neo4j_transformer.ts            # Neo4j 查询结果 → GraphData
│       └── spanner_transformer.ts          # Spanner/SQL 结果 → GraphData
│
├── config/
│   ├── hub_config.yaml                     # ⭐ 总控：端口 8899、数据源开关
│   └── tools.yaml                          # ⭐ genai-toolbox 数据库配置
│
├── data/
│   ├── sample.csv
│   └── sample.json
│
├── tests/
│   ├── test_graphxr_mcp.ts                 # 自动发现端点测试
│   └── test_transformer.ts                 # 数据转换器测试
│
├── .env.example
├── package.json                            # Node.js 依赖
├── tsconfig.json
├── vitest.config.ts
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
# 默认端口 8899 — GraphXR Agent 前端自动探测此端口
# 无需配置 GraphXR 地址：GraphXR 主动连接 Hub（SSE 被动模式）
graphxr_mcp_server:
  enabled: true
  port: 8899
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
# 主要参数：GRAPHXR_MCP_PORT（默认 8899）

# 3. 安装 Node.js 依赖
npm install

# 4. 按需配置数据源（可选）
vim config/hub_config.yaml   # 开启/关闭各数据源
vim config/tools.yaml         # 配置 genai-toolbox 支持的数据库

# 5. （可选）安装 Python 依赖（DuckDB MCP Server，用于 CSV/JSON 文件数据）
pip install mcp-server-duckdb
# 或使用 uvx（无需安装，推荐）

# 6. （可选）启动 genai-toolbox（如需数据库数据源）
docker-compose up -d genai-toolbox

# 7. 启动 GraphXR MCP Server（HTTP/SSE 模式，供前端自动发现）
npm run start:graphxr-mcp
# 验证：curl http://localhost:8899/health
# 验证：curl http://localhost:8899/mcp-info

# 8. 打开 GraphXR，Agent chat 页面将自动探测到端口 8899 并提示可选连接
```

### Claude Desktop 快速接入（STDIO 模式）

```bash
# 先编译
npm run build

# 然后在 claude_desktop_config.json 中添加 graphxr MCP Server（见 §4.2）
```

---

## 13. 后续规划

- [x] GraphXR MCP Server 完整实现（Node.js/TypeScript，端口 8899）
- [x] 自动发现端点（/health + /mcp-info）
- [x] SSE + STDIO 双传输模式
- [x] 统一图语义层（Zod Schema + 数据转换器）
- [x] GraphXR Agent 前端接入自动发现逻辑（discovery_client.ts 发现客户端 SDK）
- [x] DuckDB MCP 集成测试（CSV/JSON/Parquet → GraphXR）
- [x] Docker Compose 一键启动（genai-toolbox + graphxr-mcp-server）
- [x] 支持实时流数据源（Kafka WebSocket MCP — kafka_transformer + kafka_bridge）
- [x] 数据血缘追踪（lineage.ts — 自动注入 _lineage 元数据 + 操作日志）
- [x] 多客户端协作（session_manager.ts — SSE 会话管理 + 状态广播 + /sessions 端点）
- [x] Web 管理 UI（/admin 仪表盘 — 配置管理 / 会话监控 / 血缘查看）
- [x] 支持更多 LLM 后端（Ollama 本地模型 — ollama_config.ts 配置生成器）

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

*文档版本：v0.2.0 | 更新日期：2026-04-06 | 维护团队：Kineviz*