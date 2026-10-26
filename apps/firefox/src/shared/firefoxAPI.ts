/** Firefox exposes Promise-based APIs on browser.*. esbuild injects this alias. */
export const chrome: typeof globalThis.chrome = (globalThis as any).browser;
