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

/** `undefined` = «esta captura no lo manda»: la fila guardada conserva lo que tenía (ver `repository.update`). */
const siVino = <T, R>(valor: T | undefined, convertir: (v: T) => R): R | undefined => (valor === undefined ? undefined : convertir(valor));

/**
 * De la ficha que manda el teléfono a la fila que se guarda.
 *
 * Todo lo que identifica a una persona sale cifrado; lo que queda en claro son hashes, recuentos y banderas.
 * `primaryPhone` es el PRIMER número de la ficha y no el «mejor»: elegir por criterio —el móvil sobre el fijo,
 * por ejemplo— daría un primario distinto según el país y rompería la comparación entre expedientes.
 *
 * ## Lo que la captura no trae no se borra
 *
 * La 2.0.0 (minimización) ya no manda correos, cumpleaños, empresa, cargo, nombres sueltos ni direcciones. Un
 * campo AUSENTE sale `undefined` y el repositorio no lo toca; uno presente —aunque sea `null` o `[]`— sí se
 * sobrescribe, porque eso es la agenda diciendo «ya no lo tiene». Las banderas `hasEmail`/`hasBirthday`/`hasCompany`
 * se guardan siempre que se puedan saber: de la bandera si vino, del dato si vino el dato.
 */
export async function toContactRow(contacto: DeviceContactDto, contexto: ContactRowContext): Promise<ContactRow> {
  const numeros = contacto.phones
    .map((telefono) => ({ ...telefono, normalized: normalizePhoneForHash(telefono.number) }))
    .filter((telefono): telefono is typeof telefono & { normalized: string } => telefono.normalized !== null);
  const correos = contacto.emails
    ?.map((correo) => ({ ...correo, normalized: normalizeEmailForHash(correo.email) }))
    .filter((correo): correo is typeof correo & { normalized: string } => correo.normalized !== null);

  // Distintos y en orden estable: el mismo contacto leído dos veces tiene que dar el mismo array,
  // o cada sincronización parecería un cambio.
  const phoneHashes = [...new Set(numeros.map((telefono) => hashSensitiveText(telefono.normalized)))].sort();
  const emailHashes = correos && [...new Set(correos.map((correo) => hashSensitiveText(correo.normalized)))].sort();
  const primario = numeros[0] ?? null;

  const cifrar = (valor: string | null | undefined): Promise<string | null> | undefined =>
    valor === undefined ? undefined : valor === null || valor === '' ? Promise.resolve(null) : encryptSecretEnvelope(valor);
  const cifrarLista = (lista: readonly unknown[] | undefined): Promise<string | null> | undefined =>
    lista === undefined ? undefined : lista.length > 0 ? encryptSecretEnvelope(JSON.stringify(lista)) : Promise.resolve(null);

  const [displayName, givenName, familyName, company, jobTitle, phones, emails, addresses] = await Promise.all([
    cifrar(contacto.displayName),
    cifrar(contacto.givenName),
    cifrar(contacto.familyName),
    cifrar(contacto.company),
    cifrar(contacto.jobTitle),
    contacto.phones.length > 0 ? encryptSecretEnvelope(JSON.stringify(contacto.phones)) : null,
    cifrarLista(contacto.emails),
    cifrarLista(contacto.addresses),
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
    displayNameHash: siVino(contacto.displayName, (nombre) => (nombre ? hashSensitiveText(nombre) : null)),
    primaryPhoneHash: primario ? hashSensitiveText(primario.normalized) : null,
    primaryPhoneLast4: primario ? lastCharacters(primario.normalized, 4) : null,
    phoneHashes,
    emailHashes,
    phoneCount: phoneHashes.length,
    emailCount: emailHashes?.length,
    addressCount: contacto.addresses?.length,
    birthday: siVino(contacto.birthday, (fecha) => fecha ?? null),
    hasEmail: contacto.hasEmail ?? siVino(emailHashes, (hashes) => hashes.length > 0),
    hasBirthday: contacto.hasBirthday ?? siVino(contacto.birthday, (fecha) => fecha !== null && fecha !== undefined),
    hasCompany: contacto.hasCompany ?? siVino(contacto.company, (empresa) => Boolean(empresa)),
    isFavorite: contacto.isFavorite,
    contactType: contacto.contactType,
    capturedAt: contexto.capturedAt,
    receivedAt: contexto.receivedAt,
  };
}
