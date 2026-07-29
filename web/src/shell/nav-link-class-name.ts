// CSS Modules imports are typed via an index signature, so a class name
// lookup is `string | undefined` under noUncheckedIndexedAccess even for
// keys known to exist.
export const navLinkClassName =
  (base: string | undefined, active: string | undefined) =>
  ({ isActive }: { isActive: boolean }): string =>
    [base, isActive ? active : ''].filter(Boolean).join(' ')
