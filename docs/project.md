# GraphXR MCP Hub — 项目方案文档

> 多数据源 × MCP 协议 × 统一图语义层 × GraphXR 可视化智能体平台

---

## 1. 项目背景

GraphXR 是 Kineviz 开发的知识图谱可视化平台。随着 AI Agent 能力的引入，业务上需要：

- 让 Agent 直接访问**多种异构数据源**（CSV、JSON、Neo4j、Google Spanner 等）
- 对数据进行**智能分析与推理**
- 将分析结果**自动展示到 GraphXR** 中进行可视化

本方案采用 **方案三：MCP + 统一图语义层** 架构，是三种备选方案中扩展性最强、最适合长期演进的选择。

---

## 2. 三种方案对比

| 维度 | 方案一：Skills | 方案二：MCP | **方案三：MCP + 语义层（推荐）** |
|---|---|---|---|
| 数据源扩展性 | 低，每个源写一个 Skill | 中，每个源写一个 MCP Server | **高，接入语义层即可复用** |
| 跨源数据 Join | 困难，需 Agent 自行处理 | 较困难 | **自然，统一图结构** |
| GraphXR 自动展示 | 需单独适配 Skill | 需 GraphXR MCP 接口 | **天然兼容，统一推送** |
| Agent 推理能力 | 依赖 Skill 设计质量 | 较好 | **最强，LLM 理解图语义** |
| 社区工具成熟度 | 高 | 快速增长 | **新兴，最具长期潜力** |
| 维护成本 | 高（线性增长） | 中 | **低（统一语义层复用）** |

---

## 3. 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        数据源层                                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │   CSV    │ │   JSON   │ │  Neo4j   │ │  Google Spanner  │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────────┬─────────┘   │
└───────┼────────────┼────────────┼─────────────────┼─────────────┘
        │            │            │                 │
┌───────▼────────────▼────────────▼─────────────────▼─────────────┐
│                      MCP Server 层                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │
│  │ CSV MCP  │ │JSON MCP  │ │Neo4j MCP │ │  Spanner MCP     │   │
│  │ Server   │ │ Server   │ │ Server   │ │  Server          │   │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────────┬─────────┘   │
└───────┼────────────┼────────────┼─────────────────┼─────────────┘
        │            │            │                 │
┌───────▼────────────▼────────────▼─────────────────▼─────────────┐
│                   统一图语义层（Graph Schema）                     │
│                                                                  │
│   所有数据源的输出统一转换为：                                      │
│   { nodes: [{ id, category, properties }],                       │
│     edges: [{ id, source, target, relationship, properties }] }  │
│                                                                  │
└─────────────────────────┬────────────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────────────┐
│                   GraphXR AI Agent                               │
│                                                                  │
│   • LLM（GPT-4o / Claude）驱动推理                                │
│   • 自动路由到对应 MCP Server 获取数据                             │
│   • 调用 Data Transformer 转换为图结构                            │
│   • 通过 GraphXR MCP Server 推送可视化                            │
│                                                                  │
└─────────────────────────┬────────────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────────────┐
│                  GraphXR MCP Server                              │
│                                                                  │
│   • 接收统一图结构数据（nodes + edges）                            │
│   • 调用 GraphXR API 推送节点和关系                                │
│   • 支持查询当前图状态反馈给 Agent                                 │
│                                                                  │
└─────────────────────────┬────────────────────────────────────────┘
                          │
                 ┌────────▼────────┐
                 │    GraphXR UI   │
                 │   可视化展示     │
                 └─────────────────┘
```

---

## 4. 核心模块说明

### 4.1 MCP Server 层

每个数据源对应一个独立的 MCP Server，职责单一：

| MCP Server | 职责 | 主要工具（Tools） |
|---|---|---|
| `csv_mcp_server` | 读取并查询 CSV 文件 | `query_csv`, `list_columns`, `filter_rows` |
| `json_mcp_server` | 读取并查询 JSON 文件或 API | `query_json`, `get_by_path`, `search_keys` |
| `neo4j_mcp_server` | 执行 Cypher 查询 Neo4j | `run_cypher`, `get_schema`, `find_neighbors` |
| `spanner_mcp_server` | 执行 SQL 查询 Google Spanner | `run_sql`, `list_tables`, `describe_table` |
| `graphxr_mcp_server` | 与 GraphXR 交互 | `push_graph`, `get_graph_state`, `clear_graph`, `add_nodes`, `add_edges` |

### 4.2 统一图语义层（Graph Schema）

所有 MCP Server 返回的数据，在进入 Agent 处理前统一规范为以下结构：

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

这一层解决了多源数据结构差异问题，使得：
- **任何数据源**的输出都可以被 GraphXR 直接消费
- **Agent** 只需理解一种数据结构，降低推理复杂度
- **新数据源**接入只需实现到该结构的转换适配器

### 4.3 GraphXR AI Agent

Agent 是系统的核心调度者，基于 LLM 驱动，具备以下能力：

- **意图理解**：解析用户自然语言请求，判断需要访问哪些数据源
- **工具路由**：自动选择并调用对应 MCP Server 的 Tools
- **跨源关联**：将来自不同数据源的数据在语义层进行关联与合并
- **图结构生成**：通过 `data_transformer` 将分析结果转换为节点/边结构
- **可视化推送**：调用 `graphxr_mcp_server` 将图结构推送到 GraphXR 展示

### 4.4 Data Transformer

负责将各数据源的原始数据自动映射为统一图语义结构：

- CSV 行 → 节点，列关系 → 边
- JSON 对象 → 节点，嵌套关系 → 边
- Neo4j 查询结果 → 直接映射（天然图结构）
- Spanner 表行 → 节点，外键关系 → 边

---

## 5. 工程目录结构

```
graphxr-mcp-hub/
├── docs/
│   └── project.md                  # 本文档
├── mcp_servers/
│   ├── __init__.py
│   ├── csv_mcp_server.py            # CSV 数据源 MCP Server
│   ├── json_mcp_server.py           # JSON 数据源 MCP Server
│   ├── neo4j_mcp_server.py          # Neo4j MCP Server
│   ├── spanner_mcp_server.py        # Google Spanner MCP Server
│   └── graphxr_mcp_server.py        # GraphXR 推送/查询 MCP Server
├── semantic_layer/
│   ├── __init__.py
│   ├── graph_schema.py              # 统一图数据结构定义（Pydantic Models）
│   └── validators.py                # 图结构合法性校验
├── agent/
│   ├── __init__.py
│   ├── graphxr_agent.py             # 主 Agent（LLM + MCP 工具路由）
│   └── data_transformer.py          # 多源数据 → GraphXR 格式自动转换
├── data/
│   ├── sample.csv                   # 示例 CSV 数据
│   └── sample.json                  # 示例 JSON 数据
├── tests/
│   ├── test_csv_mcp.py
│   ├── test_neo4j_mcp.py
│   ├── test_agent.py
│   └── test_transformer.py
├── docker-compose.yml               # 一键启动所有 MCP Server + Neo4j
├── .env.example                     # 环境变量示例
├── requirements.txt                 # Python 依赖
└── README.md                        # 快速上手文档
```

---

## 6. 技选型

| 类别 | 选型 | 说明 |
|---|---|---|
| Agent 框架 | LangChain / LangGraph | 成熟的工具路由与多步推理支持 |
| MCP 协议 SDK | `mcp[cli]` (Python) | Anthropic 官方 Python MCP SDK |
| LLM | GPT-4o / Claude 3.5 Sonnet | 支持工具调用（Function Calling） |
| 图数据库 | Neo4j 5.x | 原生图结构，Cypher 查询 |
| 分布式关系库 | Google Spanner | 全球分布式 SQL |
| 数据验证 | Pydantic v2 | 统一图语义层数据校验 |
| 容器化 | Docker + Docker Compose | 本地一键启动所有服务 |
| 测试框架 | pytest + pytest-asyncio | 异步 MCP 工具单元测试 |

---

## 7. 数据流示例

以用户提问 **"把 CSV 里的用户和 Neo4j 里的关系合并，展示到 GraphXR"** 为例：

```
用户输入
   │
   ▼
GraphXR Agent（LLM 推理）
   ├─► 调用 csv_mcp_server.query_csv()       → 获取用户数据（表格）
   ├─► 调用 neo4j_mcp_server.run_cypher()    → 获取关系数据（图）
   │
   ▼
Data Transformer
   ├─► CSV 行 → GraphNode（category="User"）
   ├─► Neo4j 关系 → GraphEdge（relationship="KNOWS"）
   └─► 合并为统一 GraphData 结构
   │
   ▼
graphxr_mcp_server.push_graph()
   │
   ▼
GraphXR UI 实时展示 ✅
```

---

## 8. 快速启动（规划）

```bash
# 1. 克隆仓库
git clone https://github.com/Kineviz/graphxr-mcp-hub.git
cd graphxr-mcp-hub

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 填入 OpenAI Key、Neo4j 连接信息、GraphXR API Key 等

# 3. 启动所有服务（Neo4j + MCP Servers）
docker-compose up -d

# 4. 安装 Python 依赖
pip install -r requirements.txt

# 5. 运行 Agent
python agent/graphxr_agent.py
```

---

## 9. 扩展性设计

新增数据源只需三步：

1. **实现新的 MCP Server**（参考 `csv_mcp_server.py` 模板）
2. **实现对应的 Transformer**（在 `data_transformer.py` 中增加一个转换函数）
3. **注册到 Agent 工具列表**（在 `graphxr_agent.py` 中添加工具引用）

无需修改语义层、GraphXR MCP Server 或 Agent 核心逻辑。

---

## 10. 后续规划

- [ ] 支持实时流数据源（Kafka / WebSocket）
- [ ] 增加数据血缘追踪（Data Lineage）
- [ ] 支持多 Agent 协作（Multi-Agent）模式
- [ ] GraphXR 双向同步（从 GraphXR 图操作反向触发 Agent）
- [ ] Web UI 管理界面（数据源配置 + Agent 对话）
- [ ] 支持更多 LLM 后端（本地模型 Ollama 等）

---

*文档版本：v0.1.0 | 创建日期：2026-03-24 | 维护团队：Kineviz*