// Suppress process.stdout.write and process.stderr.write for the entire
// vitest worker lifetime.
//
// WHY MODULE-LEVEL INTERCEPTION:
//   beforeEach/afterEach hooks fire only around individual test bodies.
//   Module-level imports, beforeAll hooks, afterAll hooks, and the gaps
//   between tests all execute outside those hooks — producing 565+ lines of
//   Docker/SonarQube/CLI noise that buries the vitest-llm-reporter JSON.
//   Intercepting at module load time closes every gap.
//
// WHY IT WORKS IN VITEST 4:
//   vitest 4 defaults to pool: 'forks' — each worker is a real child process.
//   The setupFile and all test files in that worker share the same process
//   object, so the noop replacement set here persists into every test body,
//   beforeAll, and afterAll in the worker. No restoration is needed because
//   workers exit after their tests complete.
//
// WHY IT'S SAFE TO NOT RESTORE:
//   The vitest-llm-reporter (and all other reporters) run in the MAIN process,
//   not in the worker. Silencing stdout in a worker has zero effect on reporter
//   output. Workers exit after tests complete — no restoration needed.
//
// Implementation note: vi.spyOn is intentionally avoided here. Many test
// files call vi.clearAllMocks() in their own beforeEach, which resets spy
// implementations and would re-enable the real write. Instead, we replace
// the method directly on the process.stdout/stderr objects — this survives
// clearAllMocks because it operates on the actual stream, not on the Vitest
// mock registry. Returns true (success) without writing anything, satisfying
// the NodeJS.WritableStream contract.

const noop = () => true as unknown as boolean;

export const originalStdoutWrite = process.stdout.write.bind(process.stdout);
export const originalStderrWrite = process.stderr.write.bind(process.stderr);

// Cast required: write overloads expect a callback variant; noop satisfies
// the stream contract by returning true (no-error, buffer not full).
process.stdout.write = noop as typeof process.stdout.write;
process.stderr.write = noop as typeof process.stderr.write;
