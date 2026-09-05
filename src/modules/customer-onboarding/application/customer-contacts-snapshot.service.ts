/**
 * @file Servicio de aplicación: recibe el snapshot de agenda y publica sus agregados.
 * @business Esta pieza mide el arraigo social de quien se da de alta sin llevarse su libreta de direcciones.
 * @system cruza los hashes de un solo uso, guarda sólo cuentas y los descarta antes de responder.
 */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { createHash } from 'node:crypto';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { assertOwnCustomerResourceOrInternalOperational } from '../../../common/utils/auth/ownership.util.js';
import { CustomersRepository } from '../../customers/customers.repository.js';
import { CustomerOnboardingRepository } from '../customer-onboarding.repository.js';
import { CustomerContactsSnapshotRepository } from '../repositories/customer-contacts-snapshot.repository.js';
import {
  type ContactsSnapshotDto,
  type ContactsSnapshotFeatures,
  type ContactsSnapshotView,
} from '../customer-contacts-snapshot.schemas.js';

/** Los códigos con los que se guarda cada agregado. Son el contrato con el artefacto. */
export const CONTACTS_METRIC_CODES = {
  granted: 'contacts.granted',
  total: 'contacts.total',
  withPhone: 'contacts.with_phone',
  uniquePhones: 'contacts.unique_phones',
  bolivianPhones: 'contacts.bolivian_phones',
  referencesFound: 'contacts.references_in_address_book',
  referencesDeclared: 'contacts.references_declared',
  riskMatchesWatchlist: 'contacts.risk_matches_watchlist',
  riskMatchesOtherApplicants: 'contacts.risk_matches_other_applicants',
} as const;

/**
 * El snapshot de la agenda, recibido y convertido en seis números.
 *
 * ## Qué hace y en qué orden
 *
 * 1. Cruza los hashes de un solo uso contra lo que ya sabemos. **Fuera de la
 *    transacción**, porque es lectura y porque abrir una transacción alrededor de
 *    dos `COUNT` sólo retendría locks durante su latencia.
 * 2. Escribe la ejecución y sus métricas, en una sola transacción: una fila de
 *    ejecución sin métricas sería una captura que dice haber medido y no dice
 *    qué.
 * 3. Contesta con el hecho de haberla recibido, y **nada más**. No devuelve el
 *    análisis: quien sube el snapshot es el propio teléfono de la persona
 *    analizada, y devolverle su puntaje de riesgo le enseña qué mover para que
 *    salga mejor la próxima vez.
 *
 * ## Lo que este servicio garantiza
 *
 * Que los hashes no sobreviven a la petición. Entran por el cuerpo, se usan en el
 * paso 1 y no se pasan al paso 2. No se registran en el log, no se auditan y no
 * se guardan. Es el control que hace defendible pedirlos.
 */
@Injectable()
export class CustomerContactsSnapshotService {
  private readonly logger = new Logger(CustomerContactsSnapshotService.name);

  constructor(
    private readonly customersRepository: CustomersRepository,
    private readonly onboardingRepository: CustomerOnboardingRepository,
    private readonly snapshots: CustomerContactsSnapshotRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async submit(input: {
    tenantId: string;
    customerId: string;
    body: ContactsSnapshotDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
  }): Promise<ContactsSnapshotView> {
    assertOwnCustomerResourceOrInternalOperational(input.currentUser, input.customerId);
    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');

    const hashes = input.body.phoneHashes ?? [];
    const conocidos = await this.snapshots.countKnownPhoneHashes({
      tenantId: input.tenantId,
      customerId: input.customerId,
      phoneHashes: hashes,
    });

    /*
     * La huella de integridad se calcula sobre los AGREGADOS, no sobre los hashes.
     *
     * Sirve para detectar que dos capturas idénticas se reenviaron —un reintento
     * del cliente— y para poder afirmar después que la fila no se tocó. Incluir
     * los hashes la haría depender de un dato que a propósito no conservamos, y
     * entonces no se podría recalcular para comprobarla, que es justo lo único
     * para lo que una huella sirve.
     */
    const integrityHash = createHash('sha256')
      .update(
        [
          input.customerId,
          input.body.algorithmVersion,
          input.body.computedAt,
          input.body.granted,
          input.body.totalContacts,
          input.body.contactsWithPhone,
          input.body.uniquePhoneCount,
          input.body.bolivianPhoneCount,
          input.body.referencesFoundInAddressBook,
          input.body.referencesDeclared,
        ].join('|'),
      )
      .digest('hex');

    const now = new Date();
    const run = await this.sequelize.transaction(async (transaction) => {
      const flow = await this.onboardingRepository.findLatestOnboardingFlow(
        input.tenantId,
        input.customerId,
        { transaction },
      );

      const created = await this.snapshots.createRun(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          onboardingFlowId: flow ? String(flow.id) : null,
          sessionId: null,
          algorithmVersion: input.body.algorithmVersion,
          computedAtDevice: new Date(input.body.computedAt),
          receivedAtServer: now,
          // `skipped` y no `failed` cuando no hubo permiso: no falló nada. La
          // persona dijo que no, que es una respuesta y no un error.
          status: input.body.granted ? 'completed' : 'skipped',
          integrityHash,
        },
        { transaction },
      );

      const runId = String(created.id);
      const metricas: Array<{ code: string; number?: number; boolean?: boolean }> = [
        { code: CONTACTS_METRIC_CODES.granted, boolean: input.body.granted },
        { code: CONTACTS_METRIC_CODES.total, number: input.body.totalContacts },
        { code: CONTACTS_METRIC_CODES.withPhone, number: input.body.contactsWithPhone },
        { code: CONTACTS_METRIC_CODES.uniquePhones, number: input.body.uniquePhoneCount },
        { code: CONTACTS_METRIC_CODES.bolivianPhones, number: input.body.bolivianPhoneCount },
        { code: CONTACTS_METRIC_CODES.referencesFound, number: input.body.referencesFoundInAddressBook },
        { code: CONTACTS_METRIC_CODES.referencesDeclared, number: input.body.referencesDeclared },
        { code: CONTACTS_METRIC_CODES.riskMatchesWatchlist, number: conocidos.watchlist },
        { code: CONTACTS_METRIC_CODES.riskMatchesOtherApplicants, number: conocidos.otherApplicants },
      ];
      for (const metrica of metricas) {
        await this.snapshots.createMetric(
          {
            tenantId: input.tenantId,
            computationRunId: runId,
            metricCode: metrica.code,
            valueNumber: metrica.number ?? null,
            valueBoolean: metrica.boolean ?? null,
            createdAt: now,
          },
          { transaction },
        );
      }

      await this.onboardingRepository.createOnboardingStepEvent(
        {
          tenantId: input.tenantId,
          onboardingFlowId: flow ? String(flow.id) : null,
          stepCode: 'contacts_snapshot_submitted',
          eventType: input.body.granted ? 'completed' : 'skipped',
          happenedAt: now,
          payloadJson: {
            algorithmVersion: input.body.algorithmVersion,
            granted: input.body.granted,
            totalContacts: input.body.totalContacts,
            // El número de hashes CRUZADOS, nunca los hashes. Es lo que permite
            // saber después si el cruce llegó a hacerse.
            hashesCrossChecked: hashes.length,
          },
        },
        { transaction },
      );

      await this.onboardingRepository.createOperationalAuditLog(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'customer_onboarding.contacts_snapshot',
          targetType: 'customer',
          targetId: input.customerId,
          ipAddress: input.ipAddress,
          userAgent: null,
          payloadJson: {
            computationRunId: runId,
            granted: input.body.granted,
            rawContactsStored: false,
          },
          occurredAt: now,
        },
        { transaction },
      );

      return created;
    });

    this.logger.log(
      `Snapshot de agenda del cliente ${input.customerId}: permiso=${String(input.body.granted)} ` +
        `contactos=${String(input.body.totalContacts)} cruces=${String(conocidos.watchlist + conocidos.otherApplicants)}.`,
    );

    return {
      customerId: input.customerId,
      computationRunId: String(run.id),
      granted: input.body.granted,
      receivedAt: now.toISOString(),
    };
  }

  /**
   * Los seis agregados de la última captura, listos para el artefacto.
   *
   * Cuando no hay ninguna captura devuelve `available: false` con todo a cero, y
   * eso NO es lo mismo que una agenda vacía: el artefacto pondera la ausencia
   * como menos evidencia —veinte puntos de cien, que solos no llegan a nada— en
   * vez de como una señal en contra. Confundir las dos cosas penalizaría a quien
   * usa una versión antigua de la app.
   */
  async featuresFor(tenantId: string, customerId: string): Promise<ContactsSnapshotFeatures> {
    const vacio: ContactsSnapshotFeatures = {
      available: false,
      totalContacts: 0,
      uniqueRatio: 0,
      bolivianRatio: 0,
      referencesFoundInAddressBook: 0,
      riskMatches: 0,
    };

    const run = await this.snapshots.findLatestRun(tenantId, customerId);
    if (!run) return vacio;

    const metricas = await this.snapshots.findMetrics(tenantId, String(run.id));
    const numero = (code: string): number => {
      const fila = metricas.find((metrica) => metrica.metricCode === code);
      return fila?.valueNumber === null || fila?.valueNumber === undefined ? 0 : Number(fila.valueNumber);
    };
    const booleano = (code: string): boolean =>
      metricas.find((metrica) => metrica.metricCode === code)?.valueBoolean === true;

    if (!booleano(CONTACTS_METRIC_CODES.granted)) return vacio;

    const conTelefono = numero(CONTACTS_METRIC_CODES.withPhone);
    // División por cero explícita: sin contactos con teléfono, las dos
    // proporciones no existen. Devolver 0 aquí es correcto porque el artefacto
    // sólo las mira cuando `available` es cierto Y hay contactos, y porque un
    // `NaN` en una variable DECIMAL rompería la ejecución del motor.
    const razon = (parte: number): number =>
      conTelefono <= 0 ? 0 : Number((parte / conTelefono).toFixed(4));

    return {
      available: true,
      totalContacts: numero(CONTACTS_METRIC_CODES.total),
      uniqueRatio: razon(numero(CONTACTS_METRIC_CODES.uniquePhones)),
      bolivianRatio: razon(numero(CONTACTS_METRIC_CODES.bolivianPhones)),
      referencesFoundInAddressBook: numero(CONTACTS_METRIC_CODES.referencesFound),
      riskMatches:
        numero(CONTACTS_METRIC_CODES.riskMatchesWatchlist) +
        numero(CONTACTS_METRIC_CODES.riskMatchesOtherApplicants),
    };
  }
}
