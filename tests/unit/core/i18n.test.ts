import { describe, it, expect, beforeEach } from 'vitest';
import { __, setLocale, getActiveLocale } from '@core/i18n';

// Reset locale to 'en' before each test to prevent cross-test state leakage
beforeEach(() => {
  setLocale('en');
});

describe('getActiveLocale()', () => {
  it('returns en by default', () => {
    expect(getActiveLocale()).toBe('en');
  });

  it('returns the locale after setLocale()', () => {
    setLocale('pt-br');
    expect(getActiveLocale()).toBe('pt-br');
  });
});

describe('setLocale()', () => {
  it('switches locale to pt-br', () => {
    setLocale('pt-br');
    expect(getActiveLocale()).toBe('pt-br');
  });

  it('switches locale back to en', () => {
    setLocale('pt-br');
    setLocale('en');
    expect(getActiveLocale()).toBe('en');
  });
});

describe('__()', () => {
  describe('English locale (identity)', () => {
    it('returns the input text unchanged for a known translation key', () => {
      setLocale('en');
      expect(__('Project name')).toBe('Project name');
    });

    it('returns the input text unchanged for an unknown key', () => {
      setLocale('en');
      expect(__('This string does not exist in any catalog')).toBe(
        'This string does not exist in any catalog',
      );
    });

    it('returns the input text unchanged for an empty string', () => {
      setLocale('en');
      expect(__('')).toBe('');
    });
  });

  describe('PT-BR locale (translation)', () => {
    it('returns the PT-BR translation for a known key', () => {
      setLocale('pt-br');
      expect(__('Project name')).toBe('Nome do projeto');
    });

    it('returns the PT-BR translation for Enable SonarQube scanner?', () => {
      setLocale('pt-br');
      expect(__('Enable SonarQube scanner?')).toBe('Habilitar scanner SonarQube?');
    });

    it('returns the PT-BR translation for Generate markdown reports?', () => {
      setLocale('pt-br');
      expect(__('Generate markdown reports?')).toBe('Gerar relatórios em markdown?');
    });

    it('falls back to English text when key is not in the PT-BR catalog', () => {
      setLocale('pt-br');
      const missing = 'This key is not in the catalog';
      expect(__(missing)).toBe(missing);
    });

    it('falls back to English text for an empty string key', () => {
      setLocale('pt-br');
      expect(__('')).toBe('');
    });
  });

  describe('interpolation with {{var}} syntax', () => {
    it('interpolates a single variable in English', () => {
      setLocale('en');
      expect(__('Created: {{path}}\n', { path: '/foo/bar' })).toBe('Created: /foo/bar\n');
    });

    it('interpolates multiple variables in English', () => {
      setLocale('en');
      const result = __('  [{{plugin}}] Found {{count}} scripts. Select validation commands (Space to toggle):', {
        plugin: 'npm',
        count: 3,
      });
      expect(result).toBe('  [npm] Found 3 scripts. Select validation commands (Space to toggle):');
    });

    it('interpolates a single variable in PT-BR (translated)', () => {
      setLocale('pt-br');
      expect(__('Created: {{path}}\n', { path: '/foo/bar' })).toBe('Criado: /foo/bar\n');
    });

    it('interpolates multiple variables in PT-BR (translated)', () => {
      setLocale('pt-br');
      const result = __('  [{{plugin}}] Found {{count}} scripts. Select validation commands (Space to toggle):', {
        plugin: 'npm',
        count: 5,
      });
      expect(result).toBe('  [npm] Encontrados 5 scripts. Selecione os comandos de validação (Espaço para marcar):');
    });

    it('leaves unreferenced {{var}} placeholders intact when no vars provided', () => {
      setLocale('en');
      // No vars argument — placeholders remain as-is
      expect(__('  [{{plugin}}] Fixer strategy')).toBe('  [{{plugin}}] Fixer strategy');
    });

    it('leaves unresolved placeholders when var key is missing from the vars object', () => {
      setLocale('en');
      expect(__('Hello {{name}}', {})).toBe('Hello {{name}}');
    });

    it('coerces numeric vars to string', () => {
      setLocale('en');
      expect(__('Count: {{count}}', { count: 42 })).toBe('Count: 42');
    });

    it('interpolates in PT-BR fallback (missing catalog key)', () => {
      setLocale('pt-br');
      const missing = 'Hello {{name}}, welcome!';
      expect(__(missing, { name: 'World' })).toBe('Hello World, welcome!');
    });
  });
});
