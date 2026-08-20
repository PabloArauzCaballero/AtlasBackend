/**
 * @file Servicio de aplicación: orquesta la verificación de identidad del canal móvil.
 * @business Esta pieza deja que una persona se verifique desde su teléfono con su carnet, sin pasar por una sucursal.
 * @system acepta las fotos, pide la decisión al motor y publica el estado que el móvil consulta.
 */
import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import { env } from '../../config/env.js';
import { DecisionEngineClient } from '../decision-engine/decision-engine.client.js';
import { MobileIdentityRepository, PENDING_RESULT } from './mobile-identity.repository.js';
import { StartIdentityVerificationDto, type IdentityVerificationState, type IdentityVerificationView } from './mobile-identity.schemas.js';

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
  async start(tenantId: string, body: StartIdentityVerificationDto, idempotencyKey: string): Promise<IdentityVerificationView> {
    if (!this.engine.isConfigured) {
      // 503 y no 500: no es que algo se haya roto, es que esta instalación no
      // tiene el motor conectado y el flujo entero depende de él.
      throw new ServiceUnavailableException({
        code: 'DECISION_ENGINE_NOT_CONFIGURED',
        message: 'La verificación de identidad no está disponible en esta instalación.',
      });
    }

    const attempt = await this.repository.createPending(tenantId, body.customerId ?? null);
    const verificationId = String(attempt.id);

    void this.resolver(tenantId, verificationId, body, idempotencyKey).catch((error: unknown) => {
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
  ): Promise<void> {
    try {
      const respuesta = await this.engine.execute(env.DECISION_ENGINE_IDENTITY_ARTIFACT, {
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
        documentForensicsScore: decimal(salida.identidad_evidencia_documento),
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
