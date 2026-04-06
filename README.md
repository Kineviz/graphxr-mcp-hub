# GraphXR MCP Hub

> 多数据源 × MCP 协议 × 统一图语义层 × GraphXR 双向集成平台

## 架构概览

```
┌──────────────────────────────────────────────────────────────────┐
│  GraphXR Web App（浏览器端）                                       │
│                                                                  │
│  ┌─────────────────────┐    ┌───────────────────────────────┐   │
│  │  GraphXR WebGL 图   │◄──►│  GraphXR Agent Chat 页面      │   │
│  │  （知识图谱可视化）  │    │  （LLM 驱动的对话式分析）     │   │
│  └─────────────────────┘    └──────────────┬──────────────┘    │
└─────────────────────────────────────────────┼────────────────────┘
                                              │ 自动发现（可选连接）
                      ┌───────────────────────▼─────────────────────┐
                      │   GraphXR MCP Server  (localhost:8899)       │
                      │                                              │
                      │   GET /health     → 存活探针               │
                      │   GET /mcp-info   → 能力清单 + 工具列表    │
                      │   GET /sse        → SSE MCP 传输通道        │
                      │   --stdio         → STDIO 传输通道          │
                      └────────────────────┬─────────────────────────┘
                                           │ WebSocket (ws://localhost:8080)
                      ┌────────────────────▼─────────────────────────┐
                      │  GraphXR WebGL 桥接层（双向）                 │
                      │  推送方向: push_graph / add_nodes / add_edges │
                      │  查询方向: get_graph_state / get_nodes / ...  │
                      └──────────────────────────────────────────────┘

外部 LLM 客户端（可选，任意选择连接或不连接）
  • Claude Desktop  → 通过 STDIO 或 SSE 连接 localhost:8899
  • Codex / GPT     → 通过 SSE 连接 localhost:8899
  • 其他 MCP 客户端  → 同上
```

### 关键设计说明

| 角色 | 说明 |
|---|---|
| **GraphXR Agent** | 浏览器内的 chat 页面，直接操作 GraphXR WebGL 图数据，可选连接本 MCP Server |
| **GraphXR MCP Server** | 本仓库自实现的 MCP Server，运行在 `localhost:8899` |
| **自动发现** | GraphXR Agent 前端轮询 `/health` + `/mcp-info`，端口存活则提示用户可选连接 |
| **Claude / Codex** | 通过标准 MCP 协议连接，连接完全可选 |
| **双向数据流** | 推送图数据到 GraphXR WebGL；或从 GraphXR WebGL 读取当前图状态 |

---

## 快速启动

### 1. 安装依赖

```bash
git clone https://github.com/Kineviz/graphxr-mcp-hub.git
cd graphxr-mcp-hub
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 按需修改 .env 中的参数
```

### 3. 启动 GraphXR MCP Server

```bash
# HTTP/SSE 模式（供 GraphXR Agent 前端和浏览器端 LLM 客户端使用）
npm run start:graphxr-mcp

# STDIO 模式（供 Claude Desktop、Codex CLI 等工具使用）
npm run start:graphxr-mcp -- --stdio
```

启动后可验证：

```bash
# 存活探针
curl http://localhost:8899/health
# → {"status":"ok","service":"graphxr-mcp-server","version":"0.1.0"}

# 能力清单
curl http://localhost:8899/mcp-info
# → {"name":"graphxr-mcp-server","protocol":"mcp","graphxrCompatible":true,...}
```

### 4. GraphXR Agent 前端连接

GraphXR Agent 的 chat 页面在启动时会自动探测 `localhost:8899`：
- 如果 `/health` 返回正常且 `/mcp-info` 中 `graphxrCompatible: true`，则提示用户可选连接。
- 连接后 Agent 即可调用本 MCP Server 的所有工具，实现图数据推送和查询。

### 5. Claude Desktop 连接（可选）

在 Claude Desktop 的 `claude_desktop_config.json` 中添加：

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

### 6. 其他 LLM 客户端 SSE 连接（可选）

```json
{
  "mcpServers": {
    "graphxr": {
      "transport": "sse",
      "url": "http://localhost:8899/sse",
      "description": "GraphXR MCP Server"
    }
  }
}
```

---

## MCP 工具列表

### 推送方向（Client → GraphXR WebGL）

| 工具 | 说明 |
|---|---|
| `push_graph(nodes, edges)` | 替换 GraphXR 中的全量图数据 |
| `add_nodes(nodes)` | 增量追加节点（不清空原有图） |
| `add_edges(edges)` | 增量追加边（不清空原有图） |
| `update_node(id, properties)` | 更新单个节点的属性 |
| `clear_graph()` | 清空 GraphXR 画布 |

### 查询方向（GraphXR WebGL → Client）

| 工具 | 说明 |
|---|---|
| `get_graph_state()` | 节点数、边数、分类统计 |
| `get_nodes(filter?)` | 按条件查询当前图中的节点 |
| `get_edges(filter?)` | 按条件查询当前图中的边 |
| `find_neighbors(node_id)` | 查询指定节点的邻居节点和边 |

---

## 自动数据接入（内置 DuckDB）

Hub 内置了 DuckDB 数据库引擎，支持 CSV、JSON、Parquet 文件的零配置自动接入。

### 端到端流程

```
用户 → GraphXR Agent: "帮我分析 users.csv 的用户关系" [附件: users.csv]

Agent → Hub: ingest_file({ file_path: "data/users.csv" })
Hub:  自动初始化 DuckDB → 加载文件 → 返回 schema

Hub → Agent: { table: "users", columns: [{name:"id",...}], rows: 5, sample: [...] }

Agent → Hub: query_data({
  sql: "SELECT * FROM users",
  push_to_graphxr: true,
  transform_config: { nodeCategory: "User", idColumn: "id", targetColumn: "friend_id" }
})

Hub:  查询 → 转换为图数据 → 推送到 GraphXR → 画布渲染 ✅
```

### 数据接入工具

| 工具 | 说明 |
|---|---|
| `ingest_file(file_path?, file_content?, format?, table_name?)` | 加载文件到内置数据库，返回 schema + 示例数据 |
| `query_data(sql, push_to_graphxr?, transform_config?)` | 执行 SQL 查询，可选自动推送到 GraphXR |
| `list_tables()` | 列出所有已加载的数据表 |

支持的文件格式：CSV、TSV、JSON、JSONL、Parquet

Agent 也可以直接传入文件内容（无需文件路径）：
```
ingest_file({ file_content: "id,name\n1,Alice\n2,Bob", format: "csv" })
```

---

## 数据源管理

### 内置数据源（随 Hub 自动启动）

| 数据源 | 方案 | 状态 |
|---|---|---|
| CSV / JSON / Parquet | 内置 DuckDB（npm 包） | 自动按需初始化，零配置 |
| Neo4j / Spanner / PostgreSQL | genai-toolbox（SSE 连接） | 默认启用，启动时自动连接 |

### 按需接入数据源（通过 API 或 Agent 触发）

| 数据源 | 方案 | 接入方式 |
|---|---|---|
| 本地文件系统 | @modelcontextprotocol/server-filesystem | `POST /sources/filesystem/connect` |
| HTTP REST API | @modelcontextprotocol/server-fetch | `POST /sources/fetch/connect` |
| GitHub | @modelcontextprotocol/server-github | `POST /sources/github/connect` |
| 其他 MCP 社区 Server | MCP Registry | 在 hub_config.yaml 中添加配置 |

### 数据源管理 API

```bash
# 查看所有数据源状态
curl http://localhost:8899/sources

# 按需接入某个数据源
curl -X POST http://localhost:8899/sources/filesystem/connect
```

外部数据源的工具会自动注入到 Hub 的工具列表中，以 `{source}__{tool}` 格式命名：
- `toolbox__neo4j-query` — genai-toolbox 的 Neo4j 查询
- `filesystem__read_file` — 文件系统读取
- `fetch__fetch` — HTTP 抓取

---

## 数据流示例

### 示例 A：CSV 数据 → GraphXR 图可视化

```
用户（通过 GraphXR Agent Chat 或 Claude）：
  "把 /data/users.csv 的用户关系显示在 GraphXR 中"

MCP Client
  ├─► duckdb.query("SELECT * FROM read_csv_auto('/data/users.csv')")
  ├─► Data Transformer: CSV rows → GraphData
  └─► graphxr.push_graph(GraphData)
           → GraphXR WebGL 实时渲染用户关系图 ✅
```

### 示例 B：基于当前图的增量推理

```
用户在 GraphXR WebGL 中已有图，对 Agent 说：
  "给当前图中所有 User 节点查询 Neo4j 中的朋友关系"

MCP Client
  ├─► graphxr.get_nodes({"category": "User"})  → 当前图中的 User 列表
  ├─► neo4j.query(MATCH (u:User)-[:KNOWS]->(f))
  └─► graphxr.add_edges(new_edges)             → 增量追加到现有图 ✅
```

---

## 开发

```bash
npm run build       # TypeScript 编译
npm run typecheck   # 类型检查
npm test            # 运行测试（Vitest）
npm run lint        # ESLint
```

---

## Docker

### 构建并运行

```bash
# 构建镜像
docker build -t graphxr-mcp-hub .

# 运行容器
docker run -d -p 8899:8899 --env-file .env graphxr-mcp-hub
```

### Docker Compose

```bash
# 仅启动 GraphXR MCP Server
docker compose up -d

# 同时启动 genai-toolbox（数据库数据源）
docker compose --profile toolbox up -d

# 验证
curl http://localhost:8899/health
```

> **Linux 用户注意**：如需从容器内访问宿主机服务（如 GraphXR WebSocket），请添加 `--add-host=host.docker.internal:host-gateway` 或使用 `network_mode: host`。

---

## 数据血缘追踪

所有通过 `push_graph`、`add_nodes`、`add_edges` 推送的数据会自动注入血缘元数据：

```json
{
  "properties": {
    "name": "Alice",
    "_lineage": {
      "source": "csv:data/sample.csv",
      "operation": "push_graph",
      "timestamp": "2026-03-26T10:00:00Z",
      "operationId": "op_1711440000_1"
    }
  }
}
```

调用工具时可通过 `source` 参数指定数据来源（如 `"csv:data/users.csv"`），系统会自动关联。

---

## 多客户端协作

支持多个 LLM 客户端（GraphXR Agent、Claude Desktop、Codex 等）同时连接同一 MCP Server：

- 每个 SSE 连接自动注册为独立会话
- `GET /sessions` — 查看当前连接的所有客户端
- 当一个客户端修改图时，其他客户端会感知到变更

---

## Web 管理 UI

启动服务后访问 `http://localhost:8899/admin` 进入管理仪表盘：

- 实时查看活跃会话
- 查看数据操作血缘日志
- 查看和编辑 `hub_config.yaml` 配置

---

## Kafka 实时流

支持通过 Kafka WebSocket 代理实时消费消息并自动推送到 GraphXR：

1. 在 `hub_config.yaml` 中启用 `kafka.enabled: true`
2. 配置 `KAFKA_WS_URL`、topics 等参数
3. 消息自动批量转换为图节点/边并推送

---

## Ollama 本地 LLM

支持 Ollama 作为本地 LLM 后端连接 GraphXR MCP Server：

```bash
# 生成 Ollama MCP 客户端配置
npx ts-node config/ollama_config.ts --model llama3

# 使用 SSE 模式
npx ts-node config/ollama_config.ts --transport sse

# 自定义 Ollama 地址
npx ts-node config/ollama_config.ts --ollama-url http://192.168.1.100:11434
```

在 `hub_config.yaml` 中启用 `ollama.enabled: true` 并配置模型和地址。

---

## 目录结构

```
graphxr-mcp-hub/
├── graphxr_mcp_server/
│   ├── index.ts              # MCP Server 入口（端口 8899，支持 SSE + STDIO）
│   ├── graphxr_client.ts     # GraphXR WebSocket 桥接客户端
│   ├── duckdb_manager.ts     # 内置 DuckDB 数据库管理器（自动初始化）
│   ├── source_manager.ts    # 外部 MCP 数据源管理（genai-toolbox 内置 + 按需接入）
│   ├── session_manager.ts    # 多客户端会话管理
│   ├── discovery_client.ts   # MCP Server 自动发现客户端 SDK
│   ├── kafka_bridge.ts       # Kafka → GraphXR 实时流桥接
│   ├── admin_ui.ts           # Web 管理仪表盘（/admin）
│   └── tools/
│       ├── definitions.ts    # 所有工具的 MCP 定义（含 /mcp-info 清单）
│       ├── push_graph.ts     # （含血缘追踪）
│       ├── add_nodes.ts      # （含血缘追踪）
│       ├── add_edges.ts      # （含血缘追踪）
│       ├── ingest_file.ts    # 文件接入（CSV/JSON/Parquet → DuckDB）
│       ├── query_data.ts     # SQL 查询 + 可选推送 GraphXR
│       ├── list_tables.ts    # 列出已加载数据表
│       ├── update_node.ts
│       ├── clear_graph.ts
│       ├── get_graph_state.ts
│       ├── get_nodes.ts
│       ├── get_edges.ts
│       └── find_neighbors.ts
├── semantic_layer/
│   ├── graph_schema.ts       # 统一图语义类型（Zod + TypeScript）
│   ├── validators.ts
│   ├── lineage.ts            # 数据血缘追踪（元数据注入 + 操作日志）
│   └── transformers/
│       ├── csv_transformer.ts
│       ├── json_transformer.ts
│       ├── neo4j_transformer.ts
│       ├── spanner_transformer.ts
│       └── kafka_transformer.ts  # Kafka 消息 → 图数据转换器
├── config/
│   ├── hub_config.yaml       # 总控配置（端口、数据源开关、Kafka、Ollama）
│   ├── tools.yaml            # genai-toolbox 数据库配置
│   └── ollama_config.ts      # Ollama 本地 LLM 配置生成器
├── data/
│   ├── sample.csv
│   └── sample.json
├── tests/
│   ├── test_graphxr_mcp.ts       # 自动发现端点测试
│   ├── test_transformer.ts       # 数据转换器测试
│   ├── test_duckdb_pipeline.ts   # DuckDB 集成管道测试
│   ├── test_lineage.ts           # 数据血缘追踪测试
│   ├── test_session_manager.ts   # 多客户端会话管理测试
│   ├── test_discovery_client.ts  # 发现客户端测试
│   ├── test_kafka_transformer.ts # Kafka 转换器测试
│   ├── test_duckdb_manager.ts   # DuckDB 管理器 + 数据接入测试
│   └── test_source_manager.ts  # 外部数据源管理测试
├── docs/
│   └── project.md            # 详细项目方案文档
├── .env.example
├── Dockerfile                # 多阶段 Docker 构建
├── .dockerignore
├── docker-compose.yml        # 一键启动（含可选 genai-toolbox）
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

*版本：v0.1.0 | 维护团队：Kineviz*
