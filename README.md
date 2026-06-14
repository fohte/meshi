# meshi

@fohte's personal meal management chat service.

`meshi` is an MCP server that exposes intent-level tools (record / query / recommend / profile) to upstream agents and runs an internal LLM tool-use loop against Postgres.

## Development

### Prerequisites

- Node.js (LTS, see `.mise.toml`)
- pnpm (via Corepack or mise)
- Docker (for local Postgres)

### Local Postgres

Start a local Postgres instance with the bundled compose file:

```sh
pnpm db:up
```

This boots Postgres on `127.0.0.1:5432` with database `meshi` and user `meshi` / password `meshi`. Stop it with `pnpm db:down`.

### Environment variables

The server fails fast on missing required env at startup. Set the following before running:

| Name                          | Description                                                      |
| ----------------------------- | ---------------------------------------------------------------- |
| `OPENCODE_API_KEY`            | OpenCode Go API key (text + vision LLM)                          |
| `MESHI_LLM_MODEL`             | Default text LLM model id                                        |
| `MESHI_LLM_VISION_MODEL`      | Vision LLM model id (must support tool use)                      |
| `MESHI_LLM_LIGHTWEIGHT_MODEL` | Cheaper text LLM for lightweight prompts                         |
| `MESHI_LLM_MAX_TURNS`         | Internal tool-use loop cap (optional, defaults to `12`)          |
| `DATABASE_URL`                | Postgres connection string (verified with `SELECT 1` at startup) |
| `WEB_SEARCH_API_KEY`          | Web search API key                                               |
| `MCP_LISTEN_ADDR`             | MCP server listen address, e.g. `0.0.0.0:8080`                   |

Example `.env` for local development:

```sh
OPENCODE_API_KEY=dev
MESHI_LLM_MODEL=...
MESHI_LLM_VISION_MODEL=...
MESHI_LLM_LIGHTWEIGHT_MODEL=...
DATABASE_URL=postgres://meshi:meshi@127.0.0.1:5432/meshi
WEB_SEARCH_API_KEY=dev
MCP_LISTEN_ADDR=0.0.0.0:8080
```

### Run

```sh
pnpm start    # one-shot
pnpm dev      # tsx watch
```

The MCP endpoint is served at `POST /mcp`; `GET /health` reports DB connectivity.

### Test / lint

```sh
pnpm test
pnpm lint
```
