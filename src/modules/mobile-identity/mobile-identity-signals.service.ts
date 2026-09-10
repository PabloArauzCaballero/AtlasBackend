/**
 * @file Las señales externas que acompañan a una verificación de identidad desde la app.
 * @business Esta pieza deja trazabilidad de la atención y su resultado.
 * @system implementa este tramo del caso de uso de soporte.
 */
import { Injectable, Logger } from '@nestjs/common';

import { DecisionArtifactBindingService } from '../decision-engine/decision-artifact-binding.service.js';
import { DecisionEngineClient } from '../decision-engine/decision-engine.client.js';
import { MobileIdentityRepository } from './mobile-identity.repository.js';
import { CustomerContactsSnapshotService } from '../customer-onboarding/application/customer-contacts-snapshot.service.js';
import type { ContactsSnapshotFeatures } from '../customer-onboarding/customer-contacts-snapshot.schemas.js';

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

/**
 * Salen de `MobileIdentityService` porque son consultas a OTROS sistemas —el registro estatal y la
 * agenda del dispositivo— y no parte del flujo de la verificación. Juntas dejaban el archivo por
 * encima de las 300 líneas de `check:file-size`.
 */
import { describir } from './mobile-identity.errors.js';
@Injectable()
export class MobileIdentitySignalsService {
  private readonly logger = new Logger(MobileIdentitySignalsService.name);

  constructor(
    private readonly repository: MobileIdentityRepository,
    private readonly engine: DecisionEngineClient,
    private readonly bindings: DecisionArtifactBindingService,
    private readonly contacts: CustomerContactsSnapshotService,
  ) {}

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
  async estadoDelRegistroEstatal(tenantId: string, customerId: string | null): Promise<{ estado: string; coincidencia: number }> {
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
  async agendaDe(tenantId: string, customerId: string | null): Promise<ContactsSnapshotFeatures> {
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
