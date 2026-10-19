import { readFileSync } from 'node:fs';
import { describe, expect, it } from '@jest/globals';

/**
 * Redis no puede volver a quedar en bucle de reinicios por un AOF dañado.
 *
 * El 2026-10-19 un corte dejó 61 bytes malos al final de `appendonly.aof.*.incr.aof`; Redis salía con 1,
 * `restart: unless-stopped` lo relanzaba cada minuto y TEST mandó ~200 avisos con el Throttler caído
 * (docs/runbooks/redis-aof-danado.md). Los composes arrancan ahora con un guion que comprueba, copia y
 * repara el AOF antes de `redis-server`. Estas pruebas fijan eso: quien lo simplifique de vuelta a un
 * `redis-server --appendonly yes` a secas rompe el build.
 */
const composes = ['docker-compose.coolify.yml', 'docker-compose.dev.yml'];

describe.each(composes)('Redis de %s', (file) => {
  const source = readFileSync(file, 'utf8');

  it('no arranca con redis-server a secas: pasa por la comprobación del AOF', () => {
    expect(source).not.toMatch(/command:\s*\[\s*'redis-server'/);
    expect(source).not.toMatch(/command:\s*\n\s*\[\s*'redis-server'/);
    expect(source).toContain('redis-check-aof');
  });

  it('copia el AOF dañado antes de repararlo y no se queda sin plan si no tiene arreglo', () => {
    const copy = source.indexOf('cp -a "$$d" "/data/aof-danado-');
    const fix = source.indexOf('yes | redis-check-aof --fix');
    const setAside = source.indexOf('rm -rf "$$d"');
    expect(copy).toBeGreaterThan(-1);
    expect(fix).toBeGreaterThan(copy);
    expect(setAside).toBeGreaterThan(fix);
  });

  it('termina en exec redis-server con el mismo tope de memoria', () => {
    expect(source).toContain('exec redis-server --appendonly yes --maxmemory 256mb --maxmemory-policy allkeys-lru');
  });
});
