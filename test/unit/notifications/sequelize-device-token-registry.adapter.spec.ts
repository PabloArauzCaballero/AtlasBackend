import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { SequelizeDeviceTokenRegistryAdapter } from '../../../src/modules/notifications/infrastructure/sequelize-device-token-registry.adapter.js';
import { deviceTokenFingerprint } from '../../../src/modules/notifications/infrastructure/persistence/device-token-fingerprint.js';

/**
 * La baja de los tokens que el proveedor declara muertos (410 de APNs).
 *
 * Lo que importa aquí no es que el método «haga algo», sino CÓMO consulta: la fila guarda el token
 * cifrado y su huella, así que buscar por huella es la única forma de encontrarla. Si la fórmula se
 * separara de la del registro, el `UPDATE` no tocaría ninguna fila y nada fallaría — la entrega
 * seguiría diciendo «desactivados 0» y los tokens muertos se reintentarían para siempre.
 */
describe('SequelizeDeviceTokenRegistryAdapter', () => {
  function build(affected = 1) {
    const model = { update: jest.fn(async (_values: unknown, _options: unknown) => [affected] as [number]) };
    return { adapter: new SequelizeDeviceTokenRegistryAdapter(model as never), model };
  }

  /** Lo que el adaptador puso en el `where`, ya desenvuelto. */
  function huellasConsultadas(model: { update: jest.Mock }): string[] {
    const [, options] = model.update.mock.calls[0] as [unknown, { where: Record<string, Record<symbol, string[]>> }];
    return options.where.tokenHash[Op.in] as string[];
  }

  it('apaga la fila del token muerto y devuelve cuántas cambiaron', async () => {
    const { adapter, model } = build(1);

    await expect(adapter.deactivate(['token-muerto'])).resolves.toBe(1);

    const [values] = model.update.mock.calls[0] as [{ isActive: boolean; updatedAtValue: Date }, unknown];
    expect(values.isActive).toBe(false);
    expect(values.updatedAtValue).toBeInstanceOf(Date);
  });

  it('busca por HUELLA, nunca por el token: el token no está en la consulta', async () => {
    const { adapter, model } = build();

    await adapter.deactivate(['token-muerto']);

    const huellas = huellasConsultadas(model);
    expect(huellas).toEqual([deviceTokenFingerprint('token-muerto')]);
    expect(JSON.stringify(model.update.mock.calls[0])).not.toContain('token-muerto');
  });

  /**
   * La huella CONGELADA.
   *
   * Es el contrato con lo que ya hay escrito en `device_tokens`. Cambiar la fórmula —en cualquiera de
   * los dos lados— dejaría de encontrar todas las filas existentes, y sin esta prueba el cambio
   * pasaría en verde. El valor se calculó aparte, con `sha256(stableStringify({ token }))`: si algún
   * día no coincide, es que la fórmula se movió y hay que migrar la columna, no ajustar el literal.
   */
  it('la huella es estable entre versiones, porque las filas ya escritas dependen de ella', () => {
    expect(deviceTokenFingerprint('token-vivo')).toBe('cc18cb54da83cc6ec9a2ad8a6cd12d894eb02e17bf9bc90b946074689d6a5918');
    expect(deviceTokenFingerprint('token-muerto')).toBe('aedc123d86c4bbff51f676b4d3179fc345b30d7dc5f4fb5ff4f1085d6f9cedcd');
  });

  it('no toca la base cuando no hay nada que dar de baja', async () => {
    const { adapter, model } = build();

    await expect(adapter.deactivate([])).resolves.toBe(0);

    // Una consulta con `IN ()` es un viaje a la base que no puede cambiar ninguna fila.
    expect(model.update).not.toHaveBeenCalled();
  });

  it('descarta las cadenas vacías, que tampoco identifican a ningún aparato', async () => {
    const { adapter, model } = build();

    await expect(adapter.deactivate(['', ''])).resolves.toBe(0);

    expect(model.update).not.toHaveBeenCalled();
  });

  it('el mismo token repetido se consulta UNA vez', async () => {
    const { adapter, model } = build();

    await adapter.deactivate(['t', 't', 't']);

    expect(huellasConsultadas(model)).toEqual([deviceTokenFingerprint('t')]);
  });

  /**
   * Sin acotar por tenant ni por cliente, y es deliberado: cuando Apple responde 410 ese aparato ya
   * no existe para NADIE. Si el mismo teléfono se registró bajo dos cuentas, las dos filas sobran.
   */
  it('no acota por tenant ni por cliente: un aparato muerto lo está para todos', async () => {
    const { adapter, model } = build();

    await adapter.deactivate(['t']);

    const [, options] = model.update.mock.calls[0] as [unknown, { where: Record<string, unknown> }];
    expect(Object.keys(options.where)).toEqual(['tokenHash', 'isActive']);
  });

  it('solo mira las filas activas, para no reescribir lo ya dado de baja', async () => {
    const { adapter, model } = build();

    await adapter.deactivate(['t']);

    const [, options] = model.update.mock.calls[0] as [unknown, { where: { isActive: boolean } }];
    expect(options.where.isActive).toBe(true);
  });

  it('propaga el fallo de la base en vez de tragárselo: quien llama decide qué hacer', async () => {
    const model = { update: jest.fn(async () => Promise.reject(new Error('base caida'))) };
    const adapter = new SequelizeDeviceTokenRegistryAdapter(model as never);

    await expect(adapter.deactivate(['t'])).rejects.toThrow('base caida');
  });
});
