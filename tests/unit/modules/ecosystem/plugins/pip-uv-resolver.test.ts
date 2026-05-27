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
import { checkUvAvailable, resolveWithUv } from '@modules/ecosystem/plugins/pip-uv-resolver';
import { parseViaAnnotations } from '@modules/ecosystem/plugins/pip-dep-graph';

const mockedExecFileCb = execFileCb as unknown as ReturnType<typeof vi.fn>;
const mockedLogger = logger as unknown as { warn: ReturnType<typeof vi.fn> };

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
