# CLAUDE.md

## Test code rules

### Assert on the whole output with a single equality check

Treat each test as a spec: build the expected output as one literal value (object, struct, JSON, array, etc.) and compare it to the actual output with a single equality assertion. Do not split the assertion into per-field checks, and do not use partial matchers (substring contains, `toContain`, `toMatchObject`, prefix/suffix checks, regex-on-substring, etc.). Partial matches silently ignore unexpected fields and extra elements, so the test stops working as a spec the moment the shape of the output changes.

```ts
// bad: picks fields one by one — silent on any new/changed field
const ev = run()
expect(ev.path).toBe('/a')
expect(ev.event).toBe('ok')
expect(ev.message).toContain('done')

// good: one literal, one equality — any drift in shape fails the test
expect(run()).toEqual({
  path: '/a',
  event: 'ok',
  message: 'done',
})
```

For dynamic fields (timestamps, UUIDs, random IDs), normalize them in a helper before the comparison (e.g. replace with a fixed placeholder) so the full output can still be asserted in one equality check. Do not weaken the assertion to dodge the dynamic value.

## Validate external I/O with zod

Use `zod` to define schemas at every external I/O boundary — HTTP responses parsed from `res.json()`, MCP tool inputs / outputs, env-derived structured payloads, anything coming in from a process other than this one. Parse with `safeParse` (or `parse`) and surface the failure as a typed domain error so the caller can tell the wire format failed; never cast the raw `unknown` to the wire type with `as`.

In-process boundaries (data structures handed between modules we own) stay on plain TypeScript types — there's no untrusted input to validate, and adding `parse` there only costs runtime without buying safety.

## DB-backed tests: per-test transaction, never DROP / TRUNCATE

Tests that touch Postgres get their isolation from a per-test transaction that is rolled back at the end of the test. They do not DROP the schema, re-run migrations, or TRUNCATE tables.

- Migrations run **once** per vitest process via the `globalSetup` in `vitest.config.ts`. After that, the schema is read-only fixture state.
- Each test takes its `tx` from `setupTx()` in `src/test/db.ts`. `setupTx` wires `beforeEach`/`afterEach` to reserve a pooled connection, open a `BEGIN`, and `ROLLBACK` on exit. Concurrent tests in other files run in their own snapshots and never see each other's writes, so file parallelism stays on.
- Tests for a repository that builds a `drizzle(sql)` instance internally use `setupDrizzleTx()` instead (see "Drizzle usage" below) — same rollback guarantee, with the `.options` compatibility fix drizzle needs applied.
- Read-only assertions against the migrated schema use `getTestSql()` directly — no transaction needed when nothing is mutated.
- Never call `TRUNCATE`, `DROP SCHEMA`, or `runMigrations` inside a test or its `beforeAll`. If a test needs that, the design is wrong — fix the isolation, not the symptom.

```ts
describeIfDb('something', () => {
  const getTx = setupTx()

  it('does the thing', async () => {
    const tx = getTx()
    await tx`INSERT INTO foo (...) VALUES (...)`
    expect(await query(tx)).toEqual(...)
    // afterEach ROLLBACKs — no cleanup needed.
  })
})
```

## Drizzle usage: query builder vs raw SQL

Two ways of talking to Postgres coexist in this codebase, and each is deliberate:

- The drizzle query builder (`.select()` / `.insert()` / `.update()` / `.delete()`) is for single-table CRUD, including simple joins. Column and value types are checked against the schema and `.returning()` infers its row type. `src/adapters/db/drizzle-user-profile-repository.ts` and `src/domain/meal-log/drizzle-meal-log-repository.ts` are the reference examples.
- Multiple CTEs, `UNION ALL`, window functions, PostgreSQL extensions (`similarity()`, `%`, `LATERAL`), and expression-based `GROUP BY` (e.g. `to_char(date_trunc(... AT TIME ZONE ...))`) can't be expressed with the query builder — it would bottom out in a raw `sql\`...\``fragment anyway and lose the type safety. Write these as a`postgres.Sql`tagged template and parse the result with zod.`src/domain/food-matcher/drizzle-food-matcher.ts`and`src/domain/meal-history/mealHistoryService.ts` follow this pattern.
- A drizzle instance can't be built directly on top of a transaction-scoped `Sql` from postgres-js: drizzle-orm's postgres-js session reads `client.options.parsers`/`client.options.serializers` while constructing, but both `setupTx()`'s reserved connection (`sql.reserve()`) and `sql.begin()` rebuild the tagged-template function from scratch internally and never copy `.options` onto it — `drizzle(tx)` throws `Cannot read properties of undefined (reading 'parsers')` either way. Repositories that call `drizzle(sql)` internally (`createDrizzleMealLogRepository`, `createDrizzleUserProfileRepository`) use `setupDrizzleTx()` from `src/test/db.ts` instead of `setupTx()` in their tests — it copies `.options` (pool-wide, connection-agnostic type parser config, identical for every connection in the pool) onto the reserved connection before handing it back, which is enough for `drizzle()` to construct successfully. Without this, the only fallback is a non-transactional connection (`getTestSql()`) with manual per-test cleanup, which was tried first and reintroduces cross-file flakiness under file parallelism: a row committed by one file's test can transiently pollute another file's unfiltered aggregate query (e.g. `SELECT count(*) FROM food_masters`) before cleanup runs.

## Test seeds: borrow row types from the drizzle schema

Seeding a test row is a single-row `INSERT`, the case where drizzle's schema types pay off most. Seeds stay `postgres.Sql` tagged templates (so they work with `setupTx()`, `setupDrizzleTx()`, and the plain `getTestSql()` connection alike) — only the argument types are borrowed from `typeof <table>.$inferInsert` in `src/db/schema.ts`, so a typo'd column name or a missing required column fails to compile instead of silently seeding the wrong row.

`src/test/seed.ts` collects one helper per table (`seedFoodMaster`, `seedMealLog`, `seedNutrientDefinition`, ...). Seed through these helpers instead of writing `INSERT INTO ...` again in each test file.
