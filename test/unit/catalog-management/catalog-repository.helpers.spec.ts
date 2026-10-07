import { describe, expect, it, jest } from '@jest/globals';
import { upsertByCode } from '../../../src/modules/catalog-management/catalog-repository.helpers.js';

describe('upsertByCode', () => {
  const valores = { eventCode: 'E1', name: 'nuevo', createdAtValue: new Date('2026-10-05'), updatedAtValue: new Date('2026-10-05') };

  it('al actualizar no pisa la fecha de creación original', async () => {
    const existing = { update: jest.fn(async (..._args: unknown[]) => undefined) };
    const model = { findOne: jest.fn(async () => existing), create: jest.fn() };

    const { created } = await upsertByCode(model as never, 'eventCode', 'E1', valores, { transaction: 'tx' as never });

    expect(created).toBe(false);
    const cambios = existing.update.mock.calls[0][0] as Record<string, unknown>;
    expect(cambios).not.toHaveProperty('createdAtValue');
    expect(cambios).toMatchObject({ name: 'nuevo', updatedAtValue: valores.updatedAtValue });
  });

  it('al crear conserva la fecha de creación', async () => {
    const model = { findOne: jest.fn(async () => null), create: jest.fn(async (v: unknown, _opciones?: unknown) => v) };

    const { created } = await upsertByCode(model as never, 'eventCode', 'E1', valores, {});

    expect(created).toBe(true);
    expect(model.create).toHaveBeenCalledWith(valores, { transaction: undefined });
  });
});
