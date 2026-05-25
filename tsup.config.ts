import { defineConfig } from "tsup";

const shared = {
  format: ["esm"] as const,
  target: "node26" as const,
  sourcemap: false,
  splitting: false,
  external: ['googleapis', 'google-auth-library'],
};

/**
 * Injected at the very top of CLI and SEA bundles (before any import hoisting).
 * Silently drops the Node.js ExperimentalWarning about localStorage that is
 * triggered by dependencies (debug, docx) probing globalThis.localStorage at
 * ESM import time. Only the specific localStorage ExperimentalWarning is
 * suppressed — all other warnings pass through unchanged.
 */
export const SUPPRESS_LOCALSTORAGE_WARNING_BANNER = `
(function() {
  var _origEmit = process.emit.bind(process);
  process.emit = function(event) {
    if (
      event === 'warning' &&
      arguments[1] &&
      arguments[1].name === 'ExperimentalWarning' &&
      /localStorage/.test(arguments[1].message)
    ) {
      return false;
    }
    return _origEmit.apply(process, arguments);
  };
})();
`.trim();

export default defineConfig([
  {
    // Library entry — generates DTS for programmatic consumers
    ...shared,
    entry: ["src/index.ts"],
    clean: true,
    dts: true,
  },
  {
    // CLI binary — no DTS needed (not imported as a library)
    ...shared,
    entry: ["bin/security-scan.ts"],
    clean: false, // preserve library output from first build
    dts: false,
    banner: { js: SUPPRESS_LOCALSTORAGE_WARNING_BANNER },
  },
  {
    // SEA (Single Executable Application) bundle — CJS only, all deps inlined.
    // Node.js 26 SEA requires CJS; ESM is not supported in stable SEA.
    // googleapis and google-auth-library remain external (optional deps loaded
    // via dynamic import with try/catch — not required for core functionality).
    entry: ["bin/security-scan.ts"],
    format: ["cjs"],
    outDir: "dist-sea",
    noExternal: [/.*/],
    external: ['googleapis', 'google-auth-library'],
    splitting: false,
    sourcemap: false,
    clean: false,
    dts: false,
    target: "node26",
    define: {
      'process.env.CLI_NAME': JSON.stringify('security-scan'),
      'process.env.NPM_DEFAULT_FIXER': JSON.stringify('osv-then-audit'),
    },
    banner: { js: SUPPRESS_LOCALSTORAGE_WARNING_BANNER },
  },
]);
