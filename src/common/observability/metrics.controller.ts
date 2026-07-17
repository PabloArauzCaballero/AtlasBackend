import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { MetricsService } from './metrics.service.js';

type ExpressLikeResponse = {
  setHeader: (name: string, value: string) => void;
  send: (body: string) => void;
  status: (code: number) => ExpressLikeResponse;
};

/**
 * `GET /metrics` — endpoint de scrape de Prometheus (Fase 3.4). Se monta FUERA del prefijo
 * `/api/v1` (ver `main.ts`, `setGlobalPrefix({ exclude: ['metrics'] })`) para respetar la convención
 * de Prometheus. Usa `@Res()` para emitir el formato de exposición en texto plano, evitando el
 * envoltorio JSON de `ResponseInterceptor`.
 *
 * Nota de seguridad: no lleva auth de aplicación; debe restringirse a la red interna de scrape
 * (no exponerlo a internet). Si no se desea exponerlo, `METRICS_ENABLED=false` deja el counter/
 * histograma sin alimentar y este endpoint devuelve un registro vacío.
 */
@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get()
  async scrape(@Res() res: ExpressLikeResponse): Promise<void> {
    const body = await this.metrics.render();
    res.setHeader('Content-Type', this.metrics.contentType);
    res.status(200).send(body);
  }
}
