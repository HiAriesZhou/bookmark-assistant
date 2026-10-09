/**
 * i18n type definitions for Chrome extension internationalization
 */

export type I18nSubstitution = string | string[];

export interface Translator {
  (key: string, substitutions?: I18nSubstitution): string;
}

export interface TranslationContext {
  t: Translator;
  locale: string;
  isAvailable: boolean;
}

export interface MessageCatalog {
  [key: string]: {
    message: string;
    description?: string;
    placeholders?: Record<
      string,
      {
        content: string;
        example?: string;
      }
    >;
  };
}

export interface ChromeI18n {
  getMessage(messageName: string, substitutions?: string | string[]): string;
  getUILanguage(): string;
  getAcceptLanguages(callback: (languages: string[]) => void): void;
  detectLanguage(
    details: { text: string },
    callback: (result: { languages: Array<{ language: string; percentage: number }> }) => void
  ): void;
}
