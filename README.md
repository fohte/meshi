# meshi

@fohte's personal meal management chat service.

`meshi` is an MCP server that exposes intent-level tools (record / query / recommend / profile) to upstream agents and runs an internal LLM tool-use loop against Postgres.

## Development

### Prerequisites

- Node.js (LTS, see `.mise.toml`)
- pnpm (via Corepack or mise)
- Docker (for local Postgres, and optionally for running the app itself)

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

The server fails fast on missing required env at startup. This table covers every env var read anywhere in the codebase, not just via `src/env.ts` — see the "Environment variables" rule in `CLAUDE.md` for why that matters.

| Name                                                 | Required                   | Description                                                                                                                                           | Example                                                             |
| ---------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `OPENCODE_API_KEY`                                   | Required                   | OpenCode Go API key (text + vision LLM)                                                                                                               | `dev`                                                               |
| `MESHI_LLM_MODEL`                                    | Required                   | Default text LLM model id                                                                                                                             | `...`                                                               |
| `MESHI_LLM_VISION_MODEL`                             | Required                   | Vision LLM model id (must support tool use)                                                                                                           | `...`                                                               |
| `MESHI_LLM_LIGHTWEIGHT_MODEL`                        | Required                   | Cheaper text LLM for lightweight prompts                                                                                                              | `...`                                                               |
| `MESHI_LLM_MAX_TURNS`                                | Optional (default `12`)    | Internal tool-use loop cap                                                                                                                            | `12`                                                                |
| `DATABASE_URL`                                       | Required                   | Postgres connection string (verified with `SELECT 1` at startup)                                                                                      | `postgres://meshi:meshi@127.0.0.1:<port from docker compose>/meshi` |
| `WEB_SEARCH_API_KEY`                                 | Required                   | Web search API key                                                                                                                                    | `dev`                                                               |
| `MCP_LISTEN_ADDR`                                    | Required                   | MCP server listen address                                                                                                                             | `0.0.0.0:8080`                                                      |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | Optional (default `false`) | Capture LLM prompt/completion content on GenAI spans (may contain PII); read directly from `process.env` in `OpenCodeLlmClient`, not via `src/env.ts` | `true`                                                              |

### Run

```sh
pnpm start    # one-shot
pnpm dev      # tsx watch
```

Or run it in a container instead (source is bind-mounted, so it hot-reloads the same way):

```sh
OPENCODE_API_KEY=dev MESHI_LLM_MODEL=... MESHI_LLM_VISION_MODEL=... MESHI_LLM_LIGHTWEIGHT_MODEL=... WEB_SEARCH_API_KEY=dev \
  docker compose up app
```

It's published to a random host port; find it with `docker compose port app 8080`.

The MCP endpoint is served at `POST /mcp`; `GET /health` reports DB connectivity.

The `nutrient_definitions` master is seeded automatically on startup after migrations (idempotent). The MEXT food composition table (`food_compositions` + `food_composition_nutrients`) is loaded separately via the CLI below — it is not bundled and must be pointed at a JSON dataset.

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
