# GraphXR MCP Hub

> A unified MCP data hub for GraphXR — one-command launch, configure data sources through a Web UI.

Connect Neo4j, Google Spanner, BigQuery, PostgreSQL, CSV files and more into GraphXR and any MCP client (Claude Desktop, GraphXR Agent, Codex, etc.) through a single hub.

中文文档：[README.zh.md](./README.zh.md) | English documentation: [README.md](./README.md)

---

## Quick Start

### Prerequisites

- **Docker Desktop** (Windows / Mac) or **Docker Engine + Compose** (Linux)
- *(Optional)* If you need access to Google Cloud Spanner / BigQuery, run `gcloud auth application-default login` on the host first.

### One-command launch

You don't need to clone the whole repository — just download two files:

```bash
mkdir graphxr-mcp-hub && cd graphxr-mcp-hub

# Download docker-compose and the env template
curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/Kineviz/graphxr-mcp-hub/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/Kineviz/graphxr-mcp-hub/main/.env.example

# Start
docker compose up -d
```

Windows PowerShell:

```powershell
mkdir graphxr-mcp-hub; cd graphxr-mcp-hub
iwr -OutFile docker-compose.yml https://raw.githubusercontent.com/Kineviz/graphxr-mcp-hub/main/docker-compose.yml
iwr -OutFile .env              https://raw.githubusercontent.com/Kineviz/graphxr-mcp-hub/main/.env.example
docker compose up -d
```

Default endpoints:
- **http://localhost:8899/admin** — Web admin UI
- **http://localhost:8899/health** — Health check
- **http://localhost:5000** — genai-toolbox (database adapter layer)

### Verify the launch

```bash
curl http://localhost:8899/health
# → {"status":"ok","service":"graphxr-mcp-server",...}
```

Open **http://localhost:8899/admin** in your browser to enter the admin panel.

---

## Configure Data Sources via Web UI

All database connections are configured in the Admin UI — no need to edit config files by hand.

### 1. Sources page

Navigate to **http://localhost:8899/admin/sources/database**.

The top of the page shows the **GCP credential status**:
- ✅ Green — ADC credentials detected (host `gcloud` is authorized)
- ⚠️ Yellow — No credentials found; run `gcloud auth application-default login` on the host

### 2. Add a data source

Click **Add Source** and pick a database type from the template list:

![Add Source page](./docs/images/admin-add-source.png)

| Database | Required fields |
|---|---|
| **Neo4j** | URI, username, password |
| **Google Spanner** | GCP project ID, instance, database (credentials via ADC) |
| **BigQuery** | GCP project ID, region (credentials via ADC) |
| **PostgreSQL** | Host, port, database, username, password |
| **SQLite** | Database file path |

> **Connecting to a database on the host machine**: use `host.docker.internal` as the hostname (works out of the box on Windows / Mac; on Linux the provided `docker-compose.yml` already wires up `host-gateway`).

### 3. Done

Once saved, the tools are automatically registered into the MCP tool list, named as `{source}__{tool}` (e.g. `neo4j__execute_cypher`, `spanner__query_graph`).

Reconnect any MCP client and the new tools become available.

---

## Connect MCP Clients

All clients connect through the Hub's SSE endpoint:

```
http://localhost:8899/sse
```

### GraphXR Agent 2 (in-browser)

1. Open GraphXR and click the **Agent 2** panel at the top-right
2. Go to the **Settings** page
3. In the **MCP Servers** section click **Add Server**
4. Fill in:
   - **Name**: `graphxr-mcp-hub`
   - **Transport**: `SSE`
   - **URL**: `http://localhost:8899/sse`
5. After saving, the Agent automatically loads every tool exposed by the Hub (graph operations + your configured data sources)

![GraphXR Agent 2 settings](./docs/images/graphxr-agent2-setting.png)

### Claude Code (CLI)

```bash
claude mcp add graphxr-mcp-hub --transport sse http://localhost:8899/sse
```

List: `claude mcp list` · Remove: `claude mcp remove graphxr-mcp-hub`

### Claude Desktop

Edit `claude_desktop_config.json` (Windows: `%APPDATA%\Claude\`, macOS: `~/Library/Application Support/Claude/`):

```json
{
  "mcpServers": {
    "graphxr-mcp-hub": {
      "transport": "sse",
      "url": "http://localhost:8899/sse"
    }
  }
}
```

### Codex CLI

```bash
codex mcp add graphxr-mcp-hub --transport sse --url http://localhost:8899/sse
```

Or edit `~/.codex/config.toml`:

```toml
[mcp_servers.graphxr-mcp-hub]
transport = "sse"
url = "http://localhost:8899/sse"
```

### Gemini CLI

```bash
gemini mcp add graphxr-mcp-hub --transport sse http://localhost:8899/sse
```

Or edit `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "graphxr-mcp-hub": {
      "httpUrl": "http://localhost:8899/sse"
    }
  }
}
```

---

## Google Cloud Authorization (optional)

If you plan to use Spanner or BigQuery, share your host `gcloud` ADC credentials with the container.

### Steps

1. **Authorize on the host**:
   ```bash
   gcloud auth application-default login
   ```
2. **Make sure `CLOUDSDK_CONFIG` in `.env` points to your gcloud config directory**:
   - Windows: `C:/Users/<username>/AppData/Roaming/gcloud`
   - macOS / Linux: `~/.config/gcloud`
3. **Restart the container**:
   ```bash
   docker compose up -d --force-recreate
   ```
4. **Open the Sources tab** in the Admin UI. The credential banner should turn ✅ green and show the token expiration time.

> The Hub mounts the host `gcloud` directory into the container as read-only, so every ADC-based GCP SDK call just works.

---

## Common Operations

### Start / stop

```bash
docker compose up -d          # Start in background
docker compose down           # Stop and clean up
docker compose logs -f        # Tail logs
docker compose ps             # Container status
```

### Upgrade to the latest version

```bash
docker compose pull
docker compose up -d
```

### Change the port

Edit `.env`:

```env
GRAPHXR_MCP_PORT=9000
```

Then `docker compose up -d --force-recreate`.

---

## Admin UI Features

| Page | Purpose |
|---|---|
| **Dashboard** | Overall status, service health, data source overview |
| **Sources** | Manage data source connections (Neo4j / Spanner / BigQuery / PostgreSQL …) |
| **Sessions** | Live view of connected MCP clients |
| **Lineage** | Data lineage log — which client pushed what data, when |
| **Examples** | Prebuilt example prompts and invocation recipes |
| **Settings** | Port, log level, Kafka, Ollama and other advanced options |

---

## MCP Tools at a Glance

### Graph operations (for the GraphXR WebGL canvas)

| Tool | Description |
|---|---|
| `push_graph` | Replace the whole graph on the canvas |
| `add_nodes` / `add_edges` | Incrementally append nodes / edges |
| `update_node` | Update node properties |
| `clear_graph` | Clear the canvas |
| `get_graph_state` | Stats about the current graph |
| `get_nodes` / `get_edges` | Query current graph contents |
| `find_neighbors` | Find neighbors of a node |

### Data ingestion (built-in DuckDB: CSV / JSON / Parquet)

| Tool | Description |
|---|---|
| `ingest_file` | Load a local file; returns schema + sample rows |
| `query_data` | Run SQL, optionally pushing the result straight to GraphXR |
| `list_tables` | List already-loaded tables |

### External data source tools

Data sources added through the Admin UI automatically expose their tools with the naming pattern `{source}__{tool}`, for example:
- `neo4j__execute_cypher`
- `spanner__query_graph`
- `bigquery__execute_sql`

---

## FAQ

**Q: Port 8899 is already in use.**
Change `GRAPHXR_MCP_PORT` in `.env` and restart the container.

**Q: The container cannot reach Neo4j / PostgreSQL on the host.**
Use `host.docker.internal` as the hostname instead of `localhost`. Linux users must make sure the [docker-compose.yml](docker-compose.yml) has the `extra_hosts` mapping.

**Q: The Admin UI says "GCP credentials not found".**
- Run `gcloud auth application-default login` on the host
- Make sure `CLOUDSDK_CONFIG` in `.env` points to the correct path
- Restart with `docker compose up -d --force-recreate`

**Q: I want to wipe all data and start over.**
```bash
docker compose down -v
rm -rf data/
docker compose up -d
```

**Q: How do I inspect container errors?**
```bash
docker compose logs graphxr-mcp-server
docker compose logs genai-toolbox
```

---

## Data & Config Locations

| Location | Purpose |
|---|---|
| `.env` | Environment variables (port, GCP path, database defaults) |
| `config/tools.yaml` | Data source configuration (auto-maintained by the Admin UI; no manual editing required) |
| `config/hub_config.yaml` | Hub global configuration (logging, Kafka, Ollama toggle, …) |
| `data/` | Local data file mount; drop CSV / JSON / Parquet here |

---

## License & Support

- Project home: https://github.com/Kineviz/graphxr-mcp-hub
- Feedback & issues: GitHub Issues
- Maintainer: Kineviz
- License: MIT
