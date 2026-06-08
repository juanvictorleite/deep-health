import ptBrCatalogRaw from '@core/i18n/catalogs/pt-br.json';
import type { SupportedLocale } from '@core/types/locale';

const ptBrCatalog = ptBrCatalogRaw as Record<string, string>;

type TranslationVars = Record<string, string | number>;

let activeLocale: SupportedLocale = 'en';

/**
 * Sets the active locale for all subsequent __() calls.
 * Call once after language selection — before any translated prompt.
 */
export function setLocale(locale: SupportedLocale): void {
  activeLocale = locale;
}

/**
 * Returns the currently active locale. Default is 'en'.
 */
export function getActiveLocale(): SupportedLocale {
  return activeLocale;
}

/**
 * Gettext-style translation function.
 *
 * English text is the key. When the active locale is 'en', the input text
 * is returned unchanged (after interpolation). When the locale is 'pt-br',
 * the PT-BR catalog is consulted; if no entry is found the English text is
 * used as a fallback.
 *
 * Interpolation uses {{varName}} double-curly-brace syntax:
 *   __('Found {{count}} items', { count: 5 }) → 'Found 5 items'
 */
export function __(text: string, vars?: TranslationVars): string {
  let result: string;

  if (activeLocale === 'pt-br') {
    result = ptBrCatalog[text] ?? text;
  } else {
    result = text;
  }

  if (vars) {
    result = result.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      const val = vars[key];
      return val !== undefined ? String(val) : `{{${key}}}`;
    });
  }

  return result;
}
