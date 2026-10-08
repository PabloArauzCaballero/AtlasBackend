/**
 * @file Servicio de aplicación: la foto de perfil del cliente.
 * @business La persona pone su cara en su cuenta; la app la enseña en Perfil y en el saludo de Inicio.
 * @system emite el permiso de subida, comprueba el objeto subido (tamaño, bytes de imagen, antivirus), guarda su clave en
 *   `customers` y la sirve por la API (https, con el token), sin exponer URLs del almacén al teléfono.
 */
import { BadRequestException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { DocumentStorageService, matchesMagicBytes, type UploadTicket } from '../../../common/storage/document-storage.service.js';
import { MalwareScannerService } from '../../../common/storage/malware-scanner.service.js';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResource, assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import type { CustomerModel } from '../../../database/models/index.js';
import { CustomersRepository } from '../customers.repository.js';

/** Una foto de perfil no necesita más: la app la recorta cuadrada y la comprime antes de subirla. */
export const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;
export const PROFILE_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
export type ProfilePhotoMimeType = (typeof PROFILE_PHOTO_MIME_TYPES)[number];

const CARPETA = 'profile-photo';

/** La clave sólo vale si cae en la carpeta de fotos de ESTE cliente: nadie fija como foto un objeto ajeno. */
export function esClaveDeFotoDelCliente(storageKey: string, tenantId: string, customerId: string): boolean {
  const prefijo = `${tenantId}/${customerId}/${CARPETA}/`;
  return storageKey.startsWith(prefijo) && !storageKey.slice(prefijo.length).includes('/') && !storageKey.includes('..');
}

export function tipoDeImagen(buffer: Buffer): ProfilePhotoMimeType | null {
  if (matchesMagicBytes(buffer, 'image/jpeg')) return 'image/jpeg';
  if (matchesMagicBytes(buffer, 'image/png')) return 'image/png';
  return null;
}

@Injectable()
export class CustomerProfilePhotoService {
  private readonly logger = new Logger(CustomerProfilePhotoService.name);

  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly storage: DocumentStorageService,
    private readonly malwareScanner: MalwareScannerService,
  ) {}

  async createUploadUrl(input: {
    tenantId: string;
    customerId: string;
    contentType: ProfilePhotoMimeType;
    sizeBytes: number;
    currentUser: AuthenticatedUser;
  }): Promise<UploadTicket> {
    assertOwnCustomerResource(input.currentUser, input.customerId);
    if (input.sizeBytes > MAX_PROFILE_PHOTO_BYTES) throw new UnprocessableEntityException('PROFILE_PHOTO_TOO_LARGE');
    await this.cliente(input.tenantId, input.customerId);
    return this.storage.createUploadTicket({
      tenantId: input.tenantId,
      subjectId: input.customerId,
      documentType: CARPETA,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
    });
  }

  /** Fija como foto el objeto ya subido, después de comprobar que es una imagen sana, y borra la anterior. */
  async confirm(input: { tenantId: string; customerId: string; storageKey: string; currentUser: AuthenticatedUser }) {
    assertOwnCustomerResource(input.currentUser, input.customerId);
    if (!esClaveDeFotoDelCliente(input.storageKey, input.tenantId, input.customerId)) {
      throw new BadRequestException('PROFILE_PHOTO_KEY_NOT_ALLOWED');
    }
    const customer = await this.cliente(input.tenantId, input.customerId);
    const buffer = await this.storage.readObject(input.storageKey);
    if (!buffer) throw new UnprocessableEntityException('PROFILE_PHOTO_NOT_UPLOADED');
    if (buffer.byteLength > MAX_PROFILE_PHOTO_BYTES) throw new UnprocessableEntityException('PROFILE_PHOTO_TOO_LARGE');
    if (!tipoDeImagen(buffer)) {
      await this.storage.deleteObject(input.storageKey).catch(() => false);
      throw new UnprocessableEntityException('PROFILE_PHOTO_NOT_AN_IMAGE');
    }
    const scan = await this.malwareScanner.scan(buffer);
    if (scan.status === 'infected' || (scan.status === 'error' && this.malwareScanner.failsClosed())) {
      await this.storage.deleteObject(input.storageKey).catch(() => false);
      throw new UnprocessableEntityException('PROFILE_PHOTO_REJECTED');
    }

    const anterior = customer.profilePhotoKey;
    const ahora = new Date();
    await customer.update({ profilePhotoKey: input.storageKey, profilePhotoUpdatedAt: ahora });
    if (anterior && anterior !== input.storageKey) await this.borrarSinRomper(anterior);
    return { hasPhoto: true, updatedAt: ahora.toISOString() };
  }

  async remove(input: { tenantId: string; customerId: string; currentUser: AuthenticatedUser }) {
    assertOwnCustomerResource(input.currentUser, input.customerId);
    const customer = await this.cliente(input.tenantId, input.customerId);
    const anterior = customer.profilePhotoKey;
    await customer.update({ profilePhotoKey: null, profilePhotoUpdatedAt: new Date() });
    if (anterior) await this.borrarSinRomper(anterior);
    return { hasPhoto: false };
  }

  /** Los bytes de la foto, para servirlos por la API. `null` si no tiene. */
  async read(input: { tenantId: string; customerId: string; currentUser: AuthenticatedUser }) {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);
    const customer = await this.cliente(input.tenantId, input.customerId);
    if (!customer.profilePhotoKey) return null;
    const buffer = await this.storage.readObject(customer.profilePhotoKey);
    if (!buffer) return null;
    return { buffer, contentType: tipoDeImagen(buffer) ?? 'image/jpeg' };
  }

  private async cliente(tenantId: string, customerId: string): Promise<CustomerModel> {
    const customer = await this.customersRepository.findById(tenantId, customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');
    return customer;
  }

  /** Un objeto viejo que no se pudo borrar no puede impedir cambiar la foto: se registra y se sigue. */
  private async borrarSinRomper(storageKey: string): Promise<void> {
    try {
      await this.storage.deleteObject(storageKey);
    } catch (error) {
      this.logger.warn(`No se pudo borrar la foto anterior ${storageKey}: ${(error as Error).message}`);
    }
  }
}
