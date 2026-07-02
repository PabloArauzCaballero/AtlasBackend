#!/usr/bin/env node
/**
 * Arranque local robusto para Windows/Linux/macOS.
 *
 * Problema que corrige: si tu PC tiene NODE_ENV=production a nivel global, `dotenv` no
 * sobrescribe esa variable y el backend intenta arrancar como producción aunque estés en local.
 * En desarrollo SIEMPRE forzamos NODE_ENV=development antes de cargar `dist/src/main.js`.
 *
 * Producción debe usar `yarn start` o `yarn start:prod`, nunca `yarn start:dev`.
 */
process.env.NODE_ENV = 'development';
await import('../dist/src/main.js');
