import { describe, expect, it, jest } from '@jest/globals';
import { CustomerContactsSnapshotService } from '../../../src/modules/customer-onboarding/application/customer-contacts-snapshot.service.js';
import { CustomerContactsSnapshotRepository } from '../../../src/modules/customer-onboarding/repositories/customer-contacts-snapshot.repository.js';
import { contactsSnapshotSchema } from '../../../src/modules/customer-onboarding/customer-contacts-snapshot.schemas.js';
import type { ContactsSnapshotDto } from '../../../src/modules/customer-onboarding/customer-contacts-snapshot.schemas.js';

/**
 * El snapshot AGREGADO de la agenda del teléfono.
 *
 * Lo que estas pruebas defienden no es el cálculo —es una suma— sino la PROMESA: que aquí no entra
 * ni un dato personal de un tercero, y que los hashes de un solo uso no sobreviven a la petición.
 *
 * Es una promesa que hay que poder demostrar, porque las personas de la agenda de alguien no
 * consintieron nada, no son clientes nuestros y muchas ni saben que existimos. La única versión de
 * esta señal que se puede defender ante quien la firma es la que no se lleva su libreta.
 */
describe('CustomerContactsSnapshotService', () => {
  const CUSTOMER = 'c1';
  const TENANT = 't1';

  const SNAPSHOT: ContactsSnapshotDto = contactsSnapshotSchema.parse({
    granted: true,
    algorithmVersion: 'contacts-snapshot-1.0.0',
    computedAt: '2026-08-26T12:00:00.000Z',
    totalContacts: 180,
    contactsWithPhone: 150,
    uniquePhoneCount: 141,
    bolivianPhoneCount: 129,
    referencesFoundInAddressBook: 2,
    referencesDeclared: 2,
    phoneHashes: ['a'.repeat(64), 'b'.repeat(64)],
  });

  function build(overrides: { conocidos?: { watchlist: number; otherApplicants: number } } = {}) {
    const creados: Array<Record<string, unknown>> = [];
    const metricas: Array<Record<string, unknown>> = [];
    const snapshots = {
      countKnownPhoneHashes: jest.fn(async (..._args: unknown[]) =>
        overrides.conocidos ?? { watchlist: 0, otherApplicants: 0 },
      ),
      createRun: jest.fn(async (valores: unknown) => {
        creados.push(valores as Record<string, unknown>);
        return { id: 'run-1' };
      }),
      createMetric: jest.fn(async (valores: unknown) => {
        metricas.push(valores as Record<string, unknown>);
        return { id: 'metric' };
      }),
      findLatestRun: jest.fn(async (..._args: unknown[]) => null),
      findMetrics: jest.fn(async (..._args: unknown[]) => []),
    };
    const onboardingRepository = {
      findLatestOnboardingFlow: jest.fn(async (..._args: unknown[]) => ({ id: 'flow-1' })),
      createOnboardingStepEvent: jest.fn(),
      createOperationalAuditLog: jest.fn(),
    };
    const customersRepository = {
      findById: jest.fn(async (..._args: unknown[]) => ({ id: CUSTOMER })),
    };
    // La transacción se ejecuta en el acto: lo que se prueba es la política, no Sequelize.
    const sequelize = { transaction: jest.fn(async (fn: unknown) => (fn as (t: unknown) => unknown)({})) };

    const service = new CustomerContactsSnapshotService(
      customersRepository as never,
      onboardingRepository as never,
      snapshots as never,
      sequelize as never,
    );
    return { service, snapshots, onboardingRepository, creados, metricas };
  }

  const usuario = { role: 'customer', customerId: CUSTOMER } as never;

  it('deja constancia de que los contactos crudos NO se guardaron', async () => {
    /*
     * Las dos banderas van a `false` por CONSTRUCCIÓN, no por configuración: el repositorio no
     * acepta un valor para ellas. Que la FILA lo afirme importa el día que alguien tenga que
     * demostrarlo —una auditoría, una solicitud de acceso, una consulta del regulador—: la
     * alternativa es revisar el código de la versión que corría entonces.
     *
     * Se ejercita el repositorio REAL con el modelo doblado, porque la garantía vive ahí. Probarla
     * contra un repositorio doblado sería probar el doble.
     */
    const runModel = { create: jest.fn(async (valores: unknown) => ({ id: 'run-1', ...(valores as object) })) };
    const repository = new CustomerContactsSnapshotRepository(
      runModel as never,
      { create: jest.fn() } as never,
      { count: jest.fn() } as never,
      { count: jest.fn() } as never,
    );

    await repository.createRun({
      tenantId: TENANT,
      customerId: CUSTOMER,
      onboardingFlowId: null,
      sessionId: null,
      algorithmVersion: 'contacts-snapshot-1.0.0',
      computedAtDevice: new Date('2026-08-26T12:00:00.000Z'),
      receivedAtServer: new Date('2026-08-26T12:00:01.000Z'),
      status: 'completed',
      integrityHash: 'x'.repeat(64),
    });

    const fila = (runModel.create.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
    expect(fila.rawContactsStored).toBe(false);
    expect(fila.rawSmsStored).toBe(false);
    expect(fila.algorithmCode).toBe('CONTACTS_ADDRESS_BOOK_SNAPSHOT');
  });

  it('los hashes se cruzan y NO se persisten', async () => {
    /*
     * La afirmación central de este módulo. Un hash de teléfono es reversible por fuerza bruta —el
     * espacio de números es pequeño— así que guardarlo sería casi tan malo como guardar el número.
     * Se comprueba mirando TODO lo que se escribió: ninguna métrica ni ninguna fila de ejecución
     * puede contener uno.
     */
    const { service, snapshots, creados, metricas } = build();
    await service.submit({ tenantId: TENANT, customerId: CUSTOMER, body: SNAPSHOT, currentUser: usuario, ipAddress: null });

    expect(snapshots.countKnownPhoneHashes).toHaveBeenCalledTimes(1);

    const escrito = JSON.stringify([...creados, ...metricas]);
    for (const hash of SNAPSHOT.phoneHashes ?? []) {
      expect(escrito).not.toContain(hash);
    }
  });

  it('el evento de alta registra CUÁNTOS hashes se cruzaron, nunca cuáles', async () => {
    const { service, onboardingRepository } = build();
    await service.submit({ tenantId: TENANT, customerId: CUSTOMER, body: SNAPSHOT, currentUser: usuario, ipAddress: null });

    const evento = (onboardingRepository.createOnboardingStepEvent.mock.calls[0]?.[0] ?? {}) as {
      payloadJson?: Record<string, unknown>;
    };
    expect(evento.payloadJson?.hashesCrossChecked).toBe(2);
    expect(JSON.stringify(evento)).not.toContain('a'.repeat(64));
  });

  it('guarda los cruces contra la lista de vigilancia y contra otros expedientes por separado', async () => {
    /*
     * Separados y no sumados en la fila: son dos hechos distintos. Un teléfono en la lista de
     * vigilancia es una decisión que alguien tomó; el teléfono de la referencia de otro expediente
     * es la firma de un anillo. Quien investigue necesita saber cuál de los dos apareció.
     */
    const { service, metricas } = build({ conocidos: { watchlist: 1, otherApplicants: 3 } });
    await service.submit({ tenantId: TENANT, customerId: CUSTOMER, body: SNAPSHOT, currentUser: usuario, ipAddress: null });

    const porCodigo = new Map(metricas.map((m) => [m.metricCode, m.valueNumber]));
    expect(porCodigo.get('contacts.risk_matches_watchlist')).toBe(1);
    expect(porCodigo.get('contacts.risk_matches_other_applicants')).toBe(3);
  });

  it('una negativa se registra como respuesta, no como error', async () => {
    /*
     * `skipped` y no `failed`: no falló nada, la persona dijo que no. Registrar la negativa —en vez
     * de no mandar nada— es lo que permite distinguir «dijo que no» de «esta versión de la app
     * todavía no lo pedía», y esas dos cosas se ponderan distinto.
     */
    const { service, creados, metricas } = build();
    const negado = contactsSnapshotSchema.parse({
      granted: false,
      algorithmVersion: 'contacts-snapshot-1.0.0',
      computedAt: '2026-08-26T12:00:00.000Z',
      referencesDeclared: 2,
    });
    await service.submit({ tenantId: TENANT, customerId: CUSTOMER, body: negado, currentUser: usuario, ipAddress: null });

    expect(creados[0]?.status).toBe('skipped');
    expect(metricas.find((m) => m.metricCode === 'contacts.granted')?.valueBoolean).toBe(false);
  });

  it('sin captura previa, los agregados dicen NO DISPONIBLE y no una agenda vacía', async () => {
    /*
     * No es lo mismo, y confundirlo penalizaría a quien usa una versión antigua de la app: una es
     * menos evidencia y la otra sería evidencia en contra.
     */
    const { service } = build();
    const features = await service.featuresFor(TENANT, CUSTOMER);

    expect(features.available).toBe(false);
    expect(features.totalContacts).toBe(0);
  });
});

describe('el contrato del snapshot', () => {
  const base = {
    granted: true,
    algorithmVersion: 'contacts-snapshot-1.0.0',
    computedAt: '2026-08-26T12:00:00.000Z',
  };

  it('rechaza medidas SIN permiso concedido', () => {
    /*
     * Un cliente que mande `granted: false` con doscientos contactos declara dos cosas que no pueden
     * ser ciertas a la vez, y la más probable es que leyera la agenda igualmente. Aceptarlo dejaría
     * entrar datos recogidos sin permiso y, peor, los dejaría entrar ETIQUETADOS como recogidos con
     * él.
     */
    expect(() =>
      contactsSnapshotSchema.parse({ ...base, granted: false, totalContacts: 200 }),
    ).toThrow();
    expect(() =>
      contactsSnapshotSchema.parse({ ...base, granted: false, phoneHashes: ['a'.repeat(64)] }),
    ).toThrow();
  });

  it('rechaza cuentas que se contradicen entre sí', () => {
    expect(() =>
      contactsSnapshotSchema.parse({ ...base, totalContacts: 10, contactsWithPhone: 20 }),
    ).toThrow();
    expect(() =>
      contactsSnapshotSchema.parse({ ...base, contactsWithPhone: 10, uniquePhoneCount: 20 }),
    ).toThrow();
    expect(() =>
      contactsSnapshotSchema.parse({ ...base, referencesDeclared: 2, referencesFoundInAddressBook: 3 }),
    ).toThrow();
  });

  it('sólo admite SHA-256 en la lista de hashes', () => {
    // Un identificador de contacto, un teléfono o un nombre no tienen esta forma. El patrón es lo
    // que impide que un cliente mal hecho —o malintencionado— use este campo como canal de subida.
    expect(() => contactsSnapshotSchema.parse({ ...base, phoneHashes: ['+59176500122'] })).toThrow();
    expect(() => contactsSnapshotSchema.parse({ ...base, phoneHashes: ['A'.repeat(64)] })).toThrow();
    expect(() => contactsSnapshotSchema.parse({ ...base, phoneHashes: ['a'.repeat(63)] })).toThrow();
  });
});
