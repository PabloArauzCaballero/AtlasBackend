import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { inspect } from 'node:util';
import { Op } from 'sequelize';
import { IdentityEngineReconciler } from '../../../src/modules/mobile-identity/identity-engine-reconciler.service.js';

/**
 * El reconciliador de identidad.
 *
 * Fija lo que hace que un paquete de carnet NO pueda quedarse fuera del Motor sin que nadie lo vea:
 * (1) un paquete en revisión sin intento del canal móvil se manda con las imágenes guardadas;
 * (2) uno que la app ya mandó no se manda otra vez; (3) si faltan imágenes no se inventa nada y
 * queda dicho; (4) un fallo de una pasada no la tumba ni deja al servicio sin correr la siguiente.
 */
const IMAGEN = Buffer.from('A'.repeat(100));

describe('IdentityEngineReconciler', () => {
  type Mock = jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let attempts: { findAll: Mock; count: Mock };
  let evidencias: { findAll: Mock };
  let storage: { readObject: Mock };
  let identidad: { start: Mock };
  let reconciliador: IdentityEngineReconciler;

  const paquete = { id: '77', tenantId: '1', customerId: '53' };
  const docs = [
    { documentType: 'identity_front', s3Key: 'k/front' },
    { documentType: 'identity_back', s3Key: 'k/back' },
    { documentType: 'selfie', s3Key: 'k/selfie' },
  ];

  beforeEach(() => {
    attempts = { findAll: jest.fn(async () => [paquete]), count: jest.fn(async () => 0) };
    evidencias = { findAll: jest.fn(async () => docs) };
    storage = { readObject: jest.fn(async () => IMAGEN) };
    identidad = { start: jest.fn(async () => ({ verificationId: '900' })) };
    reconciliador = new IdentityEngineReconciler(attempts as never, evidencias as never, storage as never, identidad as never);
  });

  it('manda al Motor el paquete sin verificación, con las tres imágenes y una clave idempotente por intento', async () => {
    expect(await reconciliador.pasada()).toBe(1);

    const [tenant, cuerpo, clave] = identidad.start.mock.calls[0] as [string, Record<string, string>, string];
    expect(tenant).toBe('1');
    expect(cuerpo.customerId).toBe('53');
    expect(cuerpo.documentFront).toBe(IMAGEN.toString('base64'));
    expect(cuerpo.documentBack).toBeDefined();
    expect(clave).toBe('reconcile-identity-77');
  });

  it('no repite si el cliente ya tiene un intento del canal móvil vigente', async () => {
    attempts.count.mockResolvedValue(1);
    expect(await reconciliador.pasada()).toBe(0);
    expect(identidad.start).not.toHaveBeenCalled();
  });

  it('sin anverso o selfie no manda nada', async () => {
    evidencias.findAll.mockResolvedValue([{ documentType: 'identity_front', s3Key: 'k/front' }]);
    expect(await reconciliador.pasada()).toBe(0);
    expect(identidad.start).not.toHaveBeenCalled();
  });

  it('si el objeto ya no está en el almacén, no manda', async () => {
    storage.readObject.mockResolvedValue(null);
    expect(await reconciliador.pasada()).toBe(0);
    expect(identidad.start).not.toHaveBeenCalled();
  });

  it('un fallo al enviar no lanza y no cuenta como enviado', async () => {
    identidad.start.mockRejectedValue(new Error('motor caído'));
    await expect(reconciliador.pasada()).resolves.toBe(0);
  });

  it('con el Motor sin configurar corta la pasada sin contarlo como fallo', async () => {
    identidad.start.mockRejectedValue(new ServiceUnavailableException({ code: 'DECISION_ENGINE_NOT_CONFIGURED' }));
    attempts.findAll.mockResolvedValue([paquete, { ...paquete, id: '70', customerId: '54' }]);
    expect(await reconciliador.pasada()).toBe(0);
    expect(identidad.start).toHaveBeenCalledTimes(1);
  });

  it('un mismo cliente con dos paquetes pendientes se manda una sola vez', async () => {
    attempts.findAll.mockResolvedValue([paquete, { ...paquete, id: '70' }]);
    expect(await reconciliador.pasada()).toBe(1);
  });
});

describe('IdentityEngineReconciler: reintentos y alarma', () => {
  type Mock = jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  const paquete = { id: '77', tenantId: '1', customerId: '53', requestedAt: new Date('2026-09-30T23:52:57Z') };
  const docs = [
    { documentType: 'identity_front', s3Key: 'k/front' },
    { documentType: 'selfie', s3Key: 'k/selfie' },
  ];
  let attempts: { findAll: Mock; count: Mock };
  let identidad: { start: Mock };
  let reconciliador: IdentityEngineReconciler;

  beforeEach(() => {
    attempts = { findAll: jest.fn(async () => [paquete]), count: jest.fn(async () => 0) };
    identidad = { start: jest.fn(async () => ({ verificationId: '900' })) };
    reconciliador = new IdentityEngineReconciler(
      attempts as never,
      { findAll: jest.fn(async () => docs) } as never,
      { readObject: jest.fn(async () => Buffer.from('A'.repeat(100))) } as never,
      identidad as never,
    );
  });

  it('un intento UNAVAILABLE no cuenta como vigente: se reintenta (la consulta sólo reconoce resueltos o PENDING recientes)', async () => {
    await reconciliador.pasada();

    // `JSON.stringify` descarta las claves-símbolo de Sequelize (`Op.or`, `Op.in`): `inspect` las enseña.
    const donde = (attempts.count.mock.calls[0]?.[0] as { where: Record<symbol, unknown> }).where;
    const filtro = inspect(donde[Op.or as unknown as symbol], { depth: 8 });
    expect(filtro).toContain('VERIFIED');
    expect(filtro).toContain('IN_REVIEW');
    expect(filtro).not.toContain('UNAVAILABLE');
    expect(identidad.start).toHaveBeenCalledTimes(1);
  });

  it('se rinde tras 5 intentos del cliente', async () => {
    attempts.count.mockResolvedValueOnce(0).mockResolvedValueOnce(5);
    expect(await reconciliador.pasada()).toBe(0);
    expect(identidad.start).not.toHaveBeenCalled();
  });

  it('si no puede mandar un paquete lo declara en la alarma de atascados', async () => {
    identidad.start.mockRejectedValue(new Error('motor caído'));
    const aviso = jest.spyOn((reconciliador as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn');

    await reconciliador.pasada();

    expect(aviso.mock.calls.some(([m]) => String(m).includes('identity_reconcile_backlog'))).toBe(true);
  });
});
