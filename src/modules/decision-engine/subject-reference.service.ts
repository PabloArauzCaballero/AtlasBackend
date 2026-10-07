/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza traslada la decisión de crédito a una política versionada, aprobada y auditable.
 * @system deriva y resuelve el identificador opaco con el que el motor conoce a un sujeto.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Transaction } from 'sequelize';
import { atlasSchemaFor } from '../../database/domain-schemas.js';
import { env } from '../../config/env.js';
import { sha256Hex } from '../../common/utils/crypto/hash.util.js';
import { DecisionSubjectLinkModel } from '../../database/models/index.js';

const TABLE = `${atlasSchemaFor('decision_subject_links')}.decision_subject_links`;

/** Para qué se emitió la referencia. Un mismo cliente tiene una distinta por propósito. */
export const CREDIT_DECISION_PURPOSE = 'credit_underwriting';

@Injectable()
export class SubjectReferenceService {
  constructor(
    @InjectModel(DecisionSubjectLinkModel)
    private readonly linkModel: typeof DecisionSubjectLinkModel,
  ) {}

  /**
   * Identificador opaco y ESTABLE del sujeto, tal como lo verá el motor.
   *
   * Determinista para que dos decisiones del mismo cliente se puedan unir, y con sal para que el
   * motor —que sólo ve el resultado— no pueda recorrer el espacio de identificadores del core y
   * deducir a quién corresponde. El propósito entra en la derivación: quien resuelva referencias de
   * crédito no obtiene de paso las de otro uso.
   *
   * La sal es obligatoria y se valida al arrancar. Cambiarla parte la historia del cliente en dos
   * mitades que ya no se pueden volver a unir, así que rotarla es una migración, no un ajuste.
   */
  derive(tenantId: string, customerId: string, purposeCode: string = CREDIT_DECISION_PURPOSE): string {
    const salt = env.DECISION_ENGINE_SUBJECT_SALT;
    if (!salt) throw new Error('DECISION_ENGINE_SUBJECT_SALT no está configurada.');
    return sha256Hex(`${salt}|${tenantId}|${purposeCode}|${customerId}`);
  }

  /**
   * Registra que este sujeto pasó por el motor, y cuántas veces.
   *
   * Es la mitad que le falta al hash. El motor indexa `subject_reference_hash` y con eso responde
   * «cuántas decisiones tiene este sujeto», pero no puede traer su historia porque un hash no se
   * deshace. Esta tabla la deshace, del lado donde el dato personal ya vive y bajo sus políticas de
   * retención — el motor sigue sin saber a quién decide.
   */
  async register(
    input: { tenantId: string; customerId: string; purposeCode?: string },
    options: { transaction?: Transaction } = {},
  ): Promise<string> {
    const purposeCode = input.purposeCode ?? CREDIT_DECISION_PURPOSE;
    const subjectReference = this.derive(input.tenantId, input.customerId, purposeCode);
    const now = new Date();

    /*
     * Un solo INSERT ... ON CONFLICT: buscar y luego crear hacía fallar a una de dos decisiones
     * simultáneas de un cliente nuevo (violación de ux_decision_subject_links_customer), y el
     * contador por lectura-modificación-escritura perdía cuentas. Aquí la base arbitra y suma.
     * `_created_at` va explícito por el mismo motivo de siempre: el DEFAULT no se aplica si el valor
     * viaja nulo, y no queremos depender de ello.
     */
    const [rows] = (await this.linkModel.sequelize!.query(
      `INSERT INTO ${TABLE} (_tenant_id, customer_id, subject_reference, purpose_code, first_seen_at, last_seen_at, decision_count, _created_at, _updated_at)
       VALUES (:tenantId, :customerId, :subjectReference, :purposeCode, :now, :now, 1, :now, :now)
       ON CONFLICT (_tenant_id, customer_id, purpose_code)
       DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at,
                     decision_count = ${TABLE}.decision_count + 1,
                     _updated_at = EXCLUDED._updated_at
       RETURNING subject_reference`,
      {
        replacements: { tenantId: input.tenantId, customerId: input.customerId, subjectReference, purposeCode, now },
        transaction: options.transaction,
      },
    )) as [{ subject_reference: string }[], unknown];
    return rows[0]?.subject_reference ?? subjectReference;
  }

  /**
   * Resuelve una referencia de vuelta al cliente.
   *
   * Es la operación que hace posible atender una solicitud del titular y recalibrar sin trabajar a
   * ciegas. Deliberadamente NO recalcula el hash a la inversa —no se puede—: consulta la tabla, que
   * es la única autorizada a deshacer la correspondencia y deja rastro de que existe.
   */
  async resolve(tenantId: string, subjectReference: string): Promise<DecisionSubjectLinkModel | null> {
    return this.linkModel.findOne({ where: { tenantId, subjectReference } } as FindOptions);
  }
}
