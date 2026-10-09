import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier';
import { globalIgnores } from 'eslint/config';

export default tseslint.config([
  // Ignore build outputs and dependencies
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/build/**',
      '**/.next/**',
      '**/.vercel/**',
      '**/coverage/**',
      '**/*.config.js',
      '**/*.config.mjs',
    ],
  },
  // Extension + web code (browser globals + chrome)
  {
    files: ['packages/extension/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { prettier, 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.browser, chrome: 'readonly' },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        // Don't use project references - much faster
        projectService: false,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Temporarily relax noisy rules; consider fixing and re-enabling later
      'no-empty': 'off',
      '@typescript-eslint/no-namespace': 'off',
      'no-useless-catch': 'off',
      'prettier/prettier': 'warn',
    },
  },
  // Server (Node globals)
  {
    files: ['packages/server/**/*.{ts,js}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { prettier },
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.node },
      parserOptions: {
        // Don't use project references - much faster
        projectService: false,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Relax rules tripping current code; consider addressing and re-enabling
      'no-empty': 'off',
      'prefer-const': 'off',
      '@typescript-eslint/no-namespace': 'off',
      'prettier/prettier': 'warn',
    },
  },
  // Website (Next.js)
  {
    files: ['packages/website/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { prettier, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 'latest',
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
        projectService: false,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'prettier/prettier': 'warn',
    },
  },
]);
