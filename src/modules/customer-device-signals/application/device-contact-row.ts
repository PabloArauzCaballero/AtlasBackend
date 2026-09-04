/**
 * @file Conversión pura: de la ficha que manda el teléfono a la fila que se guarda.
 * @business Esta pieza decide qué de cada contacto queda legible y qué se guarda cifrado.
 * @system cifra los campos con nombre propio, normaliza y hashea números y correos, y cuenta.
 */
import { normalizeEmailForHash, normalizePhoneForHash } from '../../../common/utils/contact/phone-normalization.util.js';
import { encryptSecretEnvelope } from '../../../common/utils/crypto/envelope-encryption.util.js';
import { hashSensitiveText, lastCharacters } from '../../../common/utils/crypto/hash.util.js';
import { type ContactRow } from '../repositories/customer-device-contacts.repository.js';
import { type DeviceContactDto } from '../customer-device-signals.schemas.js';

/** El contexto que la ficha no trae y la fila necesita: de quién es, de qué teléfono y con qué permiso. */
export type ContactRowContext = {
  tenantId: string;
  customerId: string;
  deviceId: string | null;
  sessionId: string | null;
  consentId: string;
  capturedAt: Date;
  receivedAt: Date;
};

/**
 * De la ficha que manda el teléfono a la fila que se guarda.
 *
 * Todo lo que identifica a una persona sale cifrado; lo que queda en claro son hashes y
 * recuentos. `primaryPhone` es el PRIMER número de la ficha y no el «mejor»: elegir por criterio
 * —el móvil sobre el fijo, por ejemplo— daría un primario distinto según el país y rompería la
 * comparación entre expedientes.
 */
export async function toContactRow(
  contacto: DeviceContactDto,
  contexto: ContactRowContext,
): Promise<ContactRow> {
  const numeros = contacto.phones
    .map((telefono) => ({ ...telefono, normalized: normalizePhoneForHash(telefono.number) }))
    .filter((telefono): telefono is typeof telefono & { normalized: string } => telefono.normalized !== null);
  const correos = contacto.emails
    .map((correo) => ({ ...correo, normalized: normalizeEmailForHash(correo.email) }))
    .filter((correo): correo is typeof correo & { normalized: string } => correo.normalized !== null);

  // Distintos y en orden estable: el mismo contacto leído dos veces tiene que dar el mismo array,
  // o cada sincronización parecería un cambio.
  const phoneHashes = [...new Set(numeros.map((telefono) => hashSensitiveText(telefono.normalized)))].sort();
  const emailHashes = [...new Set(correos.map((correo) => hashSensitiveText(correo.normalized)))].sort();
  const primario = numeros[0] ?? null;

  const cifrar = (valor: string | null | undefined): Promise<string> | null =>
    valor === null || valor === undefined || valor === '' ? null : encryptSecretEnvelope(valor);

  const [displayName, givenName, familyName, company, jobTitle, phones, emails, addresses] = await Promise.all([
    cifrar(contacto.displayName),
    cifrar(contacto.givenName),
    cifrar(contacto.familyName),
    cifrar(contacto.company),
    cifrar(contacto.jobTitle),
    contacto.phones.length > 0 ? encryptSecretEnvelope(JSON.stringify(contacto.phones)) : null,
    contacto.emails.length > 0 ? encryptSecretEnvelope(JSON.stringify(contacto.emails)) : null,
    contacto.addresses.length > 0 ? encryptSecretEnvelope(JSON.stringify(contacto.addresses)) : null,
  ]);

  return {
    tenantId: contexto.tenantId,
    customerId: contexto.customerId,
    computationRunId: null,
    deviceId: contexto.deviceId,
    sessionId: contexto.sessionId,
    consentId: contexto.consentId,
    contactExternalIdHash: hashSensitiveText(contacto.externalId),
    displayNameEncrypted: displayName,
    givenNameEncrypted: givenName,
    familyNameEncrypted: familyName,
    companyEncrypted: company,
    jobTitleEncrypted: jobTitle,
    phonesEncrypted: phones,
    emailsEncrypted: emails,
    addressesEncrypted: addresses,
    displayNameHash: contacto.displayName ? hashSensitiveText(contacto.displayName) : null,
    primaryPhoneHash: primario ? hashSensitiveText(primario.normalized) : null,
    primaryPhoneLast4: primario ? lastCharacters(primario.normalized, 4) : null,
    phoneHashes,
    emailHashes,
    phoneCount: phoneHashes.length,
    emailCount: emailHashes.length,
    addressCount: contacto.addresses.length,
    birthday: contacto.birthday ?? null,
    isFavorite: contacto.isFavorite,
    contactType: contacto.contactType,
    capturedAt: contexto.capturedAt,
    receivedAt: contexto.receivedAt,
  };
}
