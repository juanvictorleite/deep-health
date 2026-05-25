import type { SupportedLocale, Locale } from './types';
import { buildLocale } from './loader';
import { setLocale, getActiveLocale } from '@core/i18n';
import { resolveDefaultLocale } from '@core/locale-detect';

export function getLocale(code: SupportedLocale = resolveDefaultLocale()): Locale {
  const previous = getActiveLocale();
  setLocale(code);
  const locale = buildLocale();
  setLocale(previous);
  return locale;
}

export type { SupportedLocale, Locale };
