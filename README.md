# meshi

@fohte's personal meal management chat service.

`meshi` exposes intent-level meal-record / query / recommend / profile capabilities to upstream agents over both an MCP server and an A2A server, both backed by the same LangGraph domain agent running against Postgres.

## Development

### Prerequisites

- Node.js (Current, see `.mise.toml`)
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

The compose file pins the locale Postgres is `initdb`'d with (`LC_COLLATE=C` / `LC_CTYPE=C.UTF-8`) to match production. `initdb` only runs against an empty data directory, so an existing `meshi-postgres` volume keeps whatever locale it was first created with — run `docker compose down -v` before `pnpm db:up` to pick up the current locale.

### Environment variables

The server fails fast on missing required env at startup. This table covers every env var this repo's own code reads directly, not just via `src/env.ts`. Observability (Sentry/OTel exporter) config is delegated wholesale to `@fohte/service-kit/observability` and follows that package's own env var contract, not `src/env.ts`'s — see its docs for those variable names.

| Name                                                 | Required                   | Description                                                                                                                                                       | Example                                                             |
| ---------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `MESHI_LLM_API_KEY`                                  | Required                   | API key for the endpoint `MESHI_LLM_BASE_URL` points at                                                                                                           | `dev`                                                               |
| `MESHI_LLM_MODEL`                                    | Required                   | LLM model id for the domain agent (must support tool use + vision)                                                                                                | `...`                                                               |
| `MESHI_LLM_BASE_URL`                                 | Optional                   | OpenAI-compatible endpoint the domain agent talks to; unset falls back to OpenCode Go (`https://opencode.ai/zen/go/v1`)                                           | `https://litellm.example.com/v1`                                    |
| `DATABASE_URL`                                       | Required                   | Postgres connection string (verified with `SELECT 1` at startup); also required to run `src/db/migrate.ts` directly                                               | `postgres://meshi:meshi@127.0.0.1:<port from docker compose>/meshi` |
| `WEB_SEARCH_API_KEY`                                 | Required                   | Web search API key                                                                                                                                                | `dev`                                                               |
| `MCP_LISTEN_ADDR`                                    | Required                   | MCP server listen address                                                                                                                                         | `0.0.0.0:8080`                                                      |
| `A2A_AGENT_URL`                                      | Required                   | Externally-reachable URL of the A2A JSON-RPC endpoint (`POST /a2a`), embedded in the Agent Card's `url` field                                                     | `http://localhost:8080/a2a`                                         |
| `A2A_BEARER_TOKEN`                                   | Optional                   | Bearer token that protects the A2A endpoint (agent card + JSON-RPC); unset disables auth                                                                          | `dev`                                                               |
| `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT` | Optional (default `false`) | Capture LLM prompt/completion content on GenAI spans (may contain PII); case-insensitive (`true`/`TRUE`/`True` all enable it, anything else is `false`)           | `true`                                                              |
| `NODE_ENV`                                           | Optional                   | Skips observability initialization when set to `test` (set automatically by Vitest); otherwise passed through to `@fohte/service-kit/observability`               | `production`                                                        |
| `TEST_DATABASE_URL`                                  | Optional (test-only)       | Local Postgres URL for DB-backed tests (`pnpm test`); those suites are skipped when unset. Must point at a local host — the test setup runs `DROP SCHEMA CASCADE` | `postgres://meshi:meshi@127.0.0.1:5432/meshi`                       |

### Run

```sh
pnpm build && pnpm start   # one-shot, from the built dist/
pnpm dev                   # tsx watch, no build step
```

Or run it in a container instead (source is bind-mounted, so it hot-reloads the same way):

```sh
MESHI_LLM_API_KEY=dev MESHI_LLM_MODEL=... WEB_SEARCH_API_KEY=dev A2A_AGENT_URL=http://localhost:8080/a2a \
  docker compose up app
```

It's published to a random host port; find it with `docker compose port app 8080`.

The MCP endpoint is served at `POST /mcp`; the A2A endpoint (agent card + JSON-RPC) is served at `GET /.well-known/agent-card.json` / `POST /a2a`; `GET /health` reports DB connectivity. `GET /api/meal-history` (`?from=YYYY-MM-DD&to=YYYY-MM-DD`, half-open, Asia/Tokyo calendar dates), `GET /api/days/:date` (a single Asia/Tokyo calendar day, with entries enriched by food name/per-item kcal/estimated flag for the day view, plus `skippedMealTypes` for that day), `GET /api/nutrient-definitions`, `GET /api/foods/search` (`?q=`, `?limit=`, fuzzy name match ranked by eating history), `GET /api/foods/suggestions` (`?limit=`, recently/frequently eaten foods), and `GET /api/foods/:id` serve read-only JSON for the web frontend. `GET /api/profile` serves the same, and `PATCH /api/profile` patches it (omitted fields keep their current value; `dailyTargets: null` clears it). `POST /api/meal-logs`, `PATCH /api/meal-logs/:id`, and `DELETE /api/meal-logs/:id` record/correct/remove a meal log entry for the web frontend's registration sheet; `PUT /api/meal-skips/:date/:mealType` and `DELETE /api/meal-skips/:date/:mealType` record/cancel a meal skip for that date and meal type; `POST /api/food-masters/from-composition` registers a `food_masters` row from a `food_compositions` candidate (`source: 'composition_table_estimate'`, `isEstimated: true`) when the sheet's search turns up no existing food_master.

The `nutrient_definitions` master is seeded automatically on startup after migrations (idempotent). The MEXT food composition table (`food_compositions` + `food_composition_nutrients`) is loaded separately via the CLI below — it is not bundled and must be pointed at a JSON dataset.

### Web frontend

`web/` is a Vite + React SPA (see `docs/web-frontend-page-design.md` for the page design). In production, the backend server builds it and serves the static output itself — no separate deploy step.

```sh
pnpm --filter web run dev        # Vite dev server, proxies /api to the backend on :8080
pnpm --filter web run build      # production build (web/dist), served by the backend in the runtime image
pnpm --filter web run storybook  # component storybook
```

### Seed / load

```sh
pnpm seed                                          # nutrient_definitions only
pnpm seed --food-composition path/to/dataset.json  # + MEXT composition tables
```

Dataset shape (JSON array): `[{ "code": "01088", "name": "...", "nutrients": { "energy_kcal": 156, "protein_g": 2.5, ... } }]`. Nutrient codes follow `<英名>_<単位>` (e.g. `protein_g`, `iron_mg`, `vitamin_a_µg`). Codes not in `nutrient_definitions` are rejected; pass extras via the programmatic API.

#### Food composition table (MEXT) → dataset JSON

The 日本食品標準成分表 is distributed as Excel by MEXT, not as this dataset JSON. `pnpm convert-food-composition` converts a CSV export of it:

1. Download the 一般成分表 (general components table) Excel from the [MEXT distribution page](https://www.mext.go.jp/a_menu/syokuhinseibun/mext_02093.html).
2. Open that sheet in any spreadsheet app — Excel, [Google Sheets](https://sheets.google.com) (File → Import), or macOS's bundled Numbers all work — and export/download it as **CSV UTF-8**. Watch out on Excel specifically: its plain "CSV" export on Japanese locales silently uses Shift_JIS, so pick the "CSV UTF-8" variant explicitly; Google Sheets and Numbers default to UTF-8. Keep it out of version control, e.g. under `data/` (gitignored — see below).
3. Check column detection before converting anything:
   ```sh
   pnpm convert-food-composition --csv data/mext-table1.csv --header-rows 3 --dump-header
   ```
   This prints each column's detected header text and, if matched, which nutrient code it resolved to, plus a summary of nutrient codes with no matching column ("unmatched") and codes that matched more than one column ("ambiguous"). Columns are matched by header text (e.g. "たんぱく質" vs "アミノ酸組成によるたんぱく質"), not fixed position, so a column matching the wrong thing shows up here rather than silently landing in the output. Adjust `--header-rows` (how many leading rows are the multi-row header) until the mapping looks right — the official table's header commonly spans 2-3 rows.
4. Convert:
   ```sh
   pnpm convert-food-composition --csv data/mext-table1.csv --header-rows 3 --out data/food-composition.json
   ```
   Values are handled as: `Tr` (trace) → `0`, `(2.5)` (estimated) → `2.5`, `-` (not measured) → the nutrient key is omitted for that food. Food codes are re-padded to 5 digits (Excel/CSV round-trips can drop the leading zero, e.g. `01088` → `1088`).
5. `pnpm seed --food-composition data/food-composition.json`.

Only the columns from the general-components table are mapped; 飽和脂肪酸 (a separate per-fatty-acid table) and ビタミン E (four tocopherol columns, no single total) are left unmatched — extend `NUTRIENT_MATCHERS` in `scripts/convert-food-composition.ts` if they're needed.

Citation: outputs derived from this dataset must credit "日本食品標準成分表(八訂)増補2023年" and note that the data has been edited/processed (加工) from the source, per the [政府標準利用規約(2.0 版)](https://www.mext.go.jp/b_menu/1351168.htm). Per [the same terms' content list](https://www.mext.go.jp/b_menu/1366610.htm), 日本食品標準成分表 is one of the datasets that may require notification/royalty payment for some uses (e.g. republishing it as a book) — the source Excel and any JSON generated from it must stay local (`data/` is gitignored) and must not be committed to this repository.

### LLM model selection policy

The domain agent talks to [OpenCode Go](https://opencode.ai/) (or whatever `MESHI_LLM_BASE_URL` points at) via an OpenAI-compatible Chat Completions endpoint and routes both text and vision input through the single `MESHI_LLM_MODEL`. Start on the cheapest model that plausibly fits the task, run the smoke scenarios, and only rank up via env when quality is insufficient (e.g. tool-call argument shape errors, vision misreads, divergent loops). Bumping the env value is the only knob — no code change is required.

### Test / lint

```sh
pnpm test
pnpm lint
```
