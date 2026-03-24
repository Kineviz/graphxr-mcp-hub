# GraphXR MCP Hub — 项目方案文档

> 多数据源 × MCP 协议 × 统一图语义层 × GraphXR 可视化智能体平台

---

## 1. 项目背景

GraphXR 是 Kineviz 开发的知识图谱可视化平台。随着 AI Agent 能力的引入，业务上需要：

- 让 Agent 直接访问**多种异构数据源**（CSV、JSON、Neo4j、Google Spanner 等）
- 对数据进行**智能分析与推理**
- 将分析结果**自动展示到 GraphXR** 中进行可视化

本方案采用 **方案三：MCP + 统一图语义层** 架构，并引入两套互补的外部 MCP 机制：

- **[googleapis/genai-toolbox](https://github.com/googleapis/genai-toolbox)**：Google 官方开源的数据库专用 MCP Toolbox，作为**所有数据库类数据源的首选接入方式**
- **官方 MCP Registry**：用于接入非数据库类数据源（文件系统、HTTP API、GitHub 等）

---

## 2. 三种方案对比

| 维度 | 方案一：Skills | 方案二：MCP | **方案三：MCP + 语义层 + 动态注册（推荐）** |
|---|---|---|---|
| 数据源扩展性 | 低，每个源写一个 Skill | 中，每个源写一个 MCP Server | **最高，配置即接入，无需写代码** |
| 跨源数据 Join | 困难，需 Agent 自行处理 | 较困难 | **自然，统一图结构** |
| GraphXR 自动展示 | 需单独适配 Skill | 需 GraphXR MCP 接口 | **天然兼容，统一推送** |
| Agent 推理能力 | 依赖 Skill 设计质量 | 较好 | **最强，LLM 理解图语义** |
| 维护成本 | 高（线性增长） | 中 | **低，Google + 社区官方维护** |
| 新数据源接入 | 写新 Skill | 写新 MCP Server | **改一行配置即可** |

---

## 3. 核心设计理念：分层动态集成

### 3.1 三类 MCP Server 职责划分

```
┌────────────────────────────────────────────────────────────────────┐
│  类型 A：googleapis/genai-toolbox（数据库类数据源首选）              │
│                                                                    │
│  来源：Google 官方开源 https://github.com/googleapis/genai-toolbox  │
│  定位：MCP Toolbox for Databases，专为 AI Agent 访问数据库而设计     │
│  覆盖：Spanner / Neo4j / PostgreSQL / MySQL / BigQuery /           │
│        AlloyDB / Cloud SQL / MongoDB / SQLite / Redis / ...        │
│  接入：一个 toolbox 进程 + 一个 tools.yaml 配置文件搞定所有数据库    │
│  优势：Google 官方维护、连接池管理、IAM 认证、OpenTelemetry 可观测性 │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  类型 B：官方 MCP Registry（非数据库类数据源）                       │
│                                                                    │
│  来源：registry.modelcontextprotocol.io                            │
│  覆盖：文件系统 / HTTP Fetch / GitHub / Slack / Google Drive /     │
│        自定义 REST API 等                                          │
│  接入：通过 mcp_registry.yaml 配置，运行时动态加载                   │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│  类型 C：GraphXR 自有 MCP Server（本仓库唯一自实现）                 │
│                                                                    │
│  仅实现一个：graphxr_mcp_server                                     │
│  职责：将统一图语义结构推送到 GraphXR 可视化                         │
└────────────────────────────────────────────────────────────────────┘
```

### 3.2 googleapis/genai-toolbox 工作原理

`genai-toolbox` 是一个独立运行的 Go 二进制服务，通过 `tools.yaml` 声明数据库连接和工具定义，对外暴露标准 MCP 接口（SSE 或 STDIO）：

```
tools.yaml（声明数据库连接 + 工具定义）
       │
       ▼
  genai-toolbox 进程（Google 官方二进制）
       │  暴露标准 MCP 接口（SSE / STDIO）
       ▼
  MCP Client Hub
       │  工具自动聚合到 Agent 可用工具列表
       ▼
  GraphXR AI Agent
```

**一个 genai-toolbox 进程可同时管理多个数据库**，无需为每个数据库单独启动进程。

---

## 4. 整体架构

```
┌──────────────────────────────────────────────────────────────────────┐
│            数据库层（由 googleapis/genai-toolbox 统一管理）            │
│                                                                      │
│  Spanner  │  Neo4j  │  PostgreSQL  │  MySQL  │  BigQuery  │  ...    │
└──────────────────────┬───────────────────────────────────────────────┘
                       │  tools.yaml 配置
┌──────────────────────▼───────────────────────────────────────────────┐
│          googleapis/genai-toolbox（Google 官方 MCP Toolbox）          │
│                                                                      │
│  • 统一管理所有数据库连接（连接池 + IAM 认证 + 加密传输）               │
│  • 将数据库操作封装为标准 MCP Tools                                   │
│  • 支持 SSE / STDIO 传输，直接被 MCP Client 消费                      │
│  • 内置 OpenTelemetry 可观测性、审计日志                              │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────────┐
│          非数据库数据源（via 官方 MCP Registry）                        │
│                                                                      │
│  filesystem-mcp  │  fetch-mcp  │  github-mcp  │  gdrive-mcp  │ ... │
│  （通过 mcp_registry.yaml 动态加载）                                  │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────────┐
│                   MCP Client Hub（动态连接管理器）                      │
│                                                                      │
│  • 连接 genai-toolbox（SSE）+ 各 Registry MCP Server（STDIO/SSE）    │
│  • 工具列表动态聚合，实时暴露给 Agent                                  │
│  • 支持热加载，健康检查与自动重连                                      │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────────┐
│                   统一图语义层（Graph Schema）                          │
│                                                                      │
│  { nodes: [{ id, category, properties }],                            │
│    edges: [{ id, source, target, relationship, properties }] }       │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────────┐
│                    GraphXR AI Agent                                  │
│                                                                      │
│  • LLM（GPT-4o / Claude）驱动推理与工具路由                            │
│  • 调用 Data Transformer 转换为统一图结构                              │
│  • 调用 GraphXR MCP Server 推送可视化                                 │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────────┐
│              GraphXR MCP Server（本仓库唯一自实现）                     │
│  push_graph / add_nodes / add_edges / get_graph_state / clear_graph  │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
              ┌────────▼────────┐
              │    GraphXR UI   │
              │   可视化展示     │
              └─────────────────┘
```

---

## 5. googleapis/genai-toolbox 详解

### 5.1 支持的数据库（截至 2025）

| 类型 | 数据库 |
|---|---|
| Google Cloud 原生 | Cloud Spanner、BigQuery、AlloyDB、Cloud SQL (PostgreSQL/MySQL)、Bigtable |
| 关系型 | PostgreSQL、MySQL、SQLite、SQL Server、CockroachDB |
| 图数据库 | **Neo4j**、Dgraph |
| NoSQL | MongoDB、Cassandra、Redis、Valkey、Couchbase、ClickHouse |
| 其他 | Cloud Healthcare API、HTTP API |

### 5.2 tools.yaml 配置示例

```yaml
# config/tools.yaml —— 数据库数据源统一配置
sources:
  # Neo4j 图数据库
  neo4j:
    kind: neo4j
    uri: "${NEO4J_URI}"
    user: "${NEO4J_USER}"
    password: "${NEO4J_PASSWORD}"

  # Google Spanner
  spanner:
    kind: spanner
    project: "${GCP_PROJECT}"
    instance: "${SPANNER_INSTANCE}"
    database: "${SPANNER_DATABASE}"

  # PostgreSQL（兼容 AlloyDB / Cloud SQL）
  postgres:
    kind: cloudsql-postgres
    project: "${GCP_PROJECT}"
    region: "us-central1"
    instance: "${CLOUDSQL_INSTANCE}"
    database: "${PG_DATABASE}"
    user: "${PG_USER}"
    password: "${PG_PASSWORD}"

  # MySQL
  mysql:
    kind: cloudsql-mysql
    project: "${GCP_PROJECT}"
    region: "us-central1"
    instance: "${MYSQL_INSTANCE}"
    database: "${MYSQL_DATABASE}"
    user: "${MYSQL_USER}"
    password: "${MYSQL_PASSWORD}"

  # BigQuery
  bigquery:
    kind: bigquery
    project: "${GCP_PROJECT}"
    dataset: "${BQ_DATASET}"

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

  pg-query:
    kind: postgres-sql
    source: postgres
    description: "执行 SQL 查询 PostgreSQL 数据库"
    statement: "${sql_query}"
```

### 5.3 启动方式

```bash
# 方式一：直接下载二进制运行
curl -O https://storage.googleapis.com/genai-toolbox/v0.x.x/linux/amd64/toolbox
chmod +x toolbox
./toolbox --tools-file config/tools.yaml --port 5000

# 方式二：Docker 运行
docker run -p 5000:5000 \
  -v $(pwd)/config:/config \
  --env-file .env \
  gcr.io/cloud-toolbox/genai-toolbox:latest \
  --tools-file /config/tools.yaml
```

启动后，toolbox 对外暴露 SSE MCP 接口：`http://localhost:5000/sse`

---

## 6. mcp_registry.yaml（非数据库数据源配置）

```yaml
# config/mcp_registry.yaml —— 非数据库类 MCP Server 动态配置
mcp_servers:
  - name: filesystem
    source: registry
    registry_id: "modelcontextprotocol/servers/filesystem"
    transport: stdio
    args: ["${DATA_DIR}"].

  - name: fetch
    source: registry
    registry_id: "modelcontextprotocol/servers/fetch"
    transport: stdio

  - name: github
    source: registry
    registry_id: "modelcontextprotocol/servers/github"
    transport: stdio
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"

  # 新增非数据库源：在此追加即可
```

---

## 7. 工程目录结构

```
graphxr-mcp-hub/
├── docs/
│   └── project.md                        # 本文档
├── mcp_servers/
│   ├── __init__.py
│   └── graphxr_mcp_server.py             # ⭐ 唯一自实现的 MCP Server
├── mcp_client/
│   ├── __init__.py
│   ├── hub.py                            # MCP Client Hub（动态连接管理器）
│   ├── registry_resolver.py              # 查询官方 MCP Registry API
│   └── transport/
│       ├── stdio_transport.py
│       └── sse_transport.py
├── semantic_layer/
│   ├── __init__.py
│   ├── graph_schema.py
│   └── validators.py
├── agent/
│   ├── __init__.py
│   ├── graphxr_agent.py
│   └── data_transformer.py
├── config/
│   ├── tools.yaml                        # ⭐ genai-toolbox 数据库配置
│   └── mcp_registry.yaml                 # ⭐ 非数据库 MCP Server 配置
├── data/
│   ├── sample.csv
│   └── sample.json
├── tests/
│   ├── test_mcp_hub.py
│   ├── test_graphxr_mcp.py
│   ├── test_agent.py
│   └── test_transformer.py
├── docker-compose.yml
├── .env.example
├── requirements.txt
└── README.md
```

---

## 8. 技术选型

| 类别 | 选型 | 说明 |
|---|---|---|
| Agent 框架 | LangChain / LangGraph | 成熟的工具路由与多步推理支持 |
| MCP 协议 SDK | `mcp[cli]` (Python) | Anthropic 官方 Python MCP SDK |
| **数据库 MCP** | **googleapis/genai-toolbox** | **Google 官方，一个 Toolbox 覆盖所有数据库** |
| 非数据库 MCP | MCP Registry 社区 Server | filesystem、fetch、github 等 |
| LLM | GPT-4o / Claude 3.5 Sonnet | 支持工具调用（Function Calling） |
| 数据验证 | Pydantic v2 | 统一图语义层数据校验 |
| 容器化 | Docker + Docker Compose | 启动 genai-toolbox + graphxr-mcp-server |
| 测试框架 | pytest + pytest-asyncio | 异步 MCP 工具单元测试 |

---

## 9. 两套数据库接入方案对比

| 维度 | googleapis/genai-toolbox | MCP Registry 社区 Server |
|---|---|---|
| 维护方 | **Google 官方** | 社区/第三方 |
| 覆盖数据库 | **20+ 种，一次配置全覆盖** | 各库独立 Server，需分别配置 |
| 部署复杂度 | **低（单进程，单配置文件）** | 中（每个 DB 一个进程） |
| Google Cloud 集成 | **原生（IAM、VPC、审计日志）** | 无 |
| 可观测性 | **内置 OpenTelemetry** | 视各 Server 实现而定 |
| Spanner 支持 | **原生一流支持** | 社区实现，质量参差 |
| Neo4j 支持 | ✅ 官方支持 | ✅ 社区官方 Server |
| 适用场景 | **GCP 项目 / 多数据库场景** | 非 GCP 数据库 / 特定数据库 |

**建议策略：**
- 数据库类 → 优先用 `genai-toolbox`（特别是 Spanner、BigQuery、Cloud SQL、Neo4j）
- 非数据库类 → 用 MCP Registry 社区 Server（文件、HTTP、GitHub 等）
- 两者可同时运行，通过 MCP Client Hub 统一聚合

---

## 10. 数据流示例

以用户提问 **"把 CSV 里的用户和 Neo4j 里的关系合并，展示到 GraphXR"** 为例：

```
用户输入
   │
   ▼
GraphXR Agent（LLM 推理）
   │
   ├─► MCP Client Hub 查询可用工具列表
   │     → genai-toolbox:  neo4j-query, spanner-query, pg-query ...
   │     → filesystem-mcp: read_file, list_dir
   │     → graphxr-mcp:    push_graph, add_nodes ...
   │
   ├─► 调用 filesystem-mcp.read_file("sample.csv")
   ├─► 调用 genai-toolbox/neo4j-query(cypher)
   │
   ▼
Data Transformer
   ├─► CSV 行 → GraphNode（category="User"）
   ├─► Neo4j 关系 → GraphEdge（relationship="KNOWS"）
   └─► 合并为统一 GraphData 结构
   │
   ▼
graphxr_mcp_server.push_graph(GraphData)
   │
   ▼
GraphXR UI 实时展示 ✅
```

---

## 11. 快速启动

```bash
# 1. 克隆仓库
git clone https://github.com/Kineviz/graphxr-mcp-hub.git
cd graphxr-mcp-hub

# 2. 配置环境变量
cp .env.example .env

# 3. 配置数据库数据源
vim config/tools.yaml

# 4. 配置非数据库数据源
vim config/mcp_registry.yaml

# 5. 安装 Python 依赖
pip install -r requirements.txt

# 6. 一键启动（genai-toolbox + GraphXR MCP Server）
docker-compose up -d

# 7. 运行 Agent
python agent/graphxr_agent.py
```

---

## 12. 扩展性设计

### 新增数据库数据源（仅改 tools.yaml）

```yaml
sources:
  redis:
    kind: redis
    host: "${REDIS_HOST}"
    port: 6379

tools:
  redis-get:
    kind: redis-get
    source: redis
    description: "按 Key 查询 Redis 数据"
    key: "${key}"
```

### 新增非数据库数据源（仅改 mcp_registry.yaml）

```yaml
- name: slack
  source: registry
  registry_id: "modelcontextprotocol/servers/slack"
  transport: stdio
  env:
    SLACK_BOT_TOKEN: "${SLACK_BOT_TOKEN}"
```

**两种情况均无需修改任何 Python 代码。**

---

## 13. 后续规划

- [ ] genai-toolbox 多实例支持（按业务域隔离）
- [ ] MCP Server 健康检查与自动重连
- [ ] 支持实时流数据源（Kafka / WebSocket MCP）
- [ ] 增加数据血缘追踪（Data Lineage）
- [ ] 支持多 Agent 协作（Multi-Agent）模式
- [ ] GraphXR 双向同步（从 GraphXR 图操作反向触发 Agent）
- [ ] Web UI 管理界面（可视化配置 tools.yaml + mcp_registry.yaml）
- [ ] 支持更多 LLM 后端（本地模型 Ollama 等）

---

## 参考资料

- [googleapis/genai-toolbox GitHub](https://github.com/googleapis/genai-toolbox)
- [MCP Toolbox for Databases - Google Cloud Blog](https://cloud.google.com/blog/products/ai-machine-learning/mcp-toolbox-for-databases-now-supports-model-context-protocol)
- [官方 MCP Registry](https://registry.modelcontextprotocol.io)
- [GraphXR API Reference](https://graphxr.dev/docs/graphxr-api/reference)

---

*文档版本：v0.3.0 | 更新日期：2026-03-24 | 维护团队：Kineviz*