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
