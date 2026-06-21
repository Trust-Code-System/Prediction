// Stub for the "server-only" import marker under Vitest. The real package throws
// when imported outside a React Server Component; in unit tests we replace it
// with this no-op so server modules can be imported and their pure helpers tested.
export {};
