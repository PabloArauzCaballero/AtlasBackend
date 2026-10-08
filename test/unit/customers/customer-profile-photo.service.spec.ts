/**
 * @file Verifica la foto de perfil del cliente: permiso de subida, confirmación con verificación del objeto, lectura y borrado.
 * @business Una foto que no es imagen, de otro cliente o con malware nunca queda como foto de nadie.
 * @system Prueba CustomerProfilePhotoService con dobles del repositorio, el almacén y el antivirus.
 */
import { describe, expect, it, jest } from '@jest/globals';
import {
  CustomerProfilePhotoService,
  esClaveDeFotoDelCliente,
  MAX_PROFILE_PHOTO_BYTES,
  tipoDeImagen,
} from '../../../src/modules/customers/application/customer-profile-photo.service.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const yo = { sub: 'c-10', tenantId: '1', customerId: '10', role: 'customer' } as never;
const otro = { sub: 'c-11', tenantId: '1', customerId: '11', role: 'customer' } as never;
const CLAVE = '1/10/profile-photo/abc.jpg';

function montar({
  objeto = JPEG as Buffer | null,
  scan = { status: 'clean' } as { status: string },
  fotoAnterior = null as string | null,
} = {}) {
  const customer = {
    profilePhotoKey: fotoAnterior,
    profilePhotoUpdatedAt: null as Date | null,
    update: jest.fn(async (cambios: Record<string, unknown>) => Object.assign(customer, cambios)),
  };
  const repo = { findById: jest.fn(async (..._a: unknown[]) => customer as typeof customer | null) };
  const storage = {
    createUploadTicket: jest.fn((i: unknown) => ({ ticket: i })),
    readObject: jest.fn(async (..._a: unknown[]) => objeto),
    deleteObject: jest.fn(async (..._a: unknown[]) => true),
  };
  const malware = { scan: jest.fn(async () => scan), failsClosed: jest.fn(() => true) };
  const service = new CustomerProfilePhotoService(repo as never, storage as never, malware as never);
  return { service, customer, storage, repo };
}

describe('foto de perfil', () => {
  it('la clave tiene que ser de la carpeta de fotos de ESTE cliente', () => {
    expect(esClaveDeFotoDelCliente(CLAVE, '1', '10')).toBe(true);
    expect(esClaveDeFotoDelCliente('1/11/profile-photo/abc.jpg', '1', '10')).toBe(false);
    expect(esClaveDeFotoDelCliente('1/10/identity/abc.jpg', '1', '10')).toBe(false);
    expect(esClaveDeFotoDelCliente('1/10/profile-photo/../x/abc.jpg', '1', '10')).toBe(false);
    expect(esClaveDeFotoDelCliente('2/10/profile-photo/abc.jpg', '1', '10')).toBe(false);
  });

  it('reconoce JPEG y PNG por sus bytes, no por lo que diga quien sube', () => {
    expect(tipoDeImagen(JPEG)).toBe('image/jpeg');
    expect(tipoDeImagen(PNG)).toBe('image/png');
    expect(tipoDeImagen(Buffer.from('%PDF-1.7 hola'))).toBeNull();
  });

  it('emite el permiso en la carpeta del cliente y rechaza lo que pase de 5 MB', async () => {
    const { service, storage } = montar();
    await service.createUploadUrl({ tenantId: '1', customerId: '10', contentType: 'image/jpeg', sizeBytes: 1000, currentUser: yo });
    expect(storage.createUploadTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: '1',
        subjectId: '10',
        documentType: 'profile-photo',
        contentType: 'image/jpeg',
        sizeBytes: 1000,
      }),
    );
    await expect(
      service.createUploadUrl({
        tenantId: '1',
        customerId: '10',
        contentType: 'image/jpeg',
        sizeBytes: MAX_PROFILE_PHOTO_BYTES + 1,
        currentUser: yo,
      }),
    ).rejects.toThrow('PROFILE_PHOTO_TOO_LARGE');
  });

  it('otro cliente no puede pedir permiso ni fijar la foto de alguien más', async () => {
    const { service } = montar();
    await expect(
      service.createUploadUrl({ tenantId: '1', customerId: '10', contentType: 'image/png', sizeBytes: 10, currentUser: otro }),
    ).rejects.toThrow();
    await expect(service.confirm({ tenantId: '1', customerId: '10', storageKey: CLAVE, currentUser: otro })).rejects.toThrow();
  });

  it('confirma una imagen sana, la guarda y borra la anterior', async () => {
    const { service, customer, storage } = montar({ fotoAnterior: '1/10/profile-photo/vieja.jpg' });
    const r = await service.confirm({ tenantId: '1', customerId: '10', storageKey: CLAVE, currentUser: yo });
    expect(r.hasPhoto).toBe(true);
    expect(customer.profilePhotoKey).toBe(CLAVE);
    expect(customer.profilePhotoUpdatedAt).toBeInstanceOf(Date);
    expect(storage.deleteObject).toHaveBeenCalledWith('1/10/profile-photo/vieja.jpg');
  });

  it('rechaza una clave ajena, un objeto que no llegó, algo que no es imagen y lo que marca el antivirus', async () => {
    await expect(
      montar().service.confirm({ tenantId: '1', customerId: '10', storageKey: '1/11/profile-photo/a.jpg', currentUser: yo }),
    ).rejects.toThrow('PROFILE_PHOTO_KEY_NOT_ALLOWED');
    await expect(
      montar({ objeto: null }).service.confirm({ tenantId: '1', customerId: '10', storageKey: CLAVE, currentUser: yo }),
    ).rejects.toThrow('PROFILE_PHOTO_NOT_UPLOADED');
    const noImagen = montar({ objeto: Buffer.from('%PDF-1.7') });
    await expect(noImagen.service.confirm({ tenantId: '1', customerId: '10', storageKey: CLAVE, currentUser: yo })).rejects.toThrow(
      'PROFILE_PHOTO_NOT_AN_IMAGE',
    );
    expect(noImagen.storage.deleteObject).toHaveBeenCalledWith(CLAVE);
    const infectada = montar({ scan: { status: 'infected' } });
    await expect(infectada.service.confirm({ tenantId: '1', customerId: '10', storageKey: CLAVE, currentUser: yo })).rejects.toThrow(
      'PROFILE_PHOTO_REJECTED',
    );
    expect(infectada.customer.profilePhotoKey).toBeNull();
  });

  it('lee los bytes con su tipo, y nada si no hay foto', async () => {
    const con = montar({ fotoAnterior: CLAVE, objeto: PNG });
    expect(await con.service.read({ tenantId: '1', customerId: '10', currentUser: yo })).toEqual({ buffer: PNG, contentType: 'image/png' });
    expect(await montar().service.read({ tenantId: '1', customerId: '10', currentUser: yo })).toBeNull();
  });

  it('quitar la foto la deja en null y borra el objeto', async () => {
    const { service, customer, storage } = montar({ fotoAnterior: CLAVE });
    expect(await service.remove({ tenantId: '1', customerId: '10', currentUser: yo })).toEqual({ hasPhoto: false });
    expect(customer.profilePhotoKey).toBeNull();
    expect(storage.deleteObject).toHaveBeenCalledWith(CLAVE);
  });

  it('un 404 del cliente es 404', async () => {
    const { service, repo } = montar();
    repo.findById.mockResolvedValueOnce(null as never);
    await expect(service.read({ tenantId: '1', customerId: '10', currentUser: yo })).rejects.toThrow('Cliente no encontrado');
  });
});
