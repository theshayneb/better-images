// The plugin code deliberately calls window.setTimeout/window.clearTimeout
// (never the bare global) so timers stay bound to the right Electron window —
// see CLAUDE.md. Vitest's default "node" environment has no `window` at all,
// so point it at globalThis: same setTimeout/clearTimeout, no real DOM needed
// for anything under test.
(globalThis as unknown as { window: typeof globalThis }).window = globalThis;
