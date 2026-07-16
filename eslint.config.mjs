// Reglas de lint enfocadas en errores reales; Prettier cubre el formato.
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierConfig from 'eslint-config-prettier';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'src/database/migrations/**', 'src/database/seeders/**'],
  },
  js.configs.recommended,
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: false,
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      // `any` no es un escape permanente; queda como warning por los tipados dinámicos de Sequelize.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // TypeScript ya valida nombres/globales con mayor precisión. Mantener no-undef activo
      // en archivos .ts rompe falsamente globals de Node 18+ (fetch, Response, AbortController)
      // y globals de Jest (describe, it, expect, jest).
      'no-undef': 'off',
      'no-console': ['warn', { allow: ['error', 'warn'] }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    // Límites de complejidad para runtime. Se mantienen como warning hasta que el baseline baje.
    files: ['src/**/*.ts'],
    rules: {
      complexity: ['warn', 15],
      'max-depth': ['warn', 4],
      'max-params': ['warn', 5],
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Herramientas CLI: aquí console.log es salida esperada de usuario, no logging de app.
    files: ['scripts/**/*.ts', 'src/database/migrate.ts', 'src/database/seed.ts', 'src/config/database.config.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Sequelize usa consultas dinámicas en el catálogo administrativo; este archivo se tipa por endpoint.
    files: ['src/modules/catalog-management/catalog-management.repository.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettierConfig,
];
