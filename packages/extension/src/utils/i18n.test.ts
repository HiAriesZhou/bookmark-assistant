/**
 * Tests for i18n utilities
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTranslator } from './i18n';

describe('i18n', () => {
  describe('createTranslator', () => {
    describe('when chrome.i18n is available', () => {
      beforeEach(() => {
        // Mock chrome.i18n
        vi.stubGlobal('chrome', {
          i18n: {
            getMessage: vi.fn((key: string, substitutions?: string | string[]) => {
              // Return actual translations for known keys
              const messages: Record<string, string> = {
                about_version: 'Version $1',
                pro: 'Pro',
                free: 'Free',
                connected: 'Connected',
              };

              let message = messages[key] || key;

              // Handle substitutions
              if (substitutions) {
                if (Array.isArray(substitutions)) {
                  substitutions.forEach((sub, i) => {
                    message = message.replace(`$${i + 1}`, sub);
                  });
                } else {
                  message = message.replace('$1', substitutions);
                }
              }

              return message;
            }),
            getUILanguage: () => 'en',
          },
        });
      });

      it('should return translation for known key', () => {
        const { t } = createTranslator();
        expect(t('connected')).toBe('Connected');
      });

      it('should return key when translation missing', () => {
        const { t } = createTranslator();
        expect(t('nonexistent_key')).toBe('nonexistent_key');
      });

      it('should substitute single placeholder', () => {
        const { t } = createTranslator();
        expect(t('about_version', ['1.0.0'])).toBe('Version 1.0.0');
      });

      it('should substitute multiple placeholders', () => {
        // Mock with multiple placeholders
        vi.stubGlobal('chrome', {
          i18n: {
            getMessage: vi.fn((key: string, substitutions?: string | string[]) => {
              if (key === 'multi_placeholder') {
                let msg = '$1 and $2';
                if (Array.isArray(substitutions)) {
                  substitutions.forEach((sub, i) => {
                    msg = msg.replace(`$${i + 1}`, sub);
                  });
                }
                return msg;
              }
              return key;
            }),
            getUILanguage: () => 'en',
          },
        });

        const { t } = createTranslator();
        expect(t('multi_placeholder', ['hello', 'world'])).toBe('hello and world');
      });

      it('should return key for empty translation', () => {
        vi.stubGlobal('chrome', {
          i18n: {
            getMessage: () => '', // Chrome returns empty string for missing keys
            getUILanguage: () => 'en',
          },
        });

        const { t } = createTranslator();
        expect(t('some_key')).toBe('some_key');
      });

      it('should return locale from chrome.i18n', () => {
        const { locale } = createTranslator();
        expect(locale).toBe('en');
      });

      it('should report as available', () => {
        const { isAvailable } = createTranslator();
        expect(isAvailable).toBe(true);
      });
    });

    describe('when chrome.i18n is NOT available (development fallback)', () => {
      beforeEach(() => {
        vi.stubGlobal('chrome', undefined);
      });

      it('should return key as fallback', () => {
        const { t } = createTranslator();
        expect(t('some_key')).toBe('some_key');
      });

      it('should return key with substitutions', () => {
        const { t } = createTranslator();
        expect(t('version_key', ['1.0'])).toBe('version_key');
      });

      it('should default to en locale', () => {
        const { locale } = createTranslator();
        expect(locale).toBe('en');
      });

      it('should report as not available', () => {
        const { isAvailable } = createTranslator();
        expect(isAvailable).toBe(false);
      });
    });

    describe('when chrome is partially available', () => {
      it('should handle missing chrome.i18n gracefully', () => {
        vi.stubGlobal('chrome', {
          // chrome exists but i18n is missing
        });

        const { t, isAvailable } = createTranslator();
        expect(t('test_key')).toBe('test_key');
        expect(isAvailable).toBe(false);
      });
    });
  });

  describe('type safety', () => {
    it('should accept string substitution', () => {
      vi.stubGlobal('chrome', {
        i18n: {
          getMessage: (key: string) => key,
          getUILanguage: () => 'en',
        },
      });

      const { t } = createTranslator();
      // Should compile without error
      const result = t('key', 'substitution');
      expect(typeof result).toBe('string');
    });

    it('should accept array substitution', () => {
      vi.stubGlobal('chrome', {
        i18n: {
          getMessage: (key: string) => key,
          getUILanguage: () => 'en',
        },
      });

      const { t } = createTranslator();
      // Should compile without error
      const result = t('key', ['sub1', 'sub2']);
      expect(typeof result).toBe('string');
    });

    it('should accept undefined substitution', () => {
      vi.stubGlobal('chrome', {
        i18n: {
          getMessage: (key: string) => key,
          getUILanguage: () => 'en',
        },
      });

      const { t } = createTranslator();
      // Should compile without error
      const result = t('key');
      expect(typeof result).toBe('string');
    });
  });
});
