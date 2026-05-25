import { beforeEach, afterEach } from 'vitest';

// Suppress process.stdout.write and process.stderr.write during tests.
//
// Vitest's silent:true only intercepts console.* methods; direct writes to
// the underlying stream bypass it entirely and produce 700KB+ of output per
// full test run (12+ process.stdout.write calls in init.ts alone).
//
// Implementation note: vi.spyOn is intentionally avoided here. Many test
// files call vi.clearAllMocks() in their own beforeEach, which resets spy
// implementations and would re-enable the real write. Instead, we stash and
// replace the method directly — this survives clearAllMocks because it
// operates on the actual process.stdout object, not on the Vitest mock
// registry. Returns true (success) without writing anything.

const noop = () => true as unknown as boolean;

let originalStdoutWrite: typeof process.stdout.write;
let originalStderrWrite: typeof process.stderr.write;

beforeEach(() => {
  originalStdoutWrite = process.stdout.write.bind(process.stdout);
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  // Cast required: write overloads expect a callback variant; noop satisfies
  // the stream contract by returning true (no-error, buffer not full).
  process.stdout.write = noop as typeof process.stdout.write;
  process.stderr.write = noop as typeof process.stderr.write;
});

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
});
