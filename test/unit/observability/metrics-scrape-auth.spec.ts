import { afterEach, describe, expect, it } from '@jest/globals';
import { MetricsController } from '../../../src/common/observability/metrics.controller.js';
import { MetricsService } from '../../../src/common/observability/metrics.service.js';
import {
  isMetricsScrapeAuthorized,
  METRICS_SCRAPE_TOKEN_MIN_LENGTH,
  readMetricsScrapeToken,
} from '../../../src/common/observability/metrics-scrape-auth.util.js';

const TOKEN = 'a'.repeat(METRICS_SCRAPE_TOKEN_MIN_LENGTH + 8);

/** Hallazgo SEC-02 (auditoría COBIT 5, 2026-10-28): `GET /metrics` público sin ningún control de aplicación. */
describe('isMetricsScrapeAuthorized', () => {
  it('sin token configurado no exige nada (comportamiento histórico: aislamiento por red)', () => {
    expect(isMetricsScrapeAuthorized(null, undefined)).toBe(true);
  });

  it('con token configurado admite sólo el Bearer correcto', () => {
    expect(isMetricsScrapeAuthorized(TOKEN, `Bearer ${TOKEN}`)).toBe(true);
  });

  it.each([
    ['sin cabecera', undefined],
    ['cabecera vacía', ''],
    ['esquema distinto', `Basic ${TOKEN}`],
    ['token incorrecto', `Bearer ${'b'.repeat(TOKEN.length)}`],
    ['token de otra longitud', 'Bearer corto'],
    ['sin token tras el esquema', 'Bearer '],
  ])('rechaza %s', (_caso, header) => {
    expect(isMetricsScrapeAuthorized(TOKEN, header)).toBe(false);
  });

  it('rechaza todo si el token configurado es demasiado corto, aunque coincida', () => {
    expect(isMetricsScrapeAuthorized('corto', 'Bearer corto')).toBe(false);
  });
});

describe('readMetricsScrapeToken', () => {
  it('trata ausencia, vacío y espacios como "sin token"', () => {
    expect(readMetricsScrapeToken({})).toBeNull();
    expect(readMetricsScrapeToken({ METRICS_SCRAPE_TOKEN: '' })).toBeNull();
    expect(readMetricsScrapeToken({ METRICS_SCRAPE_TOKEN: '   ' })).toBeNull();
  });

  it('recorta el valor configurado', () => {
    expect(readMetricsScrapeToken({ METRICS_SCRAPE_TOKEN: `  ${TOKEN} ` })).toBe(TOKEN);
  });
});

describe('MetricsController con METRICS_SCRAPE_TOKEN', () => {
  const original = process.env['METRICS_SCRAPE_TOKEN'];
  afterEach(() => {
    if (original === undefined) delete process.env['METRICS_SCRAPE_TOKEN'];
    else process.env['METRICS_SCRAPE_TOKEN'] = original;
  });

  function llamar(authorization?: string) {
    const controller = new MetricsController(new MetricsService());
    const resultado = { status: 0, body: '' as string | undefined };
    const res = {
      setHeader: () => undefined,
      status: (code: number) => {
        resultado.status = code;
        return res;
      },
      send: (body: string) => {
        resultado.body = body;
      },
    };
    return controller.scrape(res as never, authorization).then(() => resultado);
  }

  it('responde 401 y no publica métricas sin el token', async () => {
    process.env['METRICS_SCRAPE_TOKEN'] = TOKEN;
    const sinToken = await llamar();
    expect(sinToken.status).toBe(401);
    expect(sinToken.body).toBe('');
    expect((await llamar('Bearer incorrecto')).status).toBe(401);
  });

  it('responde 200 con el token correcto', async () => {
    process.env['METRICS_SCRAPE_TOKEN'] = TOKEN;
    const ok = await llamar(`Bearer ${TOKEN}`);
    expect(ok.status).toBe(200);
    expect(ok.body).toContain('# HELP');
  });

  it('sin token configurado sigue sirviendo (no rompe el scrape existente)', async () => {
    delete process.env['METRICS_SCRAPE_TOKEN'];
    expect((await llamar()).status).toBe(200);
  });
});
