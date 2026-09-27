/**
 * @file Servicio de aplicación: las imágenes que cada persona sintética sube en una corrida.
 * @business Esta pieza hace que el carnet y la selfie que sube la persona «Wara Quispe Mamani»
 *   lleven SU nombre y SU documento (los dibuja el mock), y que una corrida no se caiga porque el
 *   mock no sepa dibujar: entonces sube la imagen genérica y lo deja escrito en la evidencia.
 * @system una petición al mock por persona y corrida (caché), antes del primer paso: el tamaño de
 *   cada imagen entra al scope como `uploads.<tipo>.sizeBytes`, que es lo que declara el paso que
 *   pide la URL firmada; la subida usa los MISMOS bytes. El QR de cobro es siempre el genérico.
 */
import { UPLOAD_IMAGE_KINDS, type UploadImageKind } from '../domain/journey-recipe.types.js';
import { readOptional, type BindingScope } from '../domain/typed-bindings.js';
import type { Persona } from '../domain/persona-factory.js';
import { syntheticImage, SYNTHETIC_UPLOAD_BYTES } from '../fixtures/synthetic-upload.js';
import {
  MOCK_IDENTITY_IMAGE_KINDS,
  type MockIdentityImageKind,
  type MockIdentityImages,
  type MockIdentityPersona,
} from '../infrastructure/mock-control.client.js';

export type UploadImage = { bytes: Uint8Array; sha256: string; sizeBytes: number; source: 'mock' | 'fixture' };
export type PersonaUploads = Partial<Record<UploadImageKind, UploadImage>>;

/** Puerto hacia el mock: el `MockControlClient` lo cumple. */
export interface IdentityImagesPort {
  identityImages(tenantId: string, persona: MockIdentityPersona): Promise<MockIdentityImages>;
}

/** Resumen para `evidence_json.identityImages`: cuántas personas con imágenes del mock y por qué no. */
export type UploadImagesSummary = { mock: number; fixture: number; version: string | null; fallbackReasons: Record<string, number> };

const isIdentity = (kind: UploadImageKind): kind is MockIdentityImageKind =>
  (MOCK_IDENTITY_IMAGE_KINDS as readonly string[]).includes(kind);

function fixtureImage(kind: UploadImageKind, personaKey: string): UploadImage {
  return { ...syntheticImage(kind, personaKey), sizeBytes: SYNTHETIC_UPLOAD_BYTES, source: 'fixture' };
}

export class PersonaUploadImages {
  private readonly cache = new Map<string, Promise<PersonaUploads>>();
  private readonly stats: UploadImagesSummary = { mock: 0, fixture: 0, version: null, fallbackReasons: {} };

  /**
   * @param kinds imágenes que la receta usa (vacío = no hay nada que pedir al mock).
   * @param onFallback se llama la PRIMERA vez que la corrida cae a la imagen genérica.
   */
  constructor(
    private readonly options: {
      tenantId: string;
      kinds: readonly UploadImageKind[];
      source: IdentityImagesPort | null;
      onFallback?: (input: { personaKey: string; reason: string }) => Promise<void> | void;
    },
  ) {}

  /** Imágenes de la persona, pedidas una sola vez por corrida aunque se llame varias. */
  forPersona(persona: Persona): Promise<PersonaUploads> {
    const cached = this.cache.get(persona.personaKey);
    if (cached) return cached;
    const pending = this.resolve(persona);
    this.cache.set(persona.personaKey, pending);
    return pending;
  }

  summary(): UploadImagesSummary | null {
    return this.stats.mock + this.stats.fixture > 0 ? { ...this.stats, fallbackReasons: { ...this.stats.fallbackReasons } } : null;
  }

  private async resolve(persona: Persona): Promise<PersonaUploads> {
    const uploads: PersonaUploads = {};
    for (const kind of this.options.kinds) uploads[kind] = fixtureImage(kind, persona.personaKey);
    if (!this.options.kinds.some(isIdentity)) return uploads;
    const result = await this.fetch(persona);
    if (!result.ok) {
      await this.fellBack(persona.personaKey, result.reason);
      return uploads;
    }
    this.stats.mock += 1;
    this.stats.version = result.version;
    for (const kind of this.options.kinds.filter(isIdentity)) {
      const image = result.images[kind];
      uploads[kind] = { bytes: image.bytes, sha256: image.sha256, sizeBytes: image.bytes.length, source: 'mock' };
    }
    return uploads;
  }

  private async fetch(persona: Persona): Promise<MockIdentityImages> {
    if (!this.options.source) return { ok: false, reason: 'MOCK_NOT_CONFIGURED' };
    try {
      return await this.options.source.identityImages(this.options.tenantId, {
        personaKey: persona.personaKey,
        firstName: persona.firstName,
        lastName: [persona.lastName, persona.secondLastName].filter(Boolean).join(' '),
        documentNumber: persona.documentNumber,
        birthDate: persona.birthDate,
        sex: persona.sex,
        city: persona.city,
      });
    } catch (error) {
      return { ok: false, reason: `ERROR:${(error as Error).message}`.slice(0, 120) };
    }
  }

  private async fellBack(personaKey: string, reason: string): Promise<void> {
    const first = this.stats.fixture === 0;
    this.stats.fixture += 1;
    this.stats.fallbackReasons[reason] = (this.stats.fallbackReasons[reason] ?? 0) + 1;
    // Un aviso por corrida basta: el conteo por motivo queda en el resumen de la evidencia.
    if (first) await Promise.resolve(this.options.onFallback?.({ personaKey, reason })).catch(() => undefined);
  }
}

/**
 * `scope.uploads`: por tipo, bytes + tamaño + hash + origen. Los bindings sólo pueden leer
 * `sizeBytes` (lo impone la validación de recetas), así que los bytes nunca acaban en un cuerpo.
 */
export function uploadsScope(uploads: PersonaUploads): Record<string, UploadImage> {
  return Object.fromEntries(UPLOAD_IMAGE_KINDS.flatMap((kind) => (uploads[kind] ? [[kind, uploads[kind]]] : [])));
}

/**
 * La imagen que el worker resolvió para esta persona (`scope.uploads`, la misma cuyo tamaño declaró
 * el paso de la URL firmada); sin ella, la genérica del tamaño fijo de siempre.
 */
export function uploadImageFor(
  scope: BindingScope,
  kind: UploadImageKind,
  personaKey: string,
): { bytes: Uint8Array; sha256: string; source: UploadImage['source'] } {
  const resolved = readOptional(scope, `uploads.${kind}`) as Partial<UploadImage> | undefined;
  if (resolved && resolved.bytes instanceof Uint8Array && typeof resolved.sha256 === 'string')
    return { bytes: resolved.bytes, sha256: resolved.sha256, source: resolved.source === 'mock' ? 'mock' : 'fixture' };
  return { ...syntheticImage(kind, personaKey), source: 'fixture' };
}
