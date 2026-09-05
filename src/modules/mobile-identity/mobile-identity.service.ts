/**
 * @file Servicio de aplicación: orquesta la verificación de identidad del canal móvil.
 * @business Esta pieza deja que una persona se verifique desde su teléfono con su carnet, sin pasar por una sucursal.
 * @system acepta las fotos, pide la decisión al motor y publica el estado que el móvil consulta.
 */
import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { DecisionArtifactBindingService } from '../decision-engine/decision-artifact-binding.service.js';
import { DecisionEngineClient } from '../decision-engine/decision-engine.client.js';
import { MobileIdentityRepository, PENDING_RESULT } from './mobile-identity.repository.js';
import { CustomerContactsSnapshotService } from '../customer-onboarding/application/customer-contacts-snapshot.service.js';
import type { ContactsSnapshotFeatures } from '../customer-onboarding/customer-contacts-snapshot.schemas.js';
import { StartIdentityVerificationDto, type IdentityVerificationState, type IdentityVerificationView } from './mobile-identity.schemas.js';
import type { AuthenticatedUser } from '../../common/types/auth.types.js';

/** Cómo se traduce la decisión del artefacto al estado que el móvil entiende. */
const ESTADO_POR_DECISION: Readonly<Record<string, IdentityVerificationState>> = {
  VERIFICADO: 'VERIFIED',
  RECHAZADO: 'REJECTED',
  REVISION_HUMANA: 'IN_REVIEW',
};

/**
 * Verificación de identidad para el front móvil.
 *
 * ## Por qué es asíncrona
 *
 * Verificar de verdad —leer el carnet, encontrar dos rostros, compararlos— tarda
 * segundos, y un caso derivado a una persona tarda horas. Una petición HTTP que
 * espere a eso se la lleva por delante cualquier intermediario, y el móvil se
 * queda sin saber si el trámite siguió. Así que se acepta, se contesta con un
 * identificador y el móvil pregunta por él.
 *
 * ## Por qué pasa por un ARTEFACTO y no por el worker
 *
 * El worker contesta una pregunta técnica —«¿son la misma persona?»— y este
 * módulo necesita otra: «¿dejo entrar a esta persona?». La segunda depende de
 * política —qué parecido basta, qué se hace con un documento raspando el
 * umbral— y esa política tiene que poder cambiar con versión, aprobación y
 * traza, sin desplegar este repositorio. Eso es un artefacto. Aquí no hay ni un
 * umbral escrito, y es a propósito.
 *
 * ## Qué NO se guarda
 *
 * Ninguna imagen. Viajan al motor y ahí acaban: lo que queda es el veredicto y
 * sus puntajes. Un carnet guardado «por si acaso» es exactamente el dato que una
 * fuga convierte en suplantación.
 */
@Injectable()
export class MobileIdentityService {
  private readonly logger = new Logger(MobileIdentityService.name);

  constructor(
    private readonly repository: MobileIdentityRepository,
    private readonly engine: DecisionEngineClient,
    private readonly bindings: DecisionArtifactBindingService,
    private readonly contacts: CustomerContactsSnapshotService,
  ) {}

  /**
   * Acepta las fotos y devuelve el identificador con el que se consultará.
   *
   * La llamada al motor arranca DESPUÉS de contestar, deliberadamente: si se
   * esperara a ella, la petición duraría lo que dure la biometría y habríamos
   * construido el endpoint síncrono que este flujo evita. El fallo de esa
   * llamada no puede perderse, así que se registra en la propia fila —el móvil
   * lo ve como `UNAVAILABLE`— y en el log.
   */
  async start(
    tenantId: string,
    body: StartIdentityVerificationDto,
    idempotencyKey: string,
    currentUser?: AuthenticatedUser,
  ): Promise<IdentityVerificationView> {
    if (!this.engine.isConfigured) {
      // 503 y no 500: no es que algo se haya roto, es que esta instalación no
      // tiene el motor conectado y el flujo entero depende de él.
      throw new ServiceUnavailableException({
        code: 'DECISION_ENGINE_NOT_CONFIGURED',
        message: 'La verificación de identidad no está disponible en esta instalación.',
      });
    }

    /*
     * De QUIEN es esta verificacion sale del TOKEN, no del cuerpo.
     *
     * `customerId` llegaba del body y era opcional, con dos consecuencias que se pagaron: una
     * llamada que lo omitia creaba un intento sin dueño —imposible de atribuir, y el circuito de
     * vuelta desde el motor moria sin poder aplicar la decision a nadie—, y una que mandara el de
     * otra persona habria colgado su carnet del expediente ajeno.
     *
     * El operador interno si puede indicarlo: opera en nombre de alguien y no tiene `customerId`
     * propio. Para un cliente, lo que diga el cuerpo se ignora.
     */
    const customerId =
      currentUser?.role === 'customer'
        ? (currentUser.customerId ?? null)
        : (body.customerId ?? currentUser?.customerId ?? null);

    const attempt = await this.repository.createPending(tenantId, customerId);
    const verificationId = String(attempt.id);

    void this.resolver(tenantId, verificationId, body, idempotencyKey, customerId).catch((error: unknown) => {
      this.logger.error(`La verificación ${verificationId} no pudo resolverse: ${describir(error)}`);
    });

    return {
      verificationId,
      status: 'PENDING',
      reason: null,
      similarity: null,
      requestedAt: attempt.requestedAt?.toISOString() ?? null,
      completedAt: null,
    };
  }

  /** El estado del trámite. Es lo que el móvil consulta en bucle. */
  async get(tenantId: string, verificationId: string): Promise<IdentityVerificationView> {
    const attempt = await this.repository.findById(tenantId, verificationId);
    if (!attempt) {
      // 404 y no 403 cuando la fila es de otro inquilino: un 403 confirmaría que
      // existe, que es justo lo que no debe poder averiguarse.
      throw new NotFoundException({
        code: 'IDENTITY_VERIFICATION_NOT_FOUND',
        message: 'No hay ninguna verificación con ese identificador.',
      });
    }
    const motivos = attempt.reasonCodesJson ?? {};
    return {
      verificationId,
      status: (attempt.finalResult ?? PENDING_RESULT) as IdentityVerificationState,
      reason: typeof motivos.reason === 'string' ? motivos.reason : null,
      similarity: attempt.selfieMatchScore === null ? null : Number(attempt.selfieMatchScore),
      requestedAt: attempt.requestedAt?.toISOString() ?? null,
      completedAt: attempt.completedAt?.toISOString() ?? null,
    };
  }

  /**
   * Pide la decisión al motor y cierra la fila con lo que conteste.
   *
   * Un fallo del motor NO se escribe como rechazo. Son cosas opuestas —«la
   * política dice que no» frente a «no llegué a preguntar»— y confundirlas deja
   * a una persona verificable fuera del producto y, de paso, ensucia la medida:
   * una caída del motor se registraría como una tanda de identidades falsas.
   */
  private async resolver(
    tenantId: string,
    verificationId: string,
    body: StartIdentityVerificationDto,
    idempotencyKey: string,
    customerId: string | null,
  ): Promise<void> {
    try {
      /*
       * Las dos señales que NO salen de las fotos.
       *
       * El artefacto decide con tres fuentes —el documento, el registro estatal y
       * la agenda— porque una sola fuente es exactamente lo que un suplantador
       * puede conseguir: una foto. Estas dos se reúnen aquí, antes de llamar, y
       * se pasan como variables de entrada.
       *
       * Las dos son BEST-EFFORT y las dos degradan hacia el lado seguro: si no
       * hay expediente, o si la lectura falla, viajan como «no consultado» y
       * «agenda no disponible», que el artefacto pondera como MENOS EVIDENCIA y
       * nunca como evidencia a favor. La condición de aprobación exige
       * confirmación explícita del registro, así que una lectura fallida no
       * puede aprobar a nadie: manda el caso a una persona.
       */
      const [segip, agenda] = await Promise.all([
        this.estadoDelRegistroEstatal(tenantId, customerId),
        this.agendaDe(tenantId, customerId),
      ]);

      /*
       * El artefacto sale de la ASIGNACIÓN, no del entorno.
       *
       * Qué política decide una identidad es una decisión de negocio que toma Riesgo desde el
       * portal; leerla de una variable de entorno obligaba a un despliegue para cambiarla y hacía
       * imposible ver desde la interfaz cuál estaba decidiendo. Si nadie ha elegido, `resolve()`
       * cae al entorno y todo sigue como antes.
       */
      const { artifactCode } = await this.bindings.resolve(tenantId, 'identity');
      const respuesta = await this.engine.execute(artifactCode ?? env.DECISION_ENGINE_IDENTITY_ARTIFACT, {
        requestId: randomUUID(),
        correlationId: verificationId,
        // Derivada del intento y de la clave del cliente: reintentar la misma
        // verificación no debe cobrarse dos veces al motor.
        idempotencyKey: createHash('sha256').update(`${tenantId}|${verificationId}|${idempotencyKey}`).digest('hex'),
        variables: {
          identidad_carnet_frente_base64: body.documentFront,
          identidad_carnet_reverso_base64: body.documentBack ?? null,
          identidad_selfie_base64: body.selfie,
          identidad_pais_documento: body.documentCountry,
          identidad_segip_estado: segip.estado,
          identidad_segip_coincidencia: segip.coincidencia,
          identidad_agenda_disponible: agenda.available,
          identidad_agenda_total: agenda.totalContacts,
          identidad_agenda_unicos_ratio: agenda.uniqueRatio,
          identidad_agenda_bolivia_ratio: agenda.bolivianRatio,
          identidad_agenda_referencias_presentes: agenda.referencesFoundInAddressBook,
          identidad_agenda_coincidencias_riesgo: agenda.riskMatches,
        },
        context: { channel: 'MOBILE_APP', verificationId },
      });

      const salida = respuesta.output ?? {};
      const decision = String(salida.identidad_resultado ?? '');
      const motivo = typeof salida.identidad_motivo === 'string' ? salida.identidad_motivo : null;

      await this.repository.complete(tenantId, verificationId, {
        // Un desenlace que el mapa no conoce va a revisión humana, no a
        // aprobación: un artefacto puede añadir una rama nueva y este código no
        // tiene por qué enterarse para seguir siendo seguro.
        finalResult: ESTADO_POR_DECISION[decision] ?? 'IN_REVIEW',
        reasonCodes: {
          reason: motivo,
          executionId: respuesta.executionId,
          artifactVersionId: respuesta.artifact?.versionId ?? null,
        },
        selfieMatchScore: decimal(salida.identidad_parecido),
        /*
         * La columna se llama «forensics» y ahora por fin guarda eso.
         *
         * Guardaba `identidad_evidencia_documento`, que mide si la imagen ES un
         * carnet — otra pregunta, y la que el nombre de la columna no hacía. El
         * riesgo de fraude es lo que un analista necesita ver junto al parecido
         * para decidir, y es lo que ordena la bandeja por gravedad.
         */
        documentForensicsScore:
          decimal(salida.identidad_riesgo_fraude) ?? decimal(salida.identidad_evidencia_documento),
        completedAt: new Date(),
      });
    } catch (error: unknown) {
      await this.repository.complete(tenantId, verificationId, {
        finalResult: 'UNAVAILABLE',
        reasonCodes: { reason: 'DECISION_ENGINE_UNAVAILABLE', detail: describir(error) },
        selfieMatchScore: null,
        documentForensicsScore: null,
        completedAt: new Date(),
      });
      throw error;
    }
  }

  /**
   * Qué contestó el registro estatal sobre este cliente, si contestó.
   *
   * Traduce el desenlace guardado por el flujo de alta al vocabulario del
   * proveedor, que es el que el artefacto enruta. La traducción es de tres a
   * cuatro y no es simétrica a propósito:
   *
   * - `verified` → `FOUND`. Es el ÚNICO que confirma.
   * - `rejected` → `NOT_FOUND`. El registro no encontró el documento declarado.
   * - `pending_review` → `PENDING`. Se preguntó y no se resolvió.
   * - sin cliente, sin intento o error de lectura → `NO_CONSULTADO`.
   *
   * Los tres últimos hacen exactamente lo mismo en el artefacto —impiden la
   * aprobación automática y mandan el caso a una persona— y aun así se
   * distinguen, porque quien abra el caso necesita saber si preguntar otra vez
   * sirve de algo.
   */
  private async estadoDelRegistroEstatal(
    tenantId: string,
    customerId: string | null,
  ): Promise<{ estado: string; coincidencia: number }> {
    if (!customerId) return { estado: 'NO_CONSULTADO', coincidencia: 0 };
    try {
      const intento = await this.repository.findLatestOnboardingAttempt(tenantId, customerId);
      if (!intento) return { estado: 'NO_CONSULTADO', coincidencia: 0 };
      const resultado = String(intento.finalResult ?? '').toLowerCase();
      if (resultado === 'verified') return { estado: 'FOUND', coincidencia: 1 };
      if (resultado === 'rejected') return { estado: 'NOT_FOUND', coincidencia: 0 };
      return { estado: 'PENDING', coincidencia: 0 };
    } catch (error: unknown) {
      // Se degrada, no se propaga: perder la verificación entera porque no se
      // pudo leer una fila auxiliar castigaría al solicitante por un problema
      // nuestro. `NO_CONSULTADO` no aprueba a nadie.
      this.logger.warn(`No se pudo leer el registro estatal del cliente ${customerId}: ${describir(error)}`);
      return { estado: 'NO_CONSULTADO', coincidencia: 0 };
    }
  }

  /** Los agregados de la agenda, o el vacío explícito cuando no los hay. */
  private async agendaDe(tenantId: string, customerId: string | null): Promise<ContactsSnapshotFeatures> {
    const vacio: ContactsSnapshotFeatures = {
      available: false,
      totalContacts: 0,
      uniqueRatio: 0,
      bolivianRatio: 0,
      referencesFoundInAddressBook: 0,
      riskMatches: 0,
    };
    if (!customerId) return vacio;
    try {
      return await this.contacts.featuresFor(tenantId, customerId);
    } catch (error: unknown) {
      this.logger.warn(`No se pudo leer la agenda del cliente ${customerId}: ${describir(error)}`);
      return vacio;
    }
  }
}

/** La columna es `DECIMAL(5,2)`: se acota antes de escribir, no después de fallar. */
function decimal(valor: unknown): string | null {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return null;
  return Math.max(0, Math.min(999.99, numero)).toFixed(2);
}

function describir(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
