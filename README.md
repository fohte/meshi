# meshi

@fohte's personal meal management service, with an MCP server and a REST API for its web frontend.

The MCP server exposes meal-history queries, profile management, origin-aware food search, reusable meal-set search and registration, food registration (`register_food` and `register_food_without_nutrition`), nutrition completion for foods with unknown values, food registration from the composition table, food master merging, resolved meal logging, meal-log updates and deletions, meal-skip recording and cancellation, stock management with per-lot best-before and eat-by date updates, delivery lookup including received and fully consumed deliveries, stock status and warnings, and recommendation context. The REST API under `/api` serves the web frontend; its endpoints are listed below.

## Development

### Prerequisites

- Node.js (Current, see `.mise.toml`)
- pnpm (via Corepack or mise)
- Docker (for local Postgres, and optionally for running the app itself)

Run `scripts/bootstrap` once to install the workspace dependencies and git hooks.

### Local Postgres

Start a local Postgres instance and create the development and test databases:

```sh
mise run db:up
```

This starts Postgres with user `meshi` / password `meshi`, published to a random host port to avoid clashing with other projects' Postgres instances. It creates `meshi_server_dev`, `meshi_server_test`, and `meshi_server_migration_test`. Find the port with:

```sh
docker compose port db 5432
```

Stop the services with `docker compose down`; the named volumes remain.

`compose.override.yaml` sets the locale used by `initdb` (`LC_COLLATE=C` / `LC_CTYPE=C.UTF-8`) to match production. The new PostgreSQL 18 service uses its own volume; the previous PostgreSQL 17 volume remains untouched and is not mounted by this configuration. Package-scoped databases use the `meshi_server_*` prefix. Existing `meshi_dev` and `meshi_test` databases remain in the volume; dump and restore into the new database to carry data forward:

```sh
legacy_compose=$(mktemp /tmp/meshi-postgres17-compose.XXXXXX)
dump=$(mktemp /tmp/meshi-postgres17-dump.XXXXXX)
compose_migration_revision=$(git log -S'postgres:17' --format='%H' -1 -- docker-compose.yml)
legacy_compose_revision="${compose_migration_revision}^"
git show "${legacy_compose_revision}:docker-compose.yml" > "$legacy_compose"
docker compose --project-directory "$PWD" --project-name meshi \
  -f "$legacy_compose" up -d postgres
docker compose --project-directory "$PWD" --project-name meshi \
  -f "$legacy_compose" exec -T postgres \
  pg_dump -U meshi -d meshi -Fc > "$dump"
mise run db:up
docker compose exec -T db pg_restore -U meshi --no-owner -d meshi_server_dev - < "$dump"
```

### Environment variables

The server fails fast on missing required env at startup. This table covers every env var this repo's own code reads directly, not just via `server/src/env.ts`. Observability (Sentry/OTel exporter) config is delegated wholesale to `@fohte/service-kit/observability` and follows that package's own env var contract, not `server/src/env.ts`'s — see its docs for those variable names.

| Name                          | Required             | Description                                                                                                                                                                                                          | Example                                                                                   |
| ----------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | Required             | Postgres connection string (verified with `SELECT 1` at startup); also required to run `server/src/db/migrate.ts` directly                                                                                           | `postgres://meshi:meshi@127.0.0.1:<port from docker compose>/meshi_server_dev`            |
| `MCP_LISTEN_ADDR`             | Required             | MCP server listen address                                                                                                                                                                                            | `0.0.0.0:8080`                                                                            |
| `R2_ACCOUNT_ID`               | Required             | Cloudflare account ID used to construct the R2 S3 API endpoint                                                                                                                                                       | `00000000000000000000000000000000`                                                        |
| `R2_BUCKET_NAME`              | Required             | R2 bucket for meal photos; keep public access disabled because meshi serves the images                                                                                                                               | `sample-meal-photos`                                                                      |
| `R2_ACCESS_KEY_ID`            | Required             | Access key ID with object read, write, and delete permissions on the bucket                                                                                                                                          | `sample-access-key`                                                                       |
| `R2_SECRET_ACCESS_KEY`        | Required             | Secret access key for the R2 bucket                                                                                                                                                                                  | `sample-secret-key`                                                                       |
| `NODE_ENV`                    | Optional             | Skips observability initialization when set to `test` (set automatically by Vitest); otherwise passed through to `@fohte/service-kit/observability`                                                                  | `production`                                                                              |
| `TEST_DATABASE_URL`           | Optional (test-only) | Dedicated local test DB for `server` tests; run `mise run db:up` first. Global setup drops the `public`, `drizzle`, and `langgraph` schemas before migrations. Outside mise, DB-backed suites are skipped when unset | `postgres://meshi:meshi@127.0.0.1:<port from docker compose>/meshi_server_test`           |
| `MIGRATION_TEST_DATABASE_URL` | Optional (test-only) | Dedicated local DB for migration rollback/backfill tests; run `mise run db:up` first. Migration test setup drops the `public`, `drizzle`, `langgraph`, and `migration_test` schemas before applying migrations       | `postgres://meshi:meshi@127.0.0.1:<port from docker compose>/meshi_server_migration_test` |

### Run

Set the required `R2_*` variables in `.env` before starting the server. mise loads `.env` and `.env.local` for local commands, while Compose reads `.env` and passes the values to the app. The access key needs object read, write, and delete permissions on the selected bucket; objects are stored under `meal-photos/`.

```sh
pnpm --filter server run build && pnpm --filter server run start  # one-shot, from the built dist/
pnpm --filter server run dev                                      # tsx watch, no build step
```

To create `meshi_server_dev`, run `mise run db:up` once before starting the app in a container. The source is bind-mounted, so it hot-reloads the same way:

```sh
docker compose up app
```

It's published to a random host port; find it with `docker compose port app 8080`.

`GET /api/stock` returns `stockItems`, `plannedDeliveries`, `capacityWarnings`, `eatByWarnings`, and `priorityLots` as camelCase JSON.
`POST /api/stock/deliveries` registers, updates, or cancels a planned delivery; `POST /api/stock/deliveries/:id/receive` records its received date and actual quantities.
`POST /api/stock/counts` accepts `foodMasterId`, a non-negative absolute `quantity`, and optional `receivedDate` / `bestBefore` dates. Dates apply to newly added stock; the response contains the previous quantity, counted quantity, and difference.
The MCP endpoint is served at `POST /mcp`; `GET /health` reports DB connectivity. `GET /api/meal-history` (`?from=YYYY-MM-DD&to=YYYY-MM-DD`, half-open, Asia/Tokyo calendar dates) returns each entry's nutrition status and an unknown-values flag for the overall totals and each day. `GET /api/days/:date` (a single Asia/Tokyo calendar day, with entries enriched by food name, per-item kcal (`null` when unknown), nutrition status, and estimated/unknown flags, plus `incompleteNutrients` for nutrients missing from one or more logged foods and `skippedMealTypes` for that day), `GET /api/nutrient-definitions`, `GET /api/foods/search` (`?q=`, `?limit=`, fuzzy name match ranked by eating history), `GET /api/foods/suggestions` (`?limit=`, recently/frequently eaten foods), and `GET /api/foods/:id` serve read-only JSON for the web frontend. `GET /api/profile` serves the same, and `PATCH /api/profile` patches it (omitted fields keep their current value; `dailyTargets: null` clears it). `GET /api/meal-sets` lists saved meal sets with food names and per-unit kcal (`null` when unknown); `POST /api/meal-sets` creates one, `PATCH /api/meal-sets/:id` replaces its name and items, and `DELETE /api/meal-sets/:id` deletes it. `POST /api/meal-logs` accepts either a single-item body (`foodMasterId` / `eatenDate` / `mealType` / `quantity`) or a batch body with shared `eatenDate` / `mealType` fields and an `items` array of `foodMasterId` / `quantity` pairs; batch responses are arrays, and if any item fails service validation, nothing is recorded and the error includes a one-based `itemIndex`. `PATCH /api/meal-logs/:id` and `DELETE /api/meal-logs/:id` correct/remove a meal log entry for the web frontend's registration sheet; `PUT /api/meal-skips/:date/:mealType` and `DELETE /api/meal-skips/:date/:mealType` record/cancel a meal skip for that date and meal type; `POST /api/food-masters/from-composition` registers a `food_masters` row from a `food_compositions` candidate (`source: 'composition_table_estimate'`, `isEstimated: true`) when the sheet's search turns up no existing food_master. Meal photos can be uploaded as multipart field `photo` with `POST /api/meal-photos/:date/:mealType` (JPEG, PNG, and WebP files up to 10 MiB), listed with `GET /api/meal-photos/:date/:mealType`, streamed through `GET /api/meal-photos/:id/content`, and deleted with `DELETE /api/meal-photos/:id`.

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
pnpm --filter server run seed                                            # nutrient_definitions only
pnpm --filter server run seed -- --food-composition ../path/to/dataset.json  # + MEXT composition tables
```

Dataset shape (JSON array): `[{ "code": "01088", "name": "...", "nutrients": { "energy_kcal": 156, "protein_g": 2.5, ... } }]`. Nutrient codes follow `<英名>_<単位>` (e.g. `protein_g`, `iron_mg`, `vitamin_a_µg`). Codes not in `nutrient_definitions` are rejected; pass extras via the programmatic API.

#### Food composition table (MEXT) → dataset JSON

The 日本食品標準成分表 is distributed as an .xlsx workbook by MEXT, not as this dataset JSON. `pnpm --filter server run convert-food-composition` reads that .xlsx directly — no spreadsheet app needed:

1. Download the data workbook ("・第2章（データ）", covering all tables including 一般成分表) from the [MEXT publication page](https://www.mext.go.jp/a_menu/syokuhinseibun/mext_00001.html) and keep it out of version control, e.g. under `data/` (gitignored — see below).
2. Check column detection before converting anything:
   ```sh
   pnpm --filter server run convert-food-composition -- --xlsx ../data/mext-table.xlsx --dump-header
   ```
   This prints each column's detected header text and, if matched, which nutrient code it resolved to, plus a summary of nutrient codes with no matching column ("unmatched") and codes that matched more than one column ("ambiguous"). Columns are matched by header text (e.g. "たんぱく質" vs "アミノ酸組成によるたんぱく質"), not fixed position, so a column matching the wrong thing shows up here rather than silently landing in the output. The default `--header-rows 12` matches the 増補2023年 workbook's actual header depth (group / item / sub-item label rows, then a "単位" unit row and a "成分識別子" component-tag row) — adjust it if a different release's header is shallower or deeper. If the workbook has more than one sheet, pick it with `--sheet <name-or-1-based-index>` (defaults to the first sheet; the 増補2023年 file has a single "表全体" sheet).
3. Convert:
   ```sh
   pnpm --filter server run convert-food-composition -- --xlsx ../data/mext-table.xlsx --out ../data/food-composition.json
   ```
   Values are handled as: `Tr` (trace) → `0`, `(2.5)` (estimated) → `2.5`, `-` (not measured) → the nutrient key is omitted for that food. Food codes are re-padded to 5 digits (numeric-typed code cells can drop the leading zero, e.g. `01088` → `1088`). Verified end-to-end against the actual 増補2023年 workbook: all 2,538 foods convert with 0 unmatched/ambiguous nutrient columns.
4. `pnpm --filter server run seed -- --food-composition ../data/food-composition.json`.

Only the columns from the general-components table are mapped; 飽和脂肪酸 (a separate per-fatty-acid table) and ビタミン E (four tocopherol columns, no single total) are left unmatched — extend `NUTRIENT_MATCHERS` in `server/scripts/convert-food-composition.ts` if they're needed.

Citation: outputs derived from this dataset must credit "日本食品標準成分表(八訂)増補2023年" and note that the data has been edited/processed (加工) from the source, per the [政府標準利用規約(2.0 版)](https://www.mext.go.jp/b_menu/1351168.htm). Per [the same terms' content list](https://www.mext.go.jp/b_menu/1366610.htm), 日本食品標準成分表 is one of the datasets that may require notification/royalty payment for some uses (e.g. republishing it as a book) — the source Excel and any JSON generated from it must stay local (`data/` is gitignored) and must not be committed to this repository.

### Test / lint

```sh
pnpm --filter server run test
pnpm lint
pnpm --filter web run test
```
