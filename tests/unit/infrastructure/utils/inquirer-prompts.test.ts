import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
  select: vi.fn(),
  checkbox: vi.fn(),
  input: vi.fn(),
}));

import { confirm, select, checkbox, input } from '@inquirer/prompts';
import {
  confirmPrompt,
  selectPrompt,
  checkboxPrompt,
  inputPrompt,
} from '@infra/utils/inquirer-prompts';

const mockConfirm = vi.mocked(confirm);
const mockSelect = vi.mocked(select);
const mockCheckbox = vi.mocked(checkbox);
const mockInput = vi.mocked(input);

describe('confirmPrompt()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards message and default=false to confirm() and resolves its value', async () => {
    mockConfirm.mockResolvedValue(true);
    const result = await confirmPrompt('Proceed?');
    expect(mockConfirm).toHaveBeenCalledWith({ message: 'Proceed?', default: false });
    expect(result).toBe(true);
  });

  it('forwards an explicit defaultValue to confirm()', async () => {
    mockConfirm.mockResolvedValue(false);
    const result = await confirmPrompt('Proceed?', true);
    expect(mockConfirm).toHaveBeenCalledWith({ message: 'Proceed?', default: true });
    expect(result).toBe(false);
  });
});

describe('selectPrompt()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards message and choices to select() and resolves its value', async () => {
    mockSelect.mockResolvedValue('npm');
    const choices = [{ name: 'npm', value: 'npm' }, { name: 'pip', value: 'pip' }];
    const result = await selectPrompt('Pick an ecosystem', choices);
    expect(mockSelect).toHaveBeenCalledWith({ message: 'Pick an ecosystem', choices, default: undefined });
    expect(result).toBe('npm');
  });

  it('forwards an explicit defaultValue to select()', async () => {
    mockSelect.mockResolvedValue('pip');
    const choices = [{ name: 'npm', value: 'npm' }, { name: 'pip', value: 'pip' }];
    const result = await selectPrompt('Pick an ecosystem', choices, 'pip');
    expect(mockSelect).toHaveBeenCalledWith({ message: 'Pick an ecosystem', choices, default: 'pip' });
    expect(result).toBe('pip');
  });
});

describe('checkboxPrompt()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards message and choices to checkbox() and resolves its value', async () => {
    mockCheckbox.mockResolvedValue(['npm', 'pip']);
    const choices = [
      { name: 'npm', value: 'npm', checked: true },
      { name: 'pip', value: 'pip' },
    ];
    const result = await checkboxPrompt('Pick ecosystems', choices);
    expect(mockCheckbox).toHaveBeenCalledWith({ message: 'Pick ecosystems', choices });
    expect(result).toEqual(['npm', 'pip']);
  });
});

describe('inputPrompt()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards message to input() without a default and resolves its value', async () => {
    mockInput.mockResolvedValue('typed value');
    const result = await inputPrompt('Enter a value');
    expect(mockInput).toHaveBeenCalledWith({ message: 'Enter a value', default: undefined });
    expect(result).toBe('typed value');
  });

  it('forwards an explicit defaultValue to input()', async () => {
    mockInput.mockResolvedValue('accepted default');
    const result = await inputPrompt('Enter a value', 'accepted default');
    expect(mockInput).toHaveBeenCalledWith({ message: 'Enter a value', default: 'accepted default' });
    expect(result).toBe('accepted default');
  });
});
