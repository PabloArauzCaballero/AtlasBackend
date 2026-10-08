/**
 * @file Verifica la traducción HTTP de la foto de perfil hacia su servicio.
 * @business La foto se sirve por la API con su tipo y sin caché pública; sin foto, 404.
 * @system Prueba CustomerProfilePhotoController con un doble del servicio.
 */
import { describe, expect, it, jest } from '@jest/globals';
import { CustomerProfilePhotoController } from '../../../src/modules/customers/customer-profile-photo.controller.js';

const user = { sub: 'c-10', tenantId: '1', customerId: '10', role: 'customer' } as never;

function montar(foto: unknown) {
  const photos = {
    createUploadUrl: jest.fn(async (i: unknown) => i),
    confirm: jest.fn(async (i: unknown) => i),
    remove: jest.fn(async (i: unknown) => i),
    read: jest.fn(async () => foto),
  };
  return { photos, controller: new CustomerProfilePhotoController(photos as never) };
}

describe('CustomerProfilePhotoController', () => {
  it('delega permiso, confirmación y borrado con tenant, cliente y usuario', async () => {
    const { controller, photos } = montar(null);
    await controller.createUploadUrl('1', { customerId: '10' }, { contentType: 'image/jpeg', sizeBytes: 100 }, user);
    expect(photos.createUploadUrl).toHaveBeenCalledWith({
      tenantId: '1',
      customerId: '10',
      contentType: 'image/jpeg',
      sizeBytes: 100,
      currentUser: user,
    });
    await controller.confirm('1', { customerId: '10' }, { storageKey: 'k' }, user);
    expect(photos.confirm).toHaveBeenCalledWith({ tenantId: '1', customerId: '10', storageKey: 'k', currentUser: user });
    await controller.remove('1', { customerId: '10' }, user);
    expect(photos.remove).toHaveBeenCalledWith({ tenantId: '1', customerId: '10', currentUser: user });
  });

  it('sirve los bytes con su tipo y caché privada', async () => {
    const buffer = Buffer.from([1, 2, 3]);
    const { controller } = montar({ buffer, contentType: 'image/png' });
    const res = { setHeader: jest.fn(), end: jest.fn() };
    await controller.read('1', { customerId: '10' }, user, res as never);
    expect(res.setHeader).toHaveBeenCalledWith('content-type', 'image/png');
    expect(res.setHeader).toHaveBeenCalledWith('cache-control', 'private, max-age=86400');
    expect(res.end).toHaveBeenCalledWith(buffer);
  });

  it('sin foto responde 404', async () => {
    const { controller } = montar(null);
    await expect(controller.read('1', { customerId: '10' }, user, { setHeader: jest.fn(), end: jest.fn() } as never)).rejects.toThrow(
      'PROFILE_PHOTO_NOT_FOUND',
    );
  });
});
