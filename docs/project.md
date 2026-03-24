# GraphXR MCP Hub — 项目方案文档

> 多数据源 × MCP 协议 × 统一图语义层 × GraphXR 可视化智能体平台

---

## 1. 项目背景

GraphXR 是 Kineviz 开发的知识图谱可视化平台。随着 AI Agent 能力的引入，业务上需要：

- 让 Agent 直接访问**多种异构数据源**（CSV、JSON、Neo4j、Google Spanner 等）
- 对数据进行**智能分析与推理**
- 将分析结果**自动展示到 GraphXR** 中进行可视化

本方案采用 **方案三：MCP + 统一图语义层** 架构，并在此基础上引入 **MCP 动态注册机制**，通过官方 MCP Registry 动态发现和加载第三方数据源 MCP Server，而非将其写死在代码中。

---

## 2. 三种方案对比

| 维度 | 方案一：Skills | 方案二：MCP | **方案三：MCP + 语义层 + 动态注册（推荐）** |
|---|---|---|---|
| 数据源扩展性 | 低，每个源写一个 Skill | 中，每个源写一个 MCP Server | **最高，配置即接入，无需写代码** |
| 跨源数据 Join | 困难，需 Agent 自行处理 | 较困难 | **自然，统一图结构** |
| GraphXR 自动展示 | 需单独适配 Skill | 需 GraphXR MCP 接口 | **天然兼容，统一推送** |
| Agent 推理能力 | 依赖 Skill 设计质量 | 较好 | **最强，LLM 理解图语义** |
| 维护成本 | 高（线性增长） | 中 | **低，第三方 MCP 社区维护** |
| 新数据源接入 | 写新 Skill | 写新 MCP Server | **改一行配置即可** |

---

## 3. 核心设计理念：动态 MCP 集成

### 3.1 两类 MCP Server 的职责划分

本项目将 MCP Server 分为两类，职责明确分离：

```
┌─────────────────────────────────────────────────────────┐
│  类型 A：第三方官方 MCP Server（动态接入，不在本仓库实现）  │
│                                                         │
│  来源：官方 MCP Registry（registry.modelcontextprotocol.io）│
│  示例：neo4j-mcp、postgresql-mcp、spanner-mcp、          │
│        filesystem-mcp、fetch-mcp 等                     │
│  接入方式：通过 mcp_registry.yaml 配置，运行时动态加载     │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  类型 B：GraphXR 自有 MCP Server（本仓库实现）            │
│                                                         │
│  仅实现一个：graphxr_mcp_server                          │
│  职责：将统一图语义结构推送到 GraphXR 可视化              │
│  这是整个系统唯一需要自己写的 MCP Server                  │
└─────────────────────────────────────────────────────────┘
```

### 3.2 动态注册机制原理

Agent 启动时，通过一个 **MCP Registry 配置文件**（`mcp_registry.yaml`）声明需要连接哪些外部 MCP Server，系统在运行时动态建立连接，无需重新编译或修改代码：

```yaml
# mcp_registry.yaml —— 动态数据源配置，改此文件即可增删数据源
mcp_servers:
  - name: neo4j
    source: registry          # 从官方 MCP Registry 拉取
    registry_id: "neo4j/neo4j-mcp-server"
    transport: stdio
    env:
      NEO4J_URI: "${NEO4J_URI}"
      NEO4J_USERNAME: "${NEO4J_USERNAME}"
      NEO4J_PASSWORD: "${NEO4J_PASSWORD}"

  - name: filesystem
    source: registry
    registry_id: "modelcontextprotocol/servers/filesystem"
    transport: stdio
    args: ["${DATA_DIR}"]

  - name: fetch
    source: registry
    registry_id: "modelcontextprotocol/servers/fetch"
    transport: stdio

  - name: postgresql
    source: registry
    registry_id: "crystaldba/postgres-mcp"
    transport: stdio
    env:
      DATABASE_URL: "${POSTGRES_URL}"

  - name: spanner
    source: url               # 也支持直接指定 SSE URL
    url: "http://spanner-mcp-server:8080/sse"

  # 新增数据源只需在此追加一条记录
  # - name: mysql
  #   source: registry
  #   registry_id: "benborla29/mcp-server-mysql"
  #   transport: stdio
  #   env:
  #     MYSQL_HOST: "${MYSQL_HOST}"

# GraphXR 自有 MCP Server（本地实现，固定存在）
graphxr_server:
  transport: stdio
  command: "python mcp_servers/graphxr_mcp_server.py"
```

---

## 4. 整体架构

```
┌──────────────────────────────────────────────────────────────────┐
│              官方 MCP Registry（动态发现层）                       │
│         registry.modelcontextprotocol.io/v0/servers              │
│                                                                  │
│  neo4j-mcp  │  filesystem-mcp  │  postgres-mcp  │  spanner-mcp  │
│  fetch-mcp  │  mysql-mcp       │  sqlite-mcp    │  ...更多       │
└──────────────────────┬───────────────────────────────────────────┘
                       │  运行时按 mcp_registry.yaml 动态加载
┌──────────────────────▼───────────────────────────────────────────┐
│                   MCP Client Hub（动态连接管理器）                  │
│                                                                  │
│  • 读取 mcp_registry.yaml，按需启动/连接 MCP Server               │
│  • 支持 STDIO / SSE 两种传输协议                                   │
│  • 工具列表动态聚合，实时暴露给 Agent                               │
│  • 新增数据源无需重启 Agent，热加载                                 │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│                   统一图语义层（Graph Schema）                      │
│                                                                  │
│  • 所有数据源输出统一规范为 GraphData 结构                          │
│  • { nodes: [{ id, category, properties }],                      │
│      edges: [{ id, source, target, relationship, properties }] } │
│  • Data Transformer 负责各源格式 → GraphData 的自动转换            │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│                    GraphXR AI Agent                              │
│                                                                  │
│  • LLM（GPT-4o / Claude）驱动推理与工具路由                        │
│  • 从 MCP Client Hub 获取所有可用工具列表                          │
│  • 调用 Data Transformer 转换为统一图结构                          │
│  • 调用 GraphXR MCP Server 推送可视化                             │
└──────────────────────┬───────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────────────┐
│              GraphXR MCP Server（本仓库唯一自实现）                 │
│                                                                  │
│  • 接收统一 GraphData 结构                                        │
│  • 调用 GraphXR API 推送节点和关系                                 │
│  • 支持查询当前图状态反馈给 Agent                                  │
└──────────────────────┬───────────────────────────────────────────┘
                       │
              ┌────────▼────────┐
              │    GraphXR UI   │
              │   可视化展示     │
              └─────────────────┘
```

---

## 5. 核心模块说明

### 5.1 MCP Client Hub（动态连接管理器）

这是本方案最核心的新增模块，负责：

| 功能 | 说明 |
|---|---|
| 配置解析 | 读取 `mcp_registry.yaml`，解析数据源列表 |
| 动态连接 | 按需通过 STDIO 或 SSE 连接各 MCP Server |
| 工具聚合 | 自动收集所有已连接 MCP Server 的工具列表 |
| 热加载 | 支持运行时新增/移除数据源，无需重启 |
| 健康检查 | 检测各 MCP Server 连接状态，自动重连 |

**关键流程：**

```
启动时：
  读取 mcp_registry.yaml
       │
       ├─► 对每个 source=registry 的条目：
       │     查询 registry.modelcontextprotocol.io API
       │     获取安装命令（npx / uvx / docker）
       │     本地启动进程，建立 STDIO 连接
       │
       └─► 对每个 source=url 的条目：
             直接建立 SSE 长连接

聚合所有已连接 Server 的 tools → 暴露给 Agent
```

### 5.2 GraphXR MCP Server（本仓库自实现）

**本仓库唯一需要自己编写的 MCP Server**，对外暴露以下工具：

| Tool | 参数 | 说明 |
|---|---|---|
| `push_graph` | `GraphData` | 批量推送节点+边到 GraphXR |
| `add_nodes` | `List[GraphNode]` | 增量添加节点 |
| `add_edges` | `List[GraphEdge]` | 增量添加边 |
| `get_graph_state` | — | 获取当前 GraphXR 画布状态 |
| `clear_graph` | — | 清空当前画布 |
| `set_layout` | `layout_type` | 设置图布局算法 |

### 5.3 统一图语义层（Graph Schema）

所有数据源输出统一规范为：

```json
{
  "nodes": [
    {
      "id": "string",
      "category": "string",
      "properties": { "key": "value" }
    }
  ],
  "edges": [
    {
      "id": "string",
      "source": "node_id",
      "target": "node_id",
      "relationship": "string",
      "properties": { "key": "value" }
    }
  ]
}
```

### 5.4 Data Transformer（自动格式转换）

负责将各数据源的原始数据映射为统一图语义结构：

| 数据源 | 转换规则 |
|---|---|
| CSV / 关系型数据库（Spanner、PostgreSQL） | 每行 → 节点，外键列 → 边 |
| JSON / REST API 响应 | 对象 → 节点，嵌套/引用关系 → 边 |
| Neo4j Cypher 结果 | 直接映射（天然图结构，零转换损耗） |
| 文件系统 | 文件 → 节点，目录层级 → 边 |

---

## 6. 工程目录结构

```
graphxr-mcp-hub/
├── docs/
│   └── project.md                      # 本文档
│
├── mcp_servers/
│   ├── __init__.py
│   └── graphxr_mcp_server.py           # ⭐ 唯一自实现的 MCP Server
│
├── mcp_client/
│   ├── __init__.py
│   ├── hub.py                          # MCP Client Hub（动态连接管理器）
│   ├── registry_resolver.py            # 查询官方 MCP Registry API
│   └── transport/
│       ├── stdio_transport.py          # STDIO 传输协议实现
│       └── sse_transport.py            # SSE 传输协议实现
│
├── semantic_layer/
│   ├── __init__.py
│   ├── graph_schema.py                 # 统一图数据结构定义（Pydantic Models）
│   └── validators.py                   # 图结构合法性校验
│
├── agent/
│   ├── __init__.py
│   ├── graphxr_agent.py                # 主 Agent（LLM + 动态工具路由）
│   └── data_transformer.py             # 多源数据 → GraphData 自动转换
│
├── config/
│   └── mcp_registry.yaml               # ⭐ 数据源动态配置（增删数据源改此文件）
│
├── data/
│   ├── sample.csv
│   └── sample.json
│
├── tests/
│   ├── test_mcp_hub.py
│   ├── test_graphxr_mcp.py
│   ├── test_agent.py
│   └── test_transformer.py
│
├── docker-compose.yml                  # 一键启动（仅启动 GraphXR MCP Server）
├── .env.example                        # 环境变量示例
├── requirements.txt
└── README.md
```

> **注意**：第三方数据源（Neo4j、PostgreSQL、Spanner 等）不在本仓库实现。这些功能由官方社区 MCP Server 提供，通过 `config/mcp_registry.yaml` 动态接入。

---

## 7. 技术选型

| 类别 | 选型 | 说明 |
|---|---|---|
| Agent 框架 | LangChain / LangGraph | 成熟的工具路由与多步推理支持 |
| MCP 协议 SDK | `mcp[cli]` (Python) | Anthropic 官方 Python MCP SDK |
| MCP Registry | `registry.modelcontextprotocol.io` | 官方 MCP Server 注册表，REST API 可查 |
| LLM | GPT-4o / Claude 3.5 Sonnet | 支持工具调用（Function Calling） |
| 第三方 MCP Servers | 社区官方维护 | neo4j-mcp、postgres-mcp、filesystem-mcp 等 |
| 数据验证 | Pydantic v2 | 统一图语义层数据校验 |
| 容器化 | Docker + Docker Compose | 仅启动 GraphXR MCP Server |
| 测试框架 | pytest + pytest-asyncio | 异步 MCP 工具单元测试 |

---

## 8. 常用官方 MCP Server 索引

以下为可直接通过 `mcp_registry.yaml` 动态接入的官方/社区 MCP Server：

| 数据源 | Registry ID | 传输方式 |
|---|---|---|
| Neo4j | `neo4j/neo4j-mcp-server` | STDIO |
| PostgreSQL | `crystaldba/postgres-mcp` | STDIO |
| MySQL | `benborla29/mcp-server-mysql` | STDIO |
| SQLite | `modelcontextprotocol/servers/sqlite` | STDIO |
| 文件系统 | `modelcontextprotocol/servers/filesystem` | STDIO |
| HTTP Fetch | `modelcontextprotocol/servers/fetch` | STDIO |
| Google Drive | `modelcontextprotocol/servers/gdrive` | STDIO |
| GitHub | `modelcontextprotocol/servers/github` | STDIO |
| Slack | `modelcontextprotocol/servers/slack` | STDIO |

> 完整列表见：[registry.modelcontextprotocol.io](https://registry.modelcontextprotocol.io)

---

## 9. 数据流示例

以用户提问 **"把 CSV 里的用户和 Neo4j 里的关系合并，展示到 GraphXR"** 为例：

```
用户输入
   │
   ▼
GraphXR Agent（LLM 推理）
   │
   ├─► MCP Client Hub 查询可用工具列表
   │     → filesystem-mcp: read_file, list_dir
   │     → neo4j-mcp: run_cypher, get_schema
   │     → graphxr-mcp: push_graph, add_nodes ...
   │
   ├─► 调用 filesystem-mcp.read_file(sample.csv)
   ├─► 调用 neo4j-mcp.run_cypher("MATCH (n)-[r]->(m) RETURN n,r,m")
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

## 10. 快速启动

```bash
# 1. 克隆仓库
git clone https://github.com/Kineviz/graphxr-mcp-hub.git
cd graphxr-mcp-hub

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 填入 OpenAI Key、Neo4j 连接信息、GraphXR API Key 等

# 3. 配置数据源（按需增删，无需写代码）
vim config/mcp_registry.yaml

# 4. 安装依赖
pip install -r requirements.txt

# 5. 启动 GraphXR MCP Server
docker-compose up -d

# 6. 运行 Agent（自动按配置动态加载所有 MCP Server）
python agent/graphxr_agent.py
```

---

## 11. 扩展性设计

### 新增数据源（仅需一步）

只需在 `config/mcp_registry.yaml` 追加一条记录：

```yaml
- name: mysql
  source: registry
  registry_id: "benborla29/mcp-server-mysql"
  transport: stdio
  env:
    MYSQL_HOST: "${MYSQL_HOST}"
    MYSQL_PORT: "3306"
    MYSQL_DATABASE: "${MYSQL_DB}"
```

**无需**：写新代码 / 修改 Agent / 修改语义层 / 重新部署

### 新增自定义数据源（社区暂无时）

若官方 Registry 暂无对应 MCP Server，仍可自己实现并通过 `source: local` 接入：

```yaml
- name: my_custom_db
  source: local
  command: "python custom_mcp_servers/my_custom_mcp.py"
  transport: stdio
```

---

## 12. 后续规划

- [ ] MCP Server 健康检查与自动重连
- [ ] 支持实时流数据源（Kafka / WebSocket MCP）
- [ ] 增加数据血缘追踪（Data Lineage）
- [ ] 支持多 Agent 协作（Multi-Agent）模式
- [ ] GraphXR 双向同步（从 GraphXR 图操作反向触发 Agent）
- [ ] Web UI 管理界面（可视化配置 mcp_registry.yaml）
- [ ] 支持更多 LLM 后端（本地模型 Ollama 等）
- [ ] MCP Server 缓存层（减少重复查询开销）

---

*文档版本：v0.2.0 | 更新日期：2026-03-24 | 维护团队：Kineviz*