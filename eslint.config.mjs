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
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
      /*
       * `max-params` mide una lista de argumentos que alguien tiene que escribir y recordar en
       * orden. En un CONSTRUCTOR de Nest no existe esa llamada: los parámetros son puntos de
       * inyección que resuelve el contenedor, y colapsarlos en un objeto rompería la inyección
       * sin que ninguna llamada se simplifique — no hay ninguna. Ahí la regla no medía calidad,
       * medía cuántas dependencias declara la clase, que es lo que dicen `complexity` y el
       * tamaño del archivo.
       *
       * Se sustituye por el mismo límite aplicado sólo donde SÍ hay quien llame: funciones
       * sueltas, funciones flecha y métodos que no son el constructor.
       */
      'max-params': 'off',
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'FunctionDeclaration[params.length>5]',
          message: 'Más de 5 parámetros: agrúpalos en un objeto con nombres.',
        },
        {
          /*
           * Sólo la flecha CON NOMBRE (`const hacerAlgo = (...) => ...`), que es la que alguien
           * llama. La anónima que Nest recibe en `useFactory` es inyección —sus argumentos los
           * pone el array `inject`, en ese orden— y ahí «parámetros» vuelve a ser dependencias.
           */
          selector: 'VariableDeclarator > ArrowFunctionExpression[params.length>5]',
          message: 'Más de 5 parámetros: agrúpalos en un objeto con nombres.',
        },
        {
          selector: 'MethodDefinition[kind!="constructor"] > FunctionExpression[params.length>5]',
          message: 'Más de 5 parámetros: agrúpalos en un objeto con nombres.',
        },
      ],
    },
  },
  {
    /*
     * Los controladores son la otra superficie que Nest rellena: cada parámetro de un manejador
     * lleva su decorador (`@Body`, `@Param`, `@Headers`, `@CurrentUser`) y nadie invoca el método
     * a mano. Contar ahí «parámetros» es contar cuántas partes de la petición usa la ruta.
     */
    files: ['src/**/*.controller.ts'],
    rules: { 'no-restricted-syntax': 'off' },
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
