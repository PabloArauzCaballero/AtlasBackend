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
  /** Version fijada. `null` = la vigente del despliegue, que es el comportamiento de siempre. */
  pinnedVersion?: string | null;
  /** Que endpoints del backend disparan esta decision. Contesta «si cambio esto, que se rompe». */
  consumerEndpoints?: { method: string; path: string; purpose: string }[];
  /** En que punto del recorrido del cliente ocurre. */
  workflowStage?: string | null;
  workflowSteps?: string[];
  title?: string;
  description?: string | null;
  business?: string;
  systems?: string;
  example?: string;
}

/**
 * Quien llama a cada decision y en que momento del recorrido.
 *
 * Esta declarado aqui, junto al codigo que lo ejecuta, y NO en la base: es un hecho del sistema, no
 * una preferencia. Si manana un servicio nuevo llama a la politica de credito, esta constante es lo
 * que hay que actualizar —y el que la lea sabra que la lista es exacta, no lo que alguien anoto una
 * vez—. La base guarda lo que el operador decide; esto guarda lo que el codigo hace.
 */
interface CatalogEntry {
  title: string;
  description: string;
  /** Para que le sirve al negocio, con un ejemplo concreto de cuando importa. */
  business: string;
  /** Que hace por dentro: que se le manda al motor y que devuelve. */
  systems: string;
  example: string;
  endpoints: { method: string; path: string; purpose: string }[];
  stage: string;
  /** Los pasos del recorrido en los que participa, en orden. */
  workflowSteps: string[];
}

const DECISION_CATALOG: Record<DecisionType, CatalogEntry> = {
  identity: {
    title: 'Identidad',
    description: 'Decide si la persona del carnet es quien dice ser.',
    business:
      'Es la puerta de entrada del alta: hasta que esta decision no dice que si, no hay cliente al que prestarle. Una politica demasiado estricta rechaza a gente que si es quien dice, y una demasiado laxa deja pasar una suplantacion —que en un credito significa prestarle dinero a alguien que nunca lo va a devolver porque nunca lo pidio—.',
    systems:
      'Se le mandan las tres imagenes en base64 —anverso, reverso y selfie— y el pais del documento. El artefacto llama al worker de identidad, que lee la MRZ, extrae el retrato del carnet y lo compara con la selfie. Devuelve VERIFICADO, RECHAZADO o REVISION_HUMANA con el parecido medido.',
    example:
      'Un parecido de 0,90 sobre un umbral calibrado de 0,8824 aprueba; uno de 0,80 cae en la franja ambigua y se deriva a un analista, que ve el carnet y la selfie antes de decidir.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/v1/mobile/identity-verifications',
        purpose: 'La app movil envia las fotos y consulta el veredicto.',
      },
      {
        method: 'POST',
        path: '/api/v1/customer-onboarding/:customerId/identity-package',
        purpose: 'El alta registra el paquete de identidad y dispara la verificacion.',
      },
    ],
    stage: 'Alta del cliente · verificacion de identidad',
    workflowSteps: [
      'El cliente fotografia su carnet y se toma una selfie',
      'Las imagenes suben cifradas con URL firmada',
      'El artefacto decide: verificado, rechazado o a revision humana',
      'Si va a revision, el caso entra en la cola IDENTIDAD del motor',
      'La decision del analista vuelve al expediente y desbloquea el alta',
    ],
  },
  credit: {
    title: 'Credito',
    description: 'Decide si se aprueba una solicitud, con que limite y en cuantas cuotas.',
    business:
      'Es la decision que pone dinero en la calle. Determina cuanto se presta y a quien, asi que gobierna directamente la mora de la cartera: aflojarla sube las ventas hoy y la morosidad en tres meses.',
    systems:
      'Se le mandan los rasgos economicos declarados y verificados del cliente —ingresos, gastos, antiguedad, actividad— junto con su historial. Devuelve aprobado o rechazado, el limite y si necesita aceptacion del comercio.',
    example:
      'Una solicitud de Bs 1.500 a tres cuotas con ingreso declarado de Bs 8.500 y gastos de Bs 3.200 se aprueba; la misma solicitud con gastos de Bs 8.000 no deja capacidad de pago y se rechaza.',
    endpoints: [
      {
        method: 'POST',
        path: '/api/v1/customers/:customerId/credit-applications',
        purpose: 'El cliente solicita un credito desde la app.',
      },
      {
        method: 'POST',
        path: '/api/v1/operations/customers/:customerId/credit-line/recalculate',
        purpose: 'Operaciones recalcula la linea de un cliente.',
      },
    ],
    stage: 'Originacion · solicitud y linea de credito',
    workflowSteps: [
      'El cliente pide un credito, opcionalmente en un comercio',
      'El artefacto evalua su capacidad de pago',
      'Si aprueba, el comercio confirma la venta',
      'Se desembolsa y nace el calendario de cuotas',
    ],
  },
  risk: {
    title: 'Riesgo',
    description: 'Evalua el riesgo del cliente de forma continua.',
    business:
      'No decide una operacion concreta: vigila al cliente despues de tenerlo. Es lo que permite ajustar un limite antes de que la mora ocurra, en vez de reaccionar cuando ya ocurrio.',
    systems:
      'Opcional. Sin artefacto asignado no se consulta y el resto del sistema funciona igual; con el, se evalua al cliente contra la politica de riesgo vigente.',
    example:
      'Un cliente que empieza a pagar tarde de forma sistematica puede ver su linea reducida antes de caer en impago.',
    endpoints: [
      {
        method: '—',
        path: 'Evaluacion interna, sin endpoint publico',
        purpose: 'Lo dispara el propio backend al recalcular riesgo.',
      },
    ],
    stage: 'Riesgo continuo · evaluacion del cliente',
    workflowSteps: [
      'El backend recalcula el riesgo del cliente',
      'Si hay artefacto asignado, se consulta la politica',
      'El resultado alimenta limites y alertas',
    ],
  },
};

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
/** Lo que el CODIGO hace con cada decision: quien la llama, donde vive y que decide. */
function catalogo(decisionType: DecisionType) {
  const entry = DECISION_CATALOG[decisionType];
  return {
    title: entry.title,
    consumerEndpoints: entry.endpoints,
    workflowStage: entry.stage,
    workflowSteps: entry.workflowSteps,
    description: entry.description,
    business: entry.business,
    systems: entry.systems,
    example: entry.example,
  };
}

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
      const rows = await this.sequelize.query<{
        artifact_code: string;
        pinned_version: string | null;
      }>(
        `SELECT artifact_code, pinned_version FROM ${TABLE} WHERE _tenant_id = :tenantId AND decision_type = :decisionType LIMIT 1`,
        { replacements: { tenantId, decisionType }, type: QueryTypes.SELECT },
      );
      if (rows[0]?.artifact_code) {
        return {
          decisionType,
          artifactCode: rows[0].artifact_code,
          source: 'binding',
          pinnedVersion: rows[0].pinned_version ?? null,
          ...catalogo(decisionType),
        };
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo leer la asignación de artefacto para ${decisionType}; se usa el entorno. ${(error as Error).message}`,
      );
    }
    const fromEnv = this.envFallback(decisionType);
    return {
      decisionType,
      artifactCode: fromEnv,
      source: fromEnv ? 'environment' : 'unset',
      pinnedVersion: null,
      ...catalogo(decisionType),
    };
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
  async availableArtifacts(): Promise<
    { code: string; name: string | null; type: string | null; latestVersion: string | null; status: string | null }[]
  > {
    try {
      const response = await this.client.listArtifacts();
      return response.map((item) => ({
        code: item.artifactCode ?? item.code ?? '',
        name: item.name ?? null,
        type: item.artifactType ?? null,
        // La version publicada del motor: es lo que permite FIJAR una en vez de seguir a la vigente.
        latestVersion: item.latestVersion ?? null,
        status: item.latestStatus ?? null,
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
    /** Version a fijar. Sin ella se sigue la vigente del despliegue, como hasta ahora. */
    pinnedVersion?: string | null;
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
      `INSERT INTO ${TABLE} (_tenant_id, decision_type, artifact_code, pinned_version, notes, changed_by_internal_user_id, _created_at)
       VALUES (:tenantId, :decisionType, :artifactCode, :pinnedVersion, :notes, :internalUserId, NOW())
       ON CONFLICT (_tenant_id, decision_type)
       DO UPDATE SET artifact_code = EXCLUDED.artifact_code,
                     pinned_version = EXCLUDED.pinned_version,
                     notes = EXCLUDED.notes,
                     changed_by_internal_user_id = EXCLUDED.changed_by_internal_user_id,
                     _updated_at = NOW()`,
      {
        replacements: {
          tenantId: input.tenantId,
          decisionType: input.decisionType,
          artifactCode: input.artifactCode,
          pinnedVersion: input.pinnedVersion ?? null,
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
      pinnedVersion: input.pinnedVersion ?? null,
      ...catalogo(input.decisionType),
      // `false` significa que el motor no contestó, no que el código sea inválido: la asignación se
      // guarda igual para no bloquear la configuración por una caída del motor.
      validatedAgainstEngine: catalog.length > 0,
    };
  }
}
