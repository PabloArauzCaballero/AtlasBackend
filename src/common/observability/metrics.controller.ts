/**
 * @file Adaptador HTTP: valida y autoriza la petición antes de delegar el caso de uso.
 * @business Esta pieza aplica controles coherentes a todos los dominios y reduce fallas repetidas entre equipos.
 * @system provee infraestructura transversal de observability sin introducir reglas de un dominio específico.
 */
import { Controller, Get, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../decorators/public.decorator.js';
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
/*
 * `@Public()` aquí es una DECISIÓN, no un descuido — y ahora hay que escribirla.
 *
 * Este endpoint nunca llevó autenticación de aplicación (lo dice la nota de arriba: se restringe
 * por red de scrape). Antes eso no se declaraba en ninguna parte porque el backend no autenticaba
 * por defecto: no decir nada y ser público eran lo mismo. Con `JwtAuthGuard` registrado como
 * `APP_GUARD` ya no lo son, así que la excepción se declara donde se puede leer, entra en el
 * contrato OpenAPI como `security: []`, y el gate `check:auth-coverage` la ve en su lista.
 *
 * Sigue siendo cierto que NO debe exponerse a internet: publica latencias y el mapa de rutas.
 */
@SkipThrottle()
@Public()
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
