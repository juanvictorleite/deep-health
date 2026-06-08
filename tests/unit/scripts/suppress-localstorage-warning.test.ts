import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { SUPPRESS_LOCALSTORAGE_WARNING_BANNER } from "../../../tsup.config";

// Evaluate the banner string in a controlled scope that receives an isolated
// process.emit so we can verify filtering without touching the real process.
function applyBanner(mockProcess: { emit: (...args: unknown[]) => unknown }) {
  // The banner uses `process` as a free variable. Wrap the evaluation inside a
  // function that shadows `process` with our mock so it operates on the mock.
  // oxlint-disable-next-line no-new-func -- intentional: the banner under test is itself a dynamic function string that must be evaluated to verify its filtering logic
  const fn = new Function("process", SUPPRESS_LOCALSTORAGE_WARNING_BANNER);
  fn(mockProcess);
}

function makeWarning(name: string, message: string): NodeJS.WarningMessage & { name: string; message: string } {
  const err = new Error(message) as NodeJS.WarningMessage & { name: string; message: string };
  err.name = name;
  return err;
}

describe("SUPPRESS_LOCALSTORAGE_WARNING_BANNER", () => {
  let delegateCalls: [string, ...unknown[]][];
  let mockProcess: { emit: (...args: unknown[]) => unknown };

  beforeEach(() => {
    delegateCalls = [];
    // Build a minimal mock process whose emit records delegated calls.
    mockProcess = {
      emit: vi.fn((...args: unknown[]) => {
        delegateCalls.push(args as [string, ...unknown[]]);
        return true;
      }),
    };
    applyBanner(mockProcess);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("suppresses an ExperimentalWarning whose message contains 'localStorage'", () => {
    const warning = makeWarning("ExperimentalWarning", "localStorage is not available because --localstorage-file was not provided");

    const result = mockProcess.emit("warning", warning);

    expect(result).toBe(false);
    expect(delegateCalls).toHaveLength(0);
  });

  it("passes through an ExperimentalWarning with a different message", () => {
    const warning = makeWarning("ExperimentalWarning", "The Fetch API is an experimental feature");

    mockProcess.emit("warning", warning);

    expect(delegateCalls).toHaveLength(1);
    expect(delegateCalls[0][0]).toBe("warning");
  });

  it("passes through a non-ExperimentalWarning that mentions localStorage", () => {
    const warning = makeWarning("DeprecationWarning", "localStorage usage is deprecated");

    mockProcess.emit("warning", warning);

    expect(delegateCalls).toHaveLength(1);
    expect(delegateCalls[0][0]).toBe("warning");
  });

  it("passes through unrelated process events (e.g. 'exit')", () => {
    mockProcess.emit("exit", 0);

    expect(delegateCalls).toHaveLength(1);
    expect(delegateCalls[0][0]).toBe("exit");
  });

  it("passes through a warning event with no warning object attached", () => {
    mockProcess.emit("warning");

    expect(delegateCalls).toHaveLength(1);
    expect(delegateCalls[0][0]).toBe("warning");
  });

  it("does not suppress when warning name matches but message does not contain localStorage", () => {
    const warning = makeWarning("ExperimentalWarning", "Web Crypto API is experimental");

    mockProcess.emit("warning", warning);

    expect(delegateCalls).toHaveLength(1);
  });

  it("suppresses a localStorage warning with mixed-case 'localStorage' in the message", () => {
    // The regex /localStorage/ is case-sensitive — 'localStorage' exact case triggers suppression.
    const warning = makeWarning("ExperimentalWarning", "localStorage not available");

    const result = mockProcess.emit("warning", warning);

    expect(result).toBe(false);
    expect(delegateCalls).toHaveLength(0);
  });

  it("does NOT suppress 'LOCALSTORAGE' (uppercase) since the regex is case-sensitive", () => {
    const warning = makeWarning("ExperimentalWarning", "LOCALSTORAGE not available");

    mockProcess.emit("warning", warning);

    // Uppercase variant should not be suppressed — only the exact casing matters.
    expect(delegateCalls).toHaveLength(1);
  });
});
