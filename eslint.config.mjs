// Aligné sur apartejs/aparte : recommended TS + angular-eslint, Prettier pour le
// style (donc aucune règle de mise en forme ici), `--max-warnings 0` dans `lint`.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      '.angular/**',
      'node_modules/**',
      'coverage/**',
      'public/**',
      // Contrat d'entraînement porté verbatim (ADR-003) : ni lint, ni format.
      'src/app/souffleurs/wire/tool-defs.ts',
    ],
  },
  { linterOptions: { reportUnusedDisableDirectives: 'error' } },
  {
    files: ['**/*.ts'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
      prettier,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      // Les sélecteurs `bp-` sont assumés (ADR-010) ; `app-root` vient du scaffold.
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: ['bp', 'app'], style: 'kebab-case' },
      ],
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'bp', style: 'camelCase' },
      ],
      // `close = output()` on sheets/palettes: `(close)` reads naturally and none of
      // these hosts is a native element that could fire a DOM `close` event.
      '@angular-eslint/no-output-native': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-empty-object-type': [
        'error',
        { allowInterfaces: 'with-single-extends' },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended],
  },
  {
    files: ['**/*.mjs', 'tools/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        __dirname: 'readonly',
        setTimeout: 'readonly',
        fetch: 'readonly',
      },
    },
  },
);
