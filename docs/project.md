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

### 3.2 按需加载策略（核心设计）

系统在启动时根据配置文件**按需加载**数据源，三层加载逻辑如下：

```
启动时读取 config/hub_config.yaml
           │
           ├─► 检查 toolbox.enabled=true？
           │     是 → 启动 genai-toolbox 进程，连接 SSE
           │             仅加载 tools.yaml 中声明的数据库
           │     否 → 跳过（不启动任何数据库连接）
           │
           ├─► 遍历 mcp_registry.yaml 中每条记录
           │     enabled=true  → 动态启动/连接该 MCP Server
           │     enabled=false → 跳过，不占用任何资源
           │
           └─► graphxr_mcp_server（始终启动，核心依赖）
```

**效果：** 本地开发只启动 filesystem + sqlite；生产环境才启动 Spanner + Neo4j + BigQuery，完全按需，互不干扰。

### 3.3 genai-toolbox 支持范围与局限

| 数据库 | genai-toolbox 支持 | 替代方案 |
|---|---|---|
| Cloud Spanner | ✅ 原生一流 | — |
| BigQuery | ✅ 原生 | — |
| AlloyDB / Cloud SQL | ✅ 原生 | — |
| PostgreSQL（自托管） | ✅ 支持 | — |
| MySQL（自托管） | ✅ 支持 | — |
| Neo4j | ✅ 支持 | MCP Registry: neo4j/neo4j-mcp-server |
| SQLite | ✅ 支持 | — |
| MongoDB | ✅ 支持 | MCP Registry: mongodb-mcp |
| Redis / Valkey | ✅ 支持 | — |
| Cassandra / ClickHouse | ✅ 支持 | — |
| **Oracle** | ❌ 不支持 | MCP Registry 社区 Server |
| **DynamoDB (AWS)** | ❌ 不支持 | MCP Registry 社区 Server |
| **Firestore** | ❌ 不支持 | MCP Registry 社区 Server |
| **向量数据库（Pinecone/Milvus/Qdrant）** | ❌ 不支持 | MCP Registry 社区 Server |
| **DB2 / Teradata / Sybase** | ❌ 不支持 | 自��实现 MCP Server |

> **结论**：genai-toolbox 不支持的数据库，自动降级为从 MCP Registry 按需加载对应社区 Server，两套机制无缝互补，不留空白。

---

## 4. 整体架构

```
┌──────────────────────────────────────────────────────────────────────┐
│            数据库层（由 googleapis/genai-toolbox 统一管理）            │
│                                                                      │
│  Spanner  │  Neo4j  │  PostgreSQL  │  MySQL  │  BigQuery  │  ...    │
└──────────────────────┬───────────────────────────────────────────────┘
                       │  tools.yaml 配置（按需声明）
┌──────────────────────▼───────────────────────────────────────────────┐
│          googleapis/genai-toolbox（Google 官方 MCP Toolbox）          │
│          按需加载：仅启动 tools.yaml 中声明的数据库连接               │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────────┐
│     genai-toolbox 不支持的数据库 + 非数据库数据源                      │
│     （via MCP Registry，按需动态加载）                                │
│                                                                      │
│  Oracle-mcp │ DynamoDB-mcp │ Pinecone-mcp │ filesystem-mcp │ ...    │
│  （通过 mcp_registry.yaml，enabled=true 才启动）                     │
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
│  { nodes: [{ id, category, properties }],                            │
│    edges: [{ id, source, target, relationship, properties }] }       │
└──────────────────────┬───────────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────────┐
│                    GraphXR AI Agent                                  │
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

### 5.2 tools.yaml 配置示例（按需声明，不需要的注释掉即可）

```yaml
# config/tools.yaml —— 数据库数据源统一配置（按需启用）
sources:
  # ✅ 按需启用：Neo4j 图数据库
  neo4j:
    kind: neo4j
    uri: "${NEO4J_URI}"
    user: "${NEO4J_USER}"
    password: "${NEO4J_PASSWORD}"

  # ✅ 按需启用：Google Spanner
  spanner:
    kind: spanner
    project: "${GCP_PROJECT}"
    instance: "${SPANNER_INSTANCE}"
    database: "${SPANNER_DATABASE}"

  # ✅ 按需启用：PostgreSQL（兼容 AlloyDB / Cloud SQL）
  # postgres:
  #   kind: cloudsql-postgres
  #   project: "${GCP_PROJECT}"
  #   region: "us-central1"
  #   instance: "${CLOUDSQL_INSTANCE}"
  #   database: "${PG_DATABASE}"
  #   user: "${PG_USER}"
  #   password: "${PG_PASSWORD}"

  # ✅ 按需启用：BigQuery
  # bigquery:
  #   kind: bigquery
  #   project: "${GCP_PROJECT}"
  #   dataset: "${BQ_DATASET}"



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

## 6. 按需加载配置文件体系

### 6.1 hub_config.yaml（总控配置）

```yaml
# config/hub_config.yaml —— 总控：决定哪些数据源被加载
toolbox:
  enabled: true                        # false = 完全不启动 genai-toolbox
  url: "http://localhost:5000/sse"
  tools_file: "config/tools.yaml"

# genai-toolbox 不支持的数据库 + 非数据库数据源
mcp_servers:

  # ── genai-toolbox 不支持的数据库 ──────────────────────
  - name: oracle
    enabled: false                     # 按需开启
    source: registry
    registry_id: "oracle/oracle-mcp-server"
    transport: stdio
    env:
      ORACLE_DSN: "${ORACLE_DSN}"

  - name: dynamodb
    enabled: false                     # 按需开启
    source: registry
    registry_id: "aws-dynamodb-mcp"
    transport: stdio
    env:
      AWS_REGION: "${AWS_REGION}"
      AWS_ACCESS_KEY_ID: "${AWS_ACCESS_KEY_ID}"
      AWS_SECRET_ACCESS_KEY: "${AWS_SECRET_ACCESS_KEY}"

  - name: pinecone
    enabled: false                     # 向量数据库，按需开启
    source: registry
    registry_id: "pinecone/mcp-server-pinecone"
    transport: stdio
    env:
      PINECONE_API_KEY: "${PINECONE_API_KEY}"

  - name: firestore
    enabled: false
    source: registry
    registry_id: "firestore-mcp"
    transport: stdio
    env:
      GCP_PROJECT: "${GCP_PROJECT}"

  # ── 非数据库数据源 ────────────────────────────────────
  - name: filesystem
    enabled: true                      # 本地文件，默认开启
    source: registry
    registry_id: "modelcontextprotocol/servers/filesystem"
    transport: stdio
    args: ["${DATA_DIR}"]

  - name: fetch
    enabled: true                      # HTTP API，默认开启
    source: registry
    registry_id: "modelcontextprotocol/servers/fetch"
    transport: stdio

  - name: github
    enabled: false                     # 按需开启
    source: registry
    registry_id: "modelcontextprotocol/servers/github"
    transport: stdio
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"
```

### 6.2 不同环境的推荐配置

| 环境 | 推荐开启的数据源 |
|---|---|
| **本地开发** | filesystem + fetch + sqlite（genai-toolbox 仅 sqlite） |
| **测试环境** | + PostgreSQL + Neo4j |
| **生产环境（GCP）** | + Spanner + BigQuery + AlloyDB |
| **混合云** | + Oracle（MCP Registry）+ DynamoDB（MCP Registry）|

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
│   ├── hub.py                            # MCP Client Hub（按需加载管理器）
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
│   ├── hub_config.yaml                   # ⭐ 总控：按需开启/关闭各数据源
│   └── tools.yaml                        # ⭐ genai-toolbox 数据库配置
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
| **数据库 MCP（主）** | **googleapis/genai-toolbox** | **Google 官方，按需加载，覆盖 20+ 数据库** |
| **数据库 MCP（补）** | MCP Registry 社区 Server | Oracle / DynamoDB / 向量库等 toolbox 不支持的 |
| 非数据库 MCP | MCP Registry 社区 Server | filesystem、fetch、github 等 |
| LLM | GPT-4o / Claude 3.5 Sonnet | 支持工具调用（Function Calling） |
| 数据验证 | Pydantic v2 | 统一图语义层数据校验 |
| 容器化 | Docker + Docker Compose | 启动 genai-toolbox + graphxr-mcp-server |
| 测试框架 | pytest + pytest-asyncio | 异步 MCP 工具单元测试 |

---

## 9. 接入决策树

遇到新数据源时，按以下决策树选择接入方式：

```
新增数据源需求
      │
      ▼
genai-toolbox 是否支持？
      │
   ┌──┴──┐
  是      否
  │        │
  ▼        ▼
修改     MCP Registry 是否有社区 Server？
tools.yaml    │
（1 分钟）  ┌──┴──┐
           是      否
           │        │
           ▼        ▼
     hub_config.yaml  自行实现 MCP Server
     中 enabled=true  （参考 graphxr_mcp_server.py）
     （1 分钟）        （1~2 天）
```

---

## 10. 数据流示例

以用户提问 **"把 CSV 里的用户和 Neo4j 里的关系合并，展示到 GraphXR"** 为例：

```
用户输入
   │
   ▼
GraphXR Agent（LLM 推理）
   │
   ├─► MCP Client Hub 查询可用工具列表（仅已启用的数据源）
   │     → genai-toolbox:  neo4j-query, spanner-query ...
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

# 3. 按需配置数据源（只改 hub_config.yaml 和 tools.yaml）
vim config/hub_config.yaml   # 开启/关闭各数据源
vim config/tools.yaml         # 配置 genai-toolbox 支持的数据库

# 4. 安装 Python 依赖
pip install -r requirements.txt

# 5. 一键启动
docker-compose up -d

# 6. 运行 Agent
python agent/graphxr_agent.py
```

---

## 12. 后续规划

- [ ] genai-toolbox 多实例支持（按业务域隔离）
- [ ] MCP Server 健康检查与自动重连
- [ ] 支持实时流数据源（Kafka / WebSocket MCP）
- [ ] 增加数据血缘追踪（Data Lineage）
- [ ] 支持多 Agent 协作（Multi-Agent）模式
- [ ] GraphXR 双向同步（从 GraphXR 图操作反向触发 Agent）
- [ ] Web UI 管理界面（可视化配置 hub_config.yaml + tools.yaml）
- [ ] 支持更多 LLM 后端（本地模型 Ollama 等）

---

## 参考资料

- [googleapis/genai-toolbox GitHub](https://github.com/googleapis/genai-toolbox)
- [MCP Toolbox for Databases - Google Cloud Blog](https://cloud.google.com/blog/products/ai-machine-learning/mcp-toolbox-for-databases-now-supports-model-context-protocol)
- [官方 MCP Registry](https://registry.modelcontextprotocol.io)
- [GraphXR API Reference](https://graphxr.dev/docs/graphxr-api/reference)

---

*文档版本：v0.4.0 | 更新日期：2026-03-24 | 维护团队：Kineviz*