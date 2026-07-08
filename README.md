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

This boots Postgres with database `meshi` and user `meshi` / password `meshi`, published to a random host port to avoid clashing with other projects' Postgres instances. Find it with:

```sh
docker compose port postgres 5432
```

Stop it with `pnpm db:down`.

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

The `nutrient_definitions` master is seeded automatically on startup after migrations (idempotent). The MEXT food composition table (`food_compositions` + `food_composition_nutrients`) is loaded separately via the CLI below — it is not bundled and must be pointed at a JSON dataset.

#### Run via Docker Compose

Instead of `pnpm dev`, the app can run inside a container (source is bind-mounted, so it hot-reloads the same way):

```sh
OPENCODE_API_KEY=dev MESHI_LLM_MODEL=... MESHI_LLM_VISION_MODEL=... MESHI_LLM_LIGHTWEIGHT_MODEL=... WEB_SEARCH_API_KEY=dev \
  docker compose up app
```

It's published to a random host port; find it with `docker compose port app 8080`.

### Seed / load

```sh
pnpm seed                                          # nutrient_definitions only
pnpm seed --food-composition path/to/dataset.json  # + MEXT composition tables
```

Dataset shape (JSON array): `[{ "code": "01088", "name": "...", "nutrients": { "energy_kcal": 156, "protein_g": 2.5, ... } }]`. Nutrient codes follow `<英名>_<単位>` (e.g. `protein_g`, `iron_mg`, `vitamin_a_µg`). Codes not in `nutrient_definitions` are rejected; pass extras via the programmatic API.

Citation: outputs derived from this dataset must credit "日本食品標準成分表(八訂)増補2023年".

### LLM model selection policy

The LLM client talks to [OpenCode Go](https://opencode.ai/) via its OpenAI-compatible Chat Completions endpoint and routes every internal tool-use loop through `MESHI_LLM_MODEL` (text) / `MESHI_LLM_VISION_MODEL` (vision) / `MESHI_LLM_LIGHTWEIGHT_MODEL` (cheap pre-processing). Start each role on the cheapest model that plausibly fits the task, run the smoke scenarios, and only rank up via env when quality is insufficient (e.g. tool-call argument shape errors, vision misreads, divergent loops). Bumping the env value is the only knob — no code change is required.

### Test / lint

```sh
pnpm test
pnpm lint
```
