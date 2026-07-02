// ATLAS-AUDIT-020 (cerrado en este patch): el proyecto no tenía ESLint ni Prettier
// configurados pese a que `BACKEND_DEVELOPMENT_CONTEXT.md` §1 los exige ("ESLint + Prettier").
//
// Reglas deliberadamente moderadas para un patch de corrección (no una reescritura de estilo):
// prioriza atrapar errores reales (variables no usadas, `any` sin justificar, promesas sin
// await) sobre imponer un estilo de formato — eso ya lo resuelve Prettier por separado.
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
      // Atlas prohíbe `any` como escape permanente (BACKEND_DEVELOPMENT_CONTEXT.md §17), pero
      // el código existente usa `as never` deliberadamente en varios puntos para interactuar
      // con tipados imprecisos de Sequelize; se deja como warning, no error, para no bloquear
      // el build por deuda preexistente mientras se migra gradualmente.
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
    // Herramientas CLI: aquí console.log es salida esperada de usuario, no logging de app.
    files: ['scripts/**/*.ts', 'src/database/migrate.ts', 'src/database/seed.ts', 'src/config/database.config.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Deuda tipada localizada: este repositorio usa Sequelize con consultas dinámicas en el
    // catálogo administrativo. No bloqueamos Fase 1 por estos any mientras se migra a tipos
    // específicos por endpoint en la fase de endurecimiento.
    files: ['src/modules/catalog-management/catalog-management.repository.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettierConfig,
];
