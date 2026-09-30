import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { APP_GUARD, Reflector } from '@nestjs/core';
import request from 'supertest';
import { JwtAuthGuard } from '../../../src/common/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../../src/common/guards/roles.guard.js';
import { TokenRevocationService } from '../../../src/common/services/token-revocation.service.js';
import { ExpedientesNodosController } from '../../../src/modules/expedientes/expedientes-nodos.controller.js';
import { NodoService } from '../../../src/modules/expedientes/application/nodo.service.js';
import { NodoMovimientoService } from '../../../src/modules/expedientes/application/nodo-movimiento.service.js';
import { ContenidoService } from '../../../src/modules/expedientes/application/contenido.service.js';
import { SubidaService } from '../../../src/modules/expedientes/application/subida.service.js';
import { ExpedienteService } from '../../../src/modules/expedientes/application/expediente.service.js';
import { ConcesionService } from '../../../src/modules/expedientes/application/concesion.service.js';
import { ContactosService } from '../../../src/modules/expedientes/application/contactos.service.js';
import { ActorService } from '../../../src/modules/expedientes/application/actor.service.js';
import { ExpedienteAccesoGuard } from '../../../src/modules/expedientes/guards/expediente-acceso.guard.js';
import { alcanza, type Nivel } from '../../../src/modules/expedientes/expedientes.types.js';
import { ForbiddenException } from '@nestjs/common';
import { authHeader, TENANT_HEADER } from '../support/generic-test-app.js';

/**
 * Contrato HTTP de `DELETE /expedientes/:id/papelera`.
 *
 * Esta ruta no está cubierta por ninguna prueba que nombre su path exacto (hallazgo UNTESTED_WRITE).
 * Purga objetos del almacén: lo que importa demostrar es que exige nivel `administrar` (no basta
 * con el rol de clase, que ya deja entrar a analistas de solo lectura) y que un actor sin ese nivel
 * nunca llega a `ExpedienteService.purgar`.
 *
 * `ExpedienteAccesoGuard` no es uno de los tres guards del harness genérico: es propio del módulo y
 * depende de `ActorService`/`ConcesionService`, así que este spec arma su propio módulo de prueba en
 * vez de `buildGenericTestApp`, replicando `JwtAuthGuard`/`RolesGuard` como `APP_GUARD` —tal como los
 * registra `app.module.ts`— porque el controlador no los declara con `@UseGuards` de clase.
 */
describe('ExpedientesNodosController — DELETE /expedientes/:id/papelera (e2e/supertest)', () => {
  let app: INestApplication;

  const actores = { resolver: jest.fn(async () => ({ tipo: 'internal_user', id: 'u1', roles: [], permisos: [] })) };
  // `exigir` replica la regla real (`alcanza`) sin arrastrar el resto de `ConcesionService`.
  const concesiones = {
    nivelBase: jest.fn(() => null as Nivel | null),
    resolver: jest.fn(async () => 'leer' as Nivel | null),
    exigir: jest.fn((nivel: Nivel | null, requerido: Nivel) => {
      if (!alcanza(nivel, requerido)) throw new ForbiddenException('NIVEL_INSUFICIENTE');
    }),
  };
  const expedientes = {
    obtener: jest.fn(async () => ({ purgadoEn: null }) as never),
    purgar: jest.fn(async (..._args: unknown[]) => ({ nodosPurgados: 3, objetosBorrados: 1, objetosConservados: 2 })),
  };
  const nodos = { obtenerNodo: jest.fn(async () => ({ id: 'n1', ruta: '/', inmutable: false }) as never) };
  const movimiento = {};
  const contenido = {};
  const subidas = {};
  const contactos = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ExpedientesNodosController],
      providers: [
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
        { provide: TokenRevocationService, useValue: { getCurrentTokenVersion: jest.fn() } },
        ExpedienteAccesoGuard,
        Reflector,
        { provide: ActorService, useValue: actores },
        { provide: ConcesionService, useValue: concesiones },
        { provide: ExpedienteService, useValue: expedientes },
        { provide: NodoService, useValue: nodos },
        { provide: NodoMovimientoService, useValue: movimiento },
        { provide: ContenidoService, useValue: contenido },
        { provide: SubidaService, useValue: subidas },
        { provide: ContactosService, useValue: contactos },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rechaza con 401 sin token', async () => {
    await request(app.getHttpServer())
      .delete('/expedientes/10/papelera')
      .set(...TENANT_HEADER)
      .send({ motivo: 'sospecha de fraude documental' })
      .expect(401);
    expect(expedientes.purgar).not.toHaveBeenCalled();
  });

  it('un rol fuera de la lista de clase (customer) recibe 403 y nunca llega al guard de expediente', async () => {
    await request(app.getHttpServer())
      .delete('/expedientes/10/papelera')
      .set(...authHeader('customer'))
      .set(...TENANT_HEADER)
      .send({ motivo: 'sospecha de fraude documental' })
      .expect(403);
    expect(expedientes.purgar).not.toHaveBeenCalled();
  });

  it('un analista con nivel "leer" pasa el rol de clase pero no el nivel "administrar": 403', async () => {
    concesiones.resolver.mockResolvedValueOnce('leer');
    await request(app.getHttpServer())
      .delete('/expedientes/10/papelera')
      .set(...authHeader('risk_analyst'))
      .set(...TENANT_HEADER)
      .send({ motivo: 'sospecha de fraude documental' })
      .expect(403);
    expect(expedientes.purgar).not.toHaveBeenCalled();
  });

  it('rechaza un motivo demasiado corto antes de purgar (cuerpo inválido)', async () => {
    concesiones.resolver.mockResolvedValueOnce('administrar');
    await request(app.getHttpServer())
      .delete('/expedientes/10/papelera')
      .set(...authHeader('admin'))
      .set(...TENANT_HEADER)
      .send({ motivo: 'corto' })
      .expect(400);
    expect(expedientes.purgar).not.toHaveBeenCalled();
  });

  it('un admin con nivel "administrar" purga y recibe 200 con el resumen', async () => {
    concesiones.resolver.mockResolvedValueOnce('administrar');
    const response = await request(app.getHttpServer())
      .delete('/expedientes/10/papelera')
      .set(...authHeader('admin'))
      .set(...TENANT_HEADER)
      .send({ motivo: 'sospecha de fraude documental confirmada' })
      .expect(200);

    expect(response.body).toMatchObject({ nodosPurgados: 3, objetosBorrados: 1, objetosConservados: 2 });
    const [[input]] = expedientes.purgar.mock.calls as unknown as [[{ expedienteId: string; soloPapelera: boolean }]];
    expect(input.expedienteId).toBe('10');
    expect(input.soloPapelera).toBe(true);
  });
});
