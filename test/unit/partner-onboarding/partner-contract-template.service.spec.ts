import { describe, expect, it, jest } from '@jest/globals';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PartnerContractTemplateService } from '../../../src/modules/partner-onboarding/application/partner-contract-template.service.js';

/**
 * El contrato bajo el que se afilia un comercio.
 *
 * Lo que se prueba aquí es la regla que hace que esto sea evidencia y no un campo de texto: el
 * cuerpo NO se edita, se versiona, y sólo hay un predeterminado vigente. Sin lo primero se borraría
 * el texto que un comercio aceptó de verdad; sin lo segundo, «¿cuál rige?» lo decidiría el orden de
 * la consulta.
 */
describe('PartnerContractTemplateService', () => {
  function build(existentes: Record<string, unknown>[] = []) {
    const creadas: Record<string, unknown>[] = [];
    const actualizadas: Record<string, unknown>[] = [];
    const fila = (base: Record<string, unknown>) => ({
      ...base,
      update: jest.fn(async (valores: Record<string, unknown>) => {
        actualizadas.push(valores);
        Object.assign(base, valores);
        return base;
      }),
    });
    const filas = existentes.map(fila);
    const templateModel = {
      findOne: jest.fn(async (options: { where: Record<string, unknown> }) => {
        const w = options.where;
        return (
          filas.find((f) => Object.entries(w).every(([k, v]) => (k === 'tenantId' ? true : (f as Record<string, unknown>)[k] === v))) ??
          null
        );
      }),
      findAll: jest.fn(async () => filas),
      create: jest.fn(async (valores: Record<string, unknown>) => {
        creadas.push(valores);
        return valores;
      }),
      update: jest.fn(async (valores: Record<string, unknown>) => {
        actualizadas.push(valores);
        return [1];
      }),
    };
    const sequelize = {
      transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn({ LOCK: { UPDATE: 'UPDATE' } })),
    };
    return {
      service: new PartnerContractTemplateService(templateModel as never, sequelize as never),
      templateModel,
      creadas,
      actualizadas,
      filas,
    };
  }

  const plantilla = (o: Record<string, unknown> = {}) => ({
    id: '1',
    templateCode: 'AFILIACION',
    name: 'Contrato de afiliación',
    version: 2,
    body: 'x'.repeat(60),
    status: 'active',
    isDefault: true,
    deleted: false,
    ...o,
  });

  it('publicar crea la versión SIGUIENTE y archiva la anterior, sin tocar su cuerpo', async () => {
    const { service, creadas, filas } = build([plantilla()]);

    await service.publish('1', {
      templateCode: 'AFILIACION',
      name: 'Contrato de afiliación',
      body: 'y'.repeat(60),
      makeDefault: true,
      internalUserId: '9',
    });

    expect(creadas[0]).toMatchObject({ version: 3, status: 'active', isDefault: true });
    // La anterior se archiva; su `body` NO aparece en ninguna escritura: es evidencia.
    const archivada = (filas[0].update.mock.calls[0] as [Record<string, unknown>])[0];
    expect(archivada).toMatchObject({ status: 'archived', isDefault: false });
    expect(archivada).not.toHaveProperty('body');
  });

  it('la primera versión de un código empieza en 1', async () => {
    const { service, creadas } = build([]);
    await service.publish('1', { templateCode: 'NUEVO', name: 'n', body: 'z'.repeat(60), makeDefault: false, internalUserId: null });
    expect(creadas[0]).toMatchObject({ version: 1, isDefault: false });
  });

  it('publicar por defecto quita el predeterminado anterior en la MISMA transacción', async () => {
    const { service, templateModel, sequelize: _s } = build([plantilla()]);
    await service.publish('1', { templateCode: 'OTRO', name: 'n', body: 'z'.repeat(60), makeDefault: true, internalUserId: null });
    // Son dos escrituras y hay un índice único parcial: fuera de la transacción, dos operadores a
    // la vez producirían un 500 por violación de índice en el que perdiera.
    expect(templateModel.update).toHaveBeenCalledWith(
      expect.objectContaining({ isDefault: false }),
      expect.objectContaining({ where: expect.objectContaining({ isDefault: true }) }),
    );
  });

  it('sin plantilla vigente, `hasActiveDefault` dice que no en vez de reventar', async () => {
    const { service } = build([]);
    expect(await service.hasActiveDefault('1')).toBe(false);
    expect(await service.findDefault('1')).toBeNull();
  });

  it('con plantilla vigente dice que sí: es lo que viaja al Motor', async () => {
    const { service } = build([plantilla()]);
    expect(await service.hasActiveDefault('1')).toBe(true);
  });

  it('no se puede revivir una versión archivada como predeterminada', async () => {
    const { service } = build([plantilla({ status: 'archived', isDefault: false })]);
    await expect(service.setDefault('1', '1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('marcar por defecto una plantilla que no existe responde 404', async () => {
    const { service } = build([]);
    await expect(service.setDefault('1', '99')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('marcar por defecto la que YA lo es no escribe nada', async () => {
    const { service, filas } = build([plantilla()]);
    await service.setDefault('1', '1');
    expect(filas[0].update).not.toHaveBeenCalled();
  });
});
