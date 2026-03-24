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
# → {"status":"ok","service":"graphxr-mcp-server","version":"1.0.0"}

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

### 实时流（Kafka / WebSocket → GraphXR WebGL）

| 工具 | 说明 |
|---|---|
| `stream_subscribe(url, name?, mode?, transform?)` | 订阅 WebSocket/Kafka 流，返回 subscriptionId |
| `stream_unsubscribe(id)` | 停止指定流订阅 |
| `stream_list()` | 列出所有活跃流订阅及其状态 |

---

## Web 管理 UI

启动服务后访问 `http://localhost:8899/admin`：

- **服务器状态**：MCP Server 运行情况 + GraphXR WebSocket 状态
- **数据源开关**：读取 hub_config.yaml，点击切换 enabled/disabled
- **工具清单**：全部 12 个 MCP 工具的 badge 一览
- **流订阅监控**：活跃流的 ID、状态、消息计数

```bash
# API: 禁用 duckdb
curl -X PATCH http://localhost:8899/admin/config \
  -H 'Content-Type: application/json' \
  -d '{"server":"duckdb","enabled":false}'

# API: 查看活跃流
curl http://localhost:8899/admin/streams
```

---

## 可选数据源扩展

除 GraphXR MCP Server 外，本 Hub 还支持通过 `config/hub_config.yaml` 按需开启其他数据源：

| 数据源 | 方案 | 说明 |
|---|---|---|
| CSV / JSON / Parquet | DuckDB MCP Server | `uvx mcp-server-duckdb` |
| Neo4j / Spanner / PostgreSQL | googleapis/genai-toolbox | Go 二进制，SSE 接口 |
| HTTP REST API | @modelcontextprotocol/server-fetch | 官方 npm 包 |
| 本地文件系统 | @modelcontextprotocol/server-filesystem | 官方 npm 包 |
| Oracle / DynamoDB | MCP Registry 社区 Server | 按需启用 |

---

## Docker 一键启动

```bash
# 仅启动 GraphXR MCP Server
docker-compose up graphxr-mcp

# 同时启动 genai-toolbox（数据库数据源）
docker-compose --profile databases up

# 后台运行
docker-compose up -d graphxr-mcp
```

---

## 数据血缘追踪

每个节点/边都可携带 `_lineage` 字段，追踪数据来源：

```typescript
const graph = csvResultToGraph(rows, {
  nodeCategory: 'User',
  lineage: { source: 'duckdb', file: '/data/users.csv' },
});
// graph.nodes[0]._lineage === { source: 'duckdb', file: '/data/users.csv', fetchedAt: '2026-...' }
```

---

## 实时流数据（Kafka / WebSocket）

```typescript
// 通过 MCP stream_subscribe 工具订阅 Kafka topic
// 消息自动增量推送到 GraphXR WebGL
{
  "url": "ws://localhost:9092/topics/events",
  "name": "event-stream",
  "mode": "incremental",
  "transform": { "nodeCategory": "Event", "idField": "event_id" }
}
```

---

## GraphXR Agent 前端自动发现

在 GraphXR Agent 前端 bundle 中嵌入：

```typescript
import { GraphXRMcpDiscovery } from './mcp_client/discovery';

const discovery = new GraphXRMcpDiscovery({ port: 8899 });
discovery.onStatusChange((status, info) => {
  if (status === 'available') showConnectButton(info!.tools);
  else if (status === 'connected') showConnectedBadge();
});
await discovery.startPolling();
```

---

## Ollama 本地 LLM

```typescript
import { OllamaMcpClient } from './mcp_client/ollama_client.js';

const client = new OllamaMcpClient({ model: 'llama3.2', mcpServerUrl: 'http://localhost:8899' });
const reply = await client.chat('把 data/users.csv 的用户关系图推送到 GraphXR');
```

无外网环境下使用本地模型驱动 GraphXR Agent，支持 llama3.2、mistral、qwen2.5 等支持 function calling 的模型。

---

## 数据流示例

### 示例 A：CSV 数据 → GraphXR 图可视化

```
用户（通过 GraphXR Agent Chat 或 Claude）：
  "把 /data/users.csv 的用户关系显示在 GraphXR 中"

MCP Client
  ├─► duckdb.query("SELECT * FROM read_csv_auto('/data/users.csv')")
  ├─► Data Transformer: CSV rows → GraphData（附 DuckDB 血缘）
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

### 示例 C：Kafka 实时事件流 → GraphXR

```
stream_subscribe("ws://kafka-bridge:9092/topics/user-logins", mode="incremental")
  → 每条 Kafka 消息 → GraphData.nodes → graphxr.addNodes()
  → GraphXR WebGL 实时展示用户登录事件节点 ✅
```

---

## 开发

```bash
npm run build       # TypeScript 编译
npm run typecheck   # 类型检查
npm test            # 运行所有测试（Vitest）— 102 tests
npm run lint        # ESLint
```

---

## 目录结构

```
graphxr-mcp-hub/
├── graphxr_mcp_server/
│   ├── index.ts              # MCP Server 入口（端口 8899，SSE + STDIO + Admin UI）
│   ├── graphxr_client.ts     # GraphXR WebSocket 桥接客户端
│   └── tools/
│       ├── definitions.ts    # 全部 12 个 MCP 工具定义
│       ├── push_graph.ts / add_nodes.ts / add_edges.ts / update_node.ts
│       ├── clear_graph.ts / get_graph_state.ts / get_nodes.ts / get_edges.ts
│       ├── find_neighbors.ts
│       ├── stream_subscribe.ts  # Kafka/WebSocket 流订阅工具
│       └── stream_tools.ts      # stream_unsubscribe + stream_list 工具
├── streaming/
│   ├── stream_adapter.ts     # 抽象流适配器基类
│   ├── websocket_stream.ts   # WebSocket/Kafka-over-WS 流适配器
│   └── stream_manager.ts     # 流订阅注册表 + GraphXR 数据推送
├── semantic_layer/
│   ├── graph_schema.ts       # 统一图语义类型（Zod + TypeScript + 血缘追踪）
│   ├── validators.ts
│   └── transformers/
│       ├── csv_transformer.ts / json_transformer.ts
│       ├── neo4j_transformer.ts / spanner_transformer.ts
│       └── kafka_transformer.ts  # Kafka 消息 → GraphData 转换器
├── mcp_client/
│   ├── hub.ts                # MCP Hub Client — 多服务器连接管理器
│   ├── discovery.ts          # GraphXR Agent 前端自动发现模块（纯 Web API）
│   └── ollama_client.ts      # Ollama 本地 LLM ↔ MCP 桥接客户端
├── config/
│   ├── hub_config.yaml       # 总控配置（端口、数据源、流、LLM 后端）
│   └── tools.yaml            # genai-toolbox 数据库配置
├── data/
│   ├── sample.csv
│   └── sample.json
├── tests/
│   ├── test_graphxr_mcp.ts      # 自动发现端点测试（5）
│   ├── test_transformer.ts      # 数据转换器基础测试（12）
│   ├── test_lineage.ts          # 血缘追踪测试（12）
│   ├── test_duckdb_pipeline.ts  # DuckDB 流水线集成测试（8）
│   ├── test_hub.ts              # Hub Client 测试（15）
│   ├── test_discovery.ts        # 自动发现客户端测试（8）
│   ├── test_kafka_transformer.ts # Kafka 消息转换器测试（11）
│   ├── test_streaming.ts        # 流适配器 + StreamManager 测试（14）
│   ├── test_ollama_client.ts    # Ollama MCP 桥接客户端测试（8）
│   └── test_admin_ui.ts         # Admin UI API 配置管理测试（9）
├── docs/
│   └── project.md            # 详细项目方案文档（v1.2.0）
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

*版本：v1.2.0 | 维护团队：Kineviz*
