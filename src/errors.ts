// Append to a catch-all fingerprint array (e.g. `[key, SENTRY_DEFAULT_GROUPING]`)
// so events keep Sentry's own grouping (exception type/value/stacktrace)
// alongside the custom key. Without it, a fixed fingerprint collapses every
// error reaching that catch-all into a single issue regardless of cause.
export const SENTRY_DEFAULT_GROUPING = '{{ default }}'
