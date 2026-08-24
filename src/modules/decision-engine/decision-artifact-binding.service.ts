/**
 * @file Servicio de aplicación: resuelve y administra qué artefacto decide cada cosa.
 * @business Convierte una decisión de negocio —qué política nos evalúa— en algo configurable.
 * @system lee `catalog.decision_artifact_bindings` con el entorno como respaldo.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { env } from '../../config/env.js';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import { DecisionEngineClient } from './decision-engine.client.js';

/** Los tipos de decisión que hoy delegan en el motor. Uno por consumidor real. */
export const DECISION_TYPES = ['identity', 'credit', 'risk'] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

const TABLE = `${atlasSchemaFor('decision_artifact_bindings')}.decision_artifact_bindings`;

/**
 * De dónde salió el artefacto que se va a ejecutar.
 *
 * Se publica junto con el código porque «no hay fila, se usó el entorno» y «alguien eligió esto» son
 * dos situaciones muy distintas para quien mira la pantalla, y hasta ahora se veían igual: no se
 * veían en absoluto.
 */
export type BindingSource = 'binding' | 'environment' | 'unset';

export interface ResolvedArtifact {
  decisionType: DecisionType;
  artifactCode: string | null;
  source: BindingSource;
}

/**
 * Qué artefacto decide cada cosa, elegido desde el portal en vez de desde el `.env`.
 *
 * ## Por qué el entorno sigue siendo el respaldo
 *
 * Para poder desplegar esto sin configurar nada y sin romper lo que ya funciona: mientras no haya
 * fila, todo sigue exactamente igual que antes. La fila aparece cuando alguien elige de verdad, y
 * entonces manda ella.
 *
 * ## Por qué la lista de opciones la da el MOTOR
 *
 * Porque es el único que sabe qué artefactos existen y están publicados. Escribir el código a mano
 * es lo que produjo el fallo que esto viene a cerrar: el defecto apuntaba a `credit_underwriting`,
 * que en el motor se llama `ATLAS_BNPL_UNDERWRITING`, y cada solicitud de crédito moría en un 404
 * silencioso. De una lista no se puede elegir algo que no existe.
 */
@Injectable()
export class DecisionArtifactBindingService {
  private readonly logger = new Logger(DecisionArtifactBindingService.name);

  constructor(
    @InjectConnection() private readonly sequelize: Sequelize,
    private readonly client: DecisionEngineClient,
  ) {}

  /** El valor del entorno para un tipo, que es el respaldo cuando nadie ha elegido. */
  private envFallback(decisionType: DecisionType): string | null {
    if (decisionType === 'identity') return env.DECISION_ENGINE_IDENTITY_ARTIFACT || null;
    if (decisionType === 'credit') return env.DECISION_ENGINE_CREDIT_ARTIFACT || null;
    return env.DECISION_ENGINE_RISK_ARTIFACT || null;
  }

  /**
   * El artefacto que hay que ejecutar para este tipo de decisión.
   *
   * Es lo que llaman los servicios en vez de leer `env` directamente. Si la consulta falla se cae al
   * entorno y se sigue: una tabla de configuración inaccesible no puede dejar sin decidir a nadie.
   */
  async resolve(tenantId: string, decisionType: DecisionType): Promise<ResolvedArtifact> {
    try {
      const rows = await this.sequelize.query<{ artifact_code: string }>(
        `SELECT artifact_code FROM ${TABLE} WHERE _tenant_id = :tenantId AND decision_type = :decisionType LIMIT 1`,
        { replacements: { tenantId, decisionType }, type: QueryTypes.SELECT },
      );
      if (rows[0]?.artifact_code) {
        return { decisionType, artifactCode: rows[0].artifact_code, source: 'binding' };
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo leer la asignación de artefacto para ${decisionType}; se usa el entorno. ${(error as Error).message}`,
      );
    }
    const fromEnv = this.envFallback(decisionType);
    return { decisionType, artifactCode: fromEnv, source: fromEnv ? 'environment' : 'unset' };
  }

  /** Lo que se ve en la pantalla de configuración: qué decide cada cosa y de dónde salió. */
  async list(tenantId: string): Promise<ResolvedArtifact[]> {
    return Promise.all(DECISION_TYPES.map((decisionType) => this.resolve(tenantId, decisionType)));
  }

  /**
   * Los artefactos publicados en el motor, para poblar el desplegable.
   *
   * Devuelve lista vacía —nunca lanza— si el motor no contesta: la pantalla debe poder abrirse para
   * enseñar la configuración vigente aunque el motor esté caído. Lo que no se puede es elegir a
   * ciegas, y por eso `assign` sí valida contra esta misma lista.
   */
  async availableArtifacts(): Promise<{ code: string; name: string | null; type: string | null }[]> {
    try {
      const response = await this.client.listArtifacts();
      return response.map((item) => ({
        code: item.artifactCode ?? item.code ?? '',
        name: item.name ?? null,
        type: item.artifactType ?? null,
      }));
    } catch (error) {
      this.logger.warn(`El motor no devolvió el catálogo de artefactos: ${(error as Error).message}`);
      return [];
    }
  }

  /**
   * Asigna un artefacto a un tipo de decisión.
   *
   * Valida contra el catálogo del motor y NO deja guardar un código que no existe. Es la razón de
   * ser de esta pantalla: el fallo que la motivó fue exactamente ese, y aceptar texto libre aquí
   * habría reproducido el problema con una interfaz más bonita.
   */
  async assign(input: {
    tenantId: string;
    decisionType: DecisionType;
    artifactCode: string;
    internalUserId: string | null;
    notes?: string;
  }): Promise<ResolvedArtifact & { validatedAgainstEngine: boolean }> {
    const catalog = await this.availableArtifacts();
    const known = catalog.some((item) => item.code === input.artifactCode);
    if (catalog.length > 0 && !known) {
      throw new Error(
        `DECISION_ARTIFACT_NOT_PUBLISHED: el motor no publica «${input.artifactCode}». Disponibles: ${catalog
          .map((item) => item.code)
          .join(', ')}`,
      );
    }

    await this.sequelize.query(
      `INSERT INTO ${TABLE} (_tenant_id, decision_type, artifact_code, notes, changed_by_internal_user_id, _created_at)
       VALUES (:tenantId, :decisionType, :artifactCode, :notes, :internalUserId, NOW())
       ON CONFLICT (_tenant_id, decision_type)
       DO UPDATE SET artifact_code = EXCLUDED.artifact_code,
                     notes = EXCLUDED.notes,
                     changed_by_internal_user_id = EXCLUDED.changed_by_internal_user_id,
                     _updated_at = NOW()`,
      {
        replacements: {
          tenantId: input.tenantId,
          decisionType: input.decisionType,
          artifactCode: input.artifactCode,
          notes: input.notes ?? null,
          internalUserId: input.internalUserId,
        },
      },
    );

    this.logger.log(
      `Artefacto de ${input.decisionType} asignado a «${input.artifactCode}» por el usuario interno ${input.internalUserId ?? 'desconocido'}.`,
    );

    return {
      decisionType: input.decisionType,
      artifactCode: input.artifactCode,
      source: 'binding',
      // `false` significa que el motor no contestó, no que el código sea inválido: la asignación se
      // guarda igual para no bloquear la configuración por una caída del motor.
      validatedAgainstEngine: catalog.length > 0,
    };
  }
}
