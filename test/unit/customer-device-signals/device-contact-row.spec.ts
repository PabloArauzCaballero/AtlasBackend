import { describe, expect, it, jest } from '@jest/globals';

/**
 * La conversión de una ficha de agenda a la fila que se guarda, por lo que puede fallar en silencio.
 *
 * El cifrado se dobla: aquí no se prueba `encryptSecretEnvelope` —tiene sus propias specs— sino que
 * los campos correctos salgan cifrados y los correctos queden legibles. Esa frontera es toda la
 * política de privacidad de la tabla escrita en código: si un nombre acaba en una columna en claro,
 * nada falla, nadie se entera, y un volcado de la base entrega las libretas de direcciones de todos
 * los clientes.
 */
jest.mock('../../../src/common/utils/crypto/envelope-encryption.util.js', () => ({
  encryptSecretEnvelope: jest.fn(async (valor: string) => `cifrado(${valor})`),
}));

/** Se importa DENTRO de cada prueba: el mock del cifrado tiene que estar puesto antes de cargarlo. */
const cargar = async () =>
  (await import('../../../src/modules/customer-device-signals/application/device-contact-row.js')).toContactRow;

const contexto = {
  tenantId: '1',
  customerId: '9',
  deviceId: '5',
  sessionId: null,
  consentId: '77',
  capturedAt: new Date('2026-09-04T10:00:00.000Z'),
  receivedAt: new Date('2026-09-04T10:00:01.000Z'),
};

describe('toContactRow', () => {
  it('cifra la PII y deja legibles solo hashes y recuentos', async () => {
    const toContactRow = await cargar();
    const fila = await toContactRow(
      {
        externalId: 'abc',
        displayName: 'María Quispe',
        givenName: 'María',
        familyName: 'Quispe',
        company: 'Ferretería Sur',
        jobTitle: 'Dueña',
        birthday: '1985-03-09',
        contactType: 'person',
        isFavorite: false,
        phones: [{ label: 'móvil', number: '+591 76500122' }],
        emails: [{ label: 'trabajo', email: 'Maria@Ferreteria.BO' }],
        addresses: [],
      },
      contexto,
    );

    expect(fila.displayNameEncrypted).toBe('cifrado(María Quispe)');
    expect(fila.phonesEncrypted).toBe('cifrado([{"label":"móvil","number":"+591 76500122"}])');
    // Ni el nombre ni el número aparecen en claro en ninguna columna consultable.
    expect(JSON.stringify({ ...fila, phonesEncrypted: '', displayNameEncrypted: '' })).not.toContain('76500122');
    expect(JSON.stringify(fila)).not.toContain('Quispe"');
    expect(fila.phoneCount).toBe(1);
    expect(fila.primaryPhoneLast4).toBe('0122');
    expect(fila.birthday).toBe('1985-03-09');
  });

  it('normaliza el teléfono ANTES de hashear, para que el cruce encuentre algo', async () => {
    /*
      Es el fallo invisible de este módulo. Los hashes de la agenda se comparan contra los que el
      servidor guardó de las referencias declaradas; si aquí no se normaliza igual, el cruce no
      encuentra NUNCA nada, la señal de anillo de fraude sale cero y nada lo delata.
    */
    const toContactRow = await cargar();
    const conPrefijo = await toContactRow(
      { externalId: 'a', phones: [{ label: null, number: '+591 7650-0122' }], emails: [], addresses: [], displayName: 'X', givenName: null, familyName: null, company: null, jobTitle: null, birthday: null, contactType: 'person', isFavorite: false },
      contexto,
    );
    const sinPrefijo = await toContactRow(
      { externalId: 'b', phones: [{ label: null, number: '76500122' }], emails: [], addresses: [], displayName: 'X', givenName: null, familyName: null, company: null, jobTitle: null, birthday: null, contactType: 'person', isFavorite: false },
      contexto,
    );
    expect(conPrefijo.primaryPhoneHash).toBe(sinPrefijo.primaryPhoneHash);
    expect(conPrefijo.phoneHashes).toEqual(sinPrefijo.phoneHashes);
  });

  it('descarta números que no lo son y deja cuadrado el recuento con los hashes', async () => {
    // La tabla tiene un CHECK que exige `phone_count = cardinality(phone_hashes)`. Si aquí se
    // contaran los números de entrada en vez de los hashes resultantes, la inserción reventaría
    // contra la restricción con una ficha que trae una extensión de tres dígitos.
    const toContactRow = await cargar();
    const fila = await toContactRow(
      { externalId: 'c', phones: [{ label: null, number: '123' }, { label: null, number: '76500122' }], emails: [], addresses: [], displayName: 'X', givenName: null, familyName: null, company: null, jobTitle: null, birthday: null, contactType: 'person', isFavorite: false },
      contexto,
    );
    expect(fila.phoneCount).toBe(fila.phoneHashes.length);
    expect(fila.phoneCount).toBe(1);
  });

  it('deduplica y ordena los hashes, para que resincronizar no parezca un cambio', async () => {
    const toContactRow = await cargar();
    const fila = await toContactRow(
      { externalId: 'd', phones: [{ label: 'casa', number: '76500122' }, { label: 'móvil', number: '+591 76500122' }], emails: [], addresses: [], displayName: 'X', givenName: null, familyName: null, company: null, jobTitle: null, birthday: null, contactType: 'person', isFavorite: false },
      contexto,
    );
    expect(fila.phoneHashes).toHaveLength(1);
  });

  it('no cifra nada cuando el campo viene vacío, en vez de guardar un sobre con la cadena vacía', async () => {
    const toContactRow = await cargar();
    const fila = await toContactRow(
      { externalId: 'e', phones: [], emails: [], addresses: [], displayName: null, givenName: null, familyName: null, company: null, jobTitle: null, birthday: null, contactType: 'unknown', isFavorite: false },
      contexto,
    );
    expect(fila.displayNameEncrypted).toBeNull();
    expect(fila.phonesEncrypted).toBeNull();
    expect(fila.primaryPhoneHash).toBeNull();
    expect(fila.phoneHashes).toEqual([]);
  });
});
