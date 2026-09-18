# AGENTS.md

## Code organization rules

### Split files before they grow past ~500 lines of production code

When a change would push a file's non-test code past ~500 lines, split it along responsibility seams before adding more. Splits must be move-only commits: no logic changes, renames, or reformatting mixed in. Keep external import paths unchanged by keeping the entrypoint file in place and re-exporting the pieces you split out into new files (e.g. `index.ts` re-exports from the new files). Tests move together with the code they verify.

Prefer creating a new focused file over appending to the largest existing one.

## Error handling rules

### Return a `Result` instead of throwing

`errorHandling` in `eslint.config.js` bans `throw`/`try-catch` in production code and requires every returned `Result` to be consumed (`no-restricted-syntax`, `neverthrow/must-use-result` in `@fohte/eslint-config`). Return a `Result`/`ResultAsync` from [neverthrow](https://github.com/supermacro/neverthrow) instead (add it as a dependency first if this package doesn't have it yet):

```ts
// bad: throws
function parseConfig(raw: string): Config {
  if (!isValid(raw)) throw new Error('invalid config')
  return JSON.parse(raw)
}

// good: returns a Result
function parseConfig(raw: string): Result<Config, ConfigError> {
  if (!isValid(raw)) return err(new ConfigError('invalid config'))
  return ok(JSON.parse(raw))
}
```

Use `ResultAsync.fromPromise()` or `Result.fromThrowable()` to interop with a throwing API without a local try/catch. If the throw-based contract genuinely can't be wrapped that way, catch the exception, wrap it in a `BoundaryError` subclass (see `src/errors.ts`), and rethrow it — `no-restricted-syntax` bans `try`/`throw` as separate selectors, so both the `try` and the `throw` need their own `eslint-disable-next-line no-restricted-syntax` comment explaining why.

## Storybook

### Write a story for every presentational component

Every presentational component under `src/components/` should have a co-located `.stories.tsx` file matching the component's filename (e.g. `src/components/card.tsx` pairs with `src/components/card.stories.tsx`). If a source file exports multiple components, give each one its own `<component-name>.stories.tsx` file instead of matching the source filename. Write one story per meaningful state/variant of the component.

### A story is a prop-driven visual state, not a behavior test

A story's args fully determine what renders; the story never clicks, types, or otherwise interacts to reach that state. `fohte/no-play-in-stories` (`@fohte/eslint-config`) rejects a `play` function on a story or its `meta`, and rejects `parameters.screenshot.skip` — a story exists to document one rendered state from its args, and an interaction-driven story produces whatever the `play` function happens to leave on screen instead of that state.

For a state that would otherwise take interaction to reach — an open menu/popover/dialog, a field mid-edit — expose it through props (e.g. `open`/`defaultOpen`) instead of driving it with a `play` function, adding the prop or extracting a presentational subcomponent if the component doesn't already support it. Test the interaction itself (click, type, assert) in a co-located `.test.tsx` file, not in a story.

### Prefer Storybook over manual browser checks

When you need to check how a component looks in a given state, write or update its story and view it via the `storybook` script (`storybook dev`) before starting a dev server and driving a browser manually.

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
