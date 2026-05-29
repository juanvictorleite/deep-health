import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

vi.mock('@infra/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    phase: vi.fn(),
    skip: vi.fn(),
    header: vi.fn(),
    tagged: vi.fn(),
  },
}));

vi.mock('@modules/ecosystem/plugins/pip-dep-graph', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@modules/ecosystem/plugins/pip-dep-graph')>();
  return {
    ...actual,
    parseViaAnnotations: vi.fn(actual.parseViaAnnotations),
  };
});

import { execFile as execFileCb } from 'node:child_process';

import { logger } from '@infra/utils/logger';
import { parseViaAnnotations } from '@modules/ecosystem/plugins/pip-dep-graph';
import { checkUvAvailable, resolveWithUv } from '@modules/ecosystem/plugins/pip-uv-resolver';

const mockedExecFileCb = execFileCb as unknown as ReturnType<typeof vi.fn>;
const mockedLogger = logger as unknown as {
  warn: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
};

const UV_PATH = '/usr/local/bin/uv';
const CWD = '/project/python-app';

const SAMPLE_COMPILED = `requests==2.31.0
    # via -r requirements.txt
certifi==2024.2.2
    # via requests
`;

type Callback = (err: Error | null, stdout: string, stderr: string) => void;

function makeExecMock(
  handler: (cmd: string, args: string[], opts: unknown, cb: Callback) => void,
) {
  return (cmd: string, args: string[], opts: unknown, cb: Callback) => {
    handler(cmd, args, opts, cb);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkUvAvailable — AC3 + AC7', () => {
  it('returns uv path when which uv and uv --version succeed', async () => {
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, _args, _opts, cb) => {
        if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
        else cb(null, 'uv 0.4.0', '');
      }),
    );
    const result = await checkUvAvailable();
    expect(result).toBe(UV_PATH);
  });

  it('returns undefined when which uv fails', async () => {
    mockedExecFileCb.mockImplementation(
      makeExecMock((_cmd, _args, _opts, cb) => {
        cb(new Error('not found'), '', '');
      }),
    );
    const result = await checkUvAvailable();
    expect(result).toBeUndefined();
  });

  it('returns undefined when uv --version fails', async () => {
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, _args, _opts, cb) => {
        if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
        else cb(new Error('version check failed'), '', '');
      }),
    );
    const result = await checkUvAvailable();
    expect(result).toBeUndefined();
  });

  it('returns undefined when which returns empty string', async () => {
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, _args, _opts, cb) => {
        if (cmd === 'which') cb(null, '', '');
      }),
    );
    const result = await checkUvAvailable();
    expect(result).toBeUndefined();
  });
});

describe('resolveWithUv — AC3: host uv found and works', () => {
  beforeEach(() => {
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, args, _opts, cb) => {
        if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
        else if (args[0] === '--version') cb(null, 'uv 0.4.0', '');
        else cb(null, SAMPLE_COMPILED, '');
      }),
    );
  });

  it('returns a PythonDependencyGraph when uv compile succeeds', async () => {
    const result = await resolveWithUv(CWD);
    expect(result).toBeInstanceOf(Map);
    expect(result!.has('requests')).toBe(true);
    expect(result!.has('certifi')).toBe(true);
  });

  it('passes --python-version flag when pythonVersion is provided', async () => {
    await resolveWithUv(CWD, '3.11');
    const compileCall = mockedExecFileCb.mock.calls.find(
      (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes('compile'),
    );
    expect(compileCall).toBeDefined();
    const compileArgs = compileCall![1] as string[];
    expect(compileArgs.some((a: string) => a.includes('--python-version=3.11'))).toBe(true);
  });

  it('does NOT pass --python-version flag when pythonVersion is omitted', async () => {
    await resolveWithUv(CWD);
    const compileCall = mockedExecFileCb.mock.calls.find(
      (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[]).includes('compile'),
    );
    expect(compileCall).toBeDefined();
    const compileArgs = compileCall![1] as string[];
    expect(compileArgs.some((a: string) => a.includes('--python-version'))).toBe(false);
  });

  it('calls parseViaAnnotations with uv output', async () => {
    await resolveWithUv(CWD);
    expect(parseViaAnnotations).toHaveBeenCalledWith(SAMPLE_COMPILED);
  });
});

describe('resolveWithUv — AC3 + AC7: uv not found', () => {
  it('returns undefined when uv is not available', async () => {
    mockedExecFileCb.mockImplementation(
      makeExecMock((_cmd, _args, _opts, cb) => {
        cb(new Error('command not found'), '', '');
      }),
    );
    const result = await resolveWithUv(CWD);
    expect(result).toBeUndefined();
  });
});

describe('resolveWithUv — AC3 + AC7: uv execution failure', () => {
  it('returns undefined when uv pip compile fails', async () => {
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, args, _opts, cb) => {
        if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
        else if (args[0] === '--version') cb(null, 'uv 0.4.0', '');
        else cb(new Error('uv compile failed'), '', 'error output');
      }),
    );
    const result = await resolveWithUv(CWD);
    expect(result).toBeUndefined();
  });

  it('logs a warning when uv pip compile fails', async () => {
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, args, _opts, cb) => {
        if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
        else if (args[0] === '--version') cb(null, 'uv 0.4.0', '');
        else cb(new Error('uv compile failed'), '', '');
      }),
    );
    await resolveWithUv(CWD);
    expect(mockedLogger.warn).toHaveBeenCalled();
  });
});

describe('checkUvAvailable — timeout options', () => {
  it('passes timeout option to execFile for which uv', async () => {
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, _args, opts, cb) => {
        if (cmd === 'which') {
          expect((opts as { timeout?: number }).timeout).toBe(5_000);
          cb(null, `${UV_PATH}\n`, '');
        } else {
          cb(null, 'uv 0.4.0', '');
        }
      }),
    );
    await checkUvAvailable();
    expect(mockedExecFileCb).toHaveBeenCalled();
  });

  it('passes timeout option to execFile for uv --version', async () => {
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, _args, opts, cb) => {
        if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
        else {
          expect((opts as { timeout?: number }).timeout).toBe(5_000);
          cb(null, 'uv 0.4.0', '');
        }
      }),
    );
    await checkUvAvailable();
    expect(mockedExecFileCb).toHaveBeenCalledTimes(2);
  });
});

describe('resolveWithUv — timeout behavior', () => {
  it('returns undefined when uv pip compile times out (ETIMEDOUT)', async () => {
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, args, _opts, cb) => {
        if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
        else if (args[0] === '--version') cb(null, 'uv 0.4.0', '');
        else {
          const err = Object.assign(new Error('spawn ETIMEDOUT'), { code: 'ETIMEDOUT' });
          cb(err, '', '');
        }
      }),
    );
    const result = await resolveWithUv(CWD);
    expect(result).toBeUndefined();
  });

  it('logs a warning when uv pip compile times out', async () => {
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, args, _opts, cb) => {
        if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
        else if (args[0] === '--version') cb(null, 'uv 0.4.0', '');
        else {
          const err = Object.assign(new Error('spawn ETIMEDOUT'), { code: 'ETIMEDOUT' });
          cb(err, '', '');
        }
      }),
    );
    await resolveWithUv(CWD);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('uv pip compile failed'),
    );
  });

  it('passes the default 30-second timeout to execFile for uv pip compile', async () => {
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, args, opts, cb) => {
        if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
        else if (args[0] === '--version') cb(null, 'uv 0.4.0', '');
        else {
          expect((opts as { timeout?: number }).timeout).toBe(30_000);
          cb(null, SAMPLE_COMPILED, '');
        }
      }),
    );
    await resolveWithUv(CWD);
    expect(mockedExecFileCb).toHaveBeenCalled();
  });
});

describe('resolveWithUv — AC7: Python version < 3.8 warning', () => {
  it('logs warning when pythonVersion < 3.8', async () => {
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, args, _opts, cb) => {
        if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
        else if (args[0] === '--version') cb(null, 'uv 0.4.0', '');
        else cb(null, SAMPLE_COMPILED, '');
      }),
    );
    await resolveWithUv(CWD, '3.7');
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('best-effort'),
    );
  });

  it('does not log warning when pythonVersion >= 3.8', async () => {
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, args, _opts, cb) => {
        if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
        else if (args[0] === '--version') cb(null, 'uv 0.4.0', '');
        else cb(null, SAMPLE_COMPILED, '');
      }),
    );
    await resolveWithUv(CWD, '3.8');
    expect(mockedLogger.warn).not.toHaveBeenCalled();
  });
});

// ── AC1: registry env vars ────────────────────────────────────────────────────

describe('resolveWithUv — AC1: passes registry env vars to uv pip compile', () => {
  it('merges UV_INDEX_URL into execFile env when set in process.env', async () => {
    const originalEnv = process.env.UV_INDEX_URL;
    process.env.UV_INDEX_URL = 'https://my-registry.example.com/simple';
    try {
      mockedExecFileCb.mockImplementation(
        makeExecMock((cmd, args, opts, cb) => {
          if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
          else if (args[0] === '--version') cb(null, 'uv 0.4.0', '');
          else {
            const env = (opts as { env?: Record<string, string> }).env;
            expect(env).toBeDefined();
            expect(env?.UV_INDEX_URL).toBe('https://my-registry.example.com/simple');
            cb(null, SAMPLE_COMPILED, '');
          }
        }),
      );
      await resolveWithUv(CWD);
    } finally {
      if (originalEnv === undefined) {
        delete process.env.UV_INDEX_URL;
      } else {
        process.env.UV_INDEX_URL = originalEnv;
      }
    }
  });

  it('merges PIP_INDEX_URL, PIP_EXTRA_INDEX_URL, UV_EXTRA_INDEX_URL when set', async () => {
    const keys = ['PIP_INDEX_URL', 'PIP_EXTRA_INDEX_URL', 'UV_EXTRA_INDEX_URL'] as const;
    const saved: Partial<Record<string, string>> = {};
    for (const key of keys) {
      saved[key] = process.env[key];
      process.env[key] = `https://${key.toLowerCase()}.example.com`;
    }
    try {
      mockedExecFileCb.mockImplementation(
        makeExecMock((cmd, args, opts, cb) => {
          if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
          else if (args[0] === '--version') cb(null, 'uv 0.4.0', '');
          else {
            const env = (opts as { env?: Record<string, string> }).env;
            for (const key of keys) {
              expect(env?.[key]).toBe(`https://${key.toLowerCase()}.example.com`);
            }
            cb(null, SAMPLE_COMPILED, '');
          }
        }),
      );
      await resolveWithUv(CWD);
    } finally {
      for (const key of keys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    }
  });

  it('does not set env on execFile when no registry env vars are present', async () => {
    const keys = ['UV_INDEX_URL', 'PIP_INDEX_URL', 'PIP_EXTRA_INDEX_URL', 'UV_EXTRA_INDEX_URL'] as const;
    const saved: Partial<Record<string, string>> = {};
    for (const key of keys) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    try {
      let compileOpts: unknown;
      mockedExecFileCb.mockImplementation(
        makeExecMock((cmd, args, opts, cb) => {
          if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
          else if (args[0] === '--version') cb(null, 'uv 0.4.0', '');
          else {
            compileOpts = opts;
            cb(null, SAMPLE_COMPILED, '');
          }
        }),
      );
      await resolveWithUv(CWD);
      expect((compileOpts as { env?: unknown }).env).toBeUndefined();
    } finally {
      for (const key of keys) {
        if (saved[key] !== undefined) process.env[key] = saved[key];
      }
    }
  });
});

// ── AC2: --no-build retry ─────────────────────────────────────────────────────

describe('resolveWithUv — AC2: retries with --no-build on first failure', () => {
  it('retries with --no-build appended when first uv pip compile fails', async () => {
    let compileCallCount = 0;
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, args, _opts, cb) => {
        if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
        else if (args[0] === '--version') cb(null, 'uv 0.4.0', '');
        else {
          compileCallCount += 1;
          if (compileCallCount === 1) {
            cb(new Error('build failed'), '', '');
          } else {
            expect(args).toContain('--no-build');
            cb(null, SAMPLE_COMPILED, '');
          }
        }
      }),
    );
    const result = await resolveWithUv(CWD);
    expect(result).toBeInstanceOf(Map);
    expect(compileCallCount).toBe(2);
  });

  it('logs debug before retrying with --no-build', async () => {
    let compileCallCount = 0;
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, args, _opts, cb) => {
        if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
        else if (args[0] === '--version') cb(null, 'uv 0.4.0', '');
        else {
          compileCallCount += 1;
          if (compileCallCount === 1) cb(new Error('build failed'), '', '');
          else cb(null, SAMPLE_COMPILED, '');
        }
      }),
    );
    await resolveWithUv(CWD);
    expect(mockedLogger.debug).toHaveBeenCalledWith(
      expect.stringContaining('--no-build'),
    );
  });

  it('returns the parsed graph when retry with --no-build succeeds', async () => {
    let compileCallCount = 0;
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, args, _opts, cb) => {
        if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
        else if (args[0] === '--version') cb(null, 'uv 0.4.0', '');
        else {
          compileCallCount += 1;
          if (compileCallCount === 1) cb(new Error('needs source build'), '', '');
          else cb(null, SAMPLE_COMPILED, '');
        }
      }),
    );
    const result = await resolveWithUv(CWD);
    expect(result).toBeInstanceOf(Map);
    expect(result!.has('requests')).toBe(true);
  });

  it('returns undefined when both attempts fail', async () => {
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, args, _opts, cb) => {
        if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
        else if (args[0] === '--version') cb(null, 'uv 0.4.0', '');
        else cb(new Error('compile failed permanently'), '', '');
      }),
    );
    const result = await resolveWithUv(CWD);
    expect(result).toBeUndefined();
  });

  it('logs a warning only after both attempts fail', async () => {
    let compileCallCount = 0;
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, args, _opts, cb) => {
        if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
        else if (args[0] === '--version') cb(null, 'uv 0.4.0', '');
        else {
          compileCallCount += 1;
          cb(new Error('always fails'), '', '');
        }
      }),
    );
    await resolveWithUv(CWD);
    expect(compileCallCount).toBe(2);
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('uv pip compile failed'),
    );
  });

  it('does not call warn when retry succeeds', async () => {
    let compileCallCount = 0;
    mockedExecFileCb.mockImplementation(
      makeExecMock((cmd, args, _opts, cb) => {
        if (cmd === 'which') cb(null, `${UV_PATH}\n`, '');
        else if (args[0] === '--version') cb(null, 'uv 0.4.0', '');
        else {
          compileCallCount += 1;
          if (compileCallCount === 1) cb(new Error('first fail'), '', '');
          else cb(null, SAMPLE_COMPILED, '');
        }
      }),
    );
    await resolveWithUv(CWD);
    expect(mockedLogger.warn).not.toHaveBeenCalled();
  });
});
