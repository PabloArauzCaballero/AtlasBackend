import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ExpedientesJobsController } from '../../../src/modules/runtime-jobs/expedientes-jobs.controller.js';
import { ExpedientesMantenimientoService } from '../../../src/modules/expedientes/jobs/expedientes-mantenimiento.service.js';
import { authHeader, buildGenericTestApp, IDEMPOTENCY_HEADER, TENANT_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de los dos jobs de mantenimiento de expedientes:
 *  - `POST operations/jobs/backfill-expedientes`
 *  - `POST operations/jobs/limpiar-expedientes`
 *
 * Son trabajos de fondo disparados a mano: no hay fixture de expediente real que montar aquí
 * (el dominio vive en `ExpedientesMantenimientoService`, con sus propias pruebas), así que esta
 * suite se detiene en lo que el borde HTTP sí puede demostrar por sí solo: el guard de rol
 * (`admin/platform_admin/system`, nada de `internal_operator` ni `risk_analyst`), la cabecera de
 * idempotencia que exige el propio controlador, y que el rol permitido dispara el servicio
 * correcto. No se fabrica ninguna aserción sobre cuántos expedientes procesó: eso lo mide el doble.
 */
describe('ExpedientesJobsController (e2e/supertest)', () => {
  let app: INestApplication;

  const expedientes = {
    rellenar: jest.fn(async (..._args: unknown[]) => ({ clientesProcesados: 0, nodosCreados: 0, objetosAusentes: 0 })),
    limpiar: jest.fn(async (..._args: unknown[]) => ({ ticketsPurgados: 0, nodosPurgados: 0, expedientesPurgados: 0 })),
  };

  beforeAll(async () => {
    app = await buildGenericTestApp(
      [ExpedientesJobsController],
      [{ provide: ExpedientesMantenimientoService, useValue: expedientes }],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST operations/jobs/backfill-expedientes', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/operations/jobs/backfill-expedientes')
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .expect(401);
      expect(expedientes.rellenar).not.toHaveBeenCalled();
    });

    it('internal_operator NO puede disparar el lote: es admin/platform_admin/system', async () => {
      await request(app.getHttpServer())
        .post('/operations/jobs/backfill-expedientes')
        .set(...authHeader('internal_operator'))
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .expect(403);
      expect(expedientes.rellenar).not.toHaveBeenCalled();
    });

    it('sin x-idempotency-key se rechaza antes del servicio', async () => {
      await request(app.getHttpServer())
        .post('/operations/jobs/backfill-expedientes')
        .set(...authHeader('admin'))
        .set(...TENANT_HEADER)
        .expect(400);
      expect(expedientes.rellenar).not.toHaveBeenCalled();
    });

    it('un administrador dispara el lote y recibe 200', async () => {
      await request(app.getHttpServer())
        .post('/operations/jobs/backfill-expedientes')
        .set(...authHeader('admin'))
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .expect(200);
      expect(expedientes.rellenar).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST operations/jobs/limpiar-expedientes', () => {
    it('rechaza con 401 sin token', async () => {
      await request(app.getHttpServer())
        .post('/operations/jobs/limpiar-expedientes')
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .expect(401);
      expect(expedientes.limpiar).not.toHaveBeenCalled();
    });

    it('risk_analyst NO puede disparar la limpieza', async () => {
      await request(app.getHttpServer())
        .post('/operations/jobs/limpiar-expedientes')
        .set(...authHeader('risk_analyst'))
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .expect(403);
      expect(expedientes.limpiar).not.toHaveBeenCalled();
    });

    it('platform_admin dispara la limpieza y recibe 200', async () => {
      await request(app.getHttpServer())
        .post('/operations/jobs/limpiar-expedientes')
        .set(...authHeader('platform_admin'))
        .set(...TENANT_HEADER)
        .set(...IDEMPOTENCY_HEADER)
        .expect(200);
      expect(expedientes.limpiar).toHaveBeenCalledTimes(1);
    });
  });
});
