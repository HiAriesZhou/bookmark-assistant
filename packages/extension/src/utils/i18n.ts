/**
 * i18n utility for Chrome extension internationalization
 *
 * Usage:
 * import { createTranslator } from '@/utils/i18n';
 * const { t, locale, isAvailable } = createTranslator();
 * const message = t('key_name', ['substitution']);
 */

import type { I18nSubstitution, TranslationContext } from '../types/i18n';

/**
 * Creates a translator instance for Chrome extension i18n.
 * Use in components: const { t, locale } = createTranslator();
 *
 * @returns TranslationContext with t function, locale, and isAvailable flag
 */
export function createTranslator(): TranslationContext {
  const isAvailable = typeof chrome !== 'undefined' && !!chrome.i18n;

  const t = (key: string, substitutions?: I18nSubstitution): string => {
    if (!isAvailable) {
      // Development environment returns key as fallback
      if (process.env.NODE_ENV === 'development') {
        console.debug(`[i18n] Dev mode, returning key: ${key}`);
      }
      return key;
    }

    const message = chrome.i18n.getMessage(key, substitutions);
    // Chrome returns empty string for missing keys
    return message || key;
  };

  const locale = isAvailable ? chrome.i18n.getUILanguage() : 'en';

  return {
    t,
    locale,
    isAvailable,
  };
}

/**
 * Get the current UI language
 * @returns ISO language code (e.g., 'en', 'zh-CN')
 */
export function getLocale(): string {
  if (typeof chrome !== 'undefined' && chrome.i18n) {
    return chrome.i18n.getUILanguage();
  }
  return 'en';
}

/**
 * Get all accepted languages
 * @param callback Function to receive the languages array
 */
export function getAcceptLanguages(callback: (languages: string[]) => void): void {
  if (typeof chrome !== 'undefined' && chrome.i18n) {
    chrome.i18n.getAcceptLanguages(callback);
  } else {
    callback(['en']);
  }
}
