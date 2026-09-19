/**
 * @file De dónde sale cada señal con la que el Motor decide un crédito.
 * @business Cada rasgo que entra en la decisión tiene una procedencia, y aquí está escrita.
 * @system consulta perfil, contactos, domicilio, identidad e historial para componer las features.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import {
  AttributeDefinitionModel,
  CustomerAddressModel,
  CustomerAttributeValueModel,
  CustomerContactMethodModel,
  CustomerProfileVersionModel,
  IdentityVerificationAttemptModel,
} from '../../database/models/index.js';

import { clamp, toNumber } from './underwriting-numbers.js';

/** Lo que se manda al motor, y de dónde salió cada cosa. */
export type UnderwritingFeatures = {
  variables: Record<string, unknown>;
  /**
   * De dónde viene cada variable: `expediente` si es un dato real del cliente, `derivado` si se
   * calculó a partir de ellos, `ausente` si Atlas todavía no lo tiene y viaja con su valor neutro.
   *
   * No es adorno de auditoría: es la diferencia entre «el buró dice que no» y «no hay buró en el
   * país todavía», y el cliente tiene derecho a que no se le presenten igual.
   */
  provenance: Record<string, 'expediente' | 'derivado' | 'ausente'>;
};

/**
 * El puntaje que Atlas atestigua cuando el proveedor verificó pero no desglosó.
 *
 * Es deliberadamente el mínimo aprobatorio y no un valor alto: se afirma «pasó», no «pasó
 * brillantemente». La diferencia importa porque estos puntajes ponderan la decisión.
 */
const ATTESTED_PASS = 70;

/** Los códigos de atributo económico que el alta recoge, tal y como los guarda el catálogo. */
const INCOME = 'monthly_income_declared';
const OTHER_INCOME = 'other_monthly_income';
const EXPENSES = 'monthly_expenses_declared';
const EMPLOYMENT = 'employment_status';
const SENIORITY = 'employment_seniority_months';

/**
 * El expediente del cliente, traducido al contrato del motor.
 *
 * ## Por qué existe
 *
 * El core mandaba al motor cinco variables —el importe, el plazo, la moneda, el producto y el
 * propósito— y ni una sola del cliente. El artefacto declara cincuenta y siete entradas, entre ellas
 * el ingreso disponible, la relación deuda-ingreso y el historial de mora; sin ellas, la política
 * decidía sobre el vacío y el límite que salía era el mismo para todo el mundo.
 *
 * ## Qué se manda y qué no
 *
 * Se manda lo que Atlas SABE. Lo que no sabe viaja con un valor neutro declarado y queda marcado
 * como `ausente`, nunca inventado como si fuera un dato: la diferencia entre «no tiene historial» y
 * «tiene mal historial» es la diferencia entre un cliente nuevo y uno que ya falló, y confundirlas
 * al alza le niega crédito a quien nunca lo pidió.
 *
 * En Bolivia no hay buró de crédito conectado todavía, así que `bureau_score` no se rellena: se
 * declara `no_hit_flag` y `thin_file_flag`, que es exactamente lo que ocurre. La política decide qué
 * hacer con eso; el core no le miente para conseguir una aprobación.
 */

/**
 * Sale de `UnderwritingFeaturesService` (486 líneas) porque eran dos cosas: QUÉ features se le
 * mandan al Motor —la composición, que es corta y es el contrato— y de DÓNDE sale cada una, que
 * son siete consultas largas a otros tantos sitios. Quien revisa el contrato ya no tiene que leer
 * las consultas.
 */
@Injectable()
export class UnderwritingSignalsService {
  constructor(
    @InjectModel(CustomerAttributeValueModel) private readonly attributeValues: typeof CustomerAttributeValueModel,
    @InjectModel(AttributeDefinitionModel) private readonly attributeDefinitions: typeof AttributeDefinitionModel,
    @InjectModel(CustomerProfileVersionModel) private readonly profiles: typeof CustomerProfileVersionModel,
    @InjectModel(CustomerContactMethodModel) private readonly contacts: typeof CustomerContactMethodModel,
    @InjectModel(CustomerAddressModel) private readonly addresses: typeof CustomerAddressModel,
    @InjectModel(IdentityVerificationAttemptModel) private readonly identityAttempts: typeof IdentityVerificationAttemptModel,
  ) {}

  /** Los atributos económicos vigentes, por código. */
  async economicAttributes(tenantId: string, customerId: string): Promise<Record<string, number> & Record<string, unknown>> {
    const definitions = await this.attributeDefinitions.findAll({
      where: { attributeCode: { [Op.in]: [INCOME, OTHER_INCOME, EXPENSES, EMPLOYMENT, SENIORITY, 'source_of_funds'] } },
    } as FindOptions);
    if (definitions.length === 0) return {} as Record<string, number>;

    const byId = new Map(definitions.map((definition) => [String(definition.id), definition.attributeCode]));
    const values = await this.attributeValues.findAll({
      where: { tenantId, customerId, attributeDefinitionId: { [Op.in]: [...byId.keys()] } },
      order: [['_id', 'DESC']],
    } as FindOptions);

    const result: Record<string, unknown> = {};
    const seen = new Set<string>();
    for (const value of values) {
      const code = byId.get(String(value.attributeDefinitionId));
      if (!code || seen.has(code)) continue;
      seen.add(code);

      if (code === EMPLOYMENT) result.__employmentStatus = value.valueText ?? null;
      else if (code === 'source_of_funds') result.__sourceOfFunds = value.valueText ?? null;
      else result[code] = toNumber(value.valueNumber);
    }
    return result as Record<string, number> & Record<string, unknown>;
  }

  async currentProfile(tenantId: string, customerId: string): Promise<{ age: number }> {
    const profile = await this.profiles.findOne({
      where: { tenantId, customerId, validUntil: null },
      order: [['_id', 'DESC']],
    } as FindOptions);

    if (!profile?.birthDate) return { age: 0 };
    const born = new Date(`${String(profile.birthDate).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(born.getTime())) return { age: 0 };
    return { age: Math.floor((Date.now() - born.getTime()) / (365.25 * 86_400_000)) };
  }

  async contactVerification(tenantId: string, customerId: string): Promise<{ emailVerified: boolean; phoneVerified: boolean }> {
    const methods = await this.contacts.findAll({ where: { tenantId, customerId } } as FindOptions);
    return {
      emailVerified: methods.some((method) => method.emailDomain !== null && method.status === 'verified'),
      phoneVerified: methods.some((method) => method.emailDomain === null && method.status === 'verified'),
    };
  }

  async hasVerifiedAddress(tenantId: string, customerId: string): Promise<boolean> {
    const count = await this.addresses.count({ where: { tenantId, customerId } } as FindOptions);
    return count > 0;
  }

  /**
   * Lo que Atlas sabe de la identidad, sin confundir «no registrado» con «falló».
   *
   * El proveedor devuelve un veredicto y, cuando el canal lo permite, los puntajes que lo sostienen.
   * En el paquete de alta el veredicto llega verificado y los puntajes NO se guardan. Derivar de esa
   * ausencia un «no pasó la prueba de vida» —que es lo que hacía la primera versión de este
   * servicio— rechazaba a una clienta que el proveedor sí había verificado, por un campo vacío.
   *
   * La regla: si el puntaje está, manda el puntaje. Si no está pero el veredicto es `verified`, se
   * atestigua un aprobado CONSERVADOR y queda marcado como `derivado`, no como dato del expediente:
   * un veredicto verificado significa que los umbrales del proveedor se cumplieron, y eso es lo
   * único que Atlas puede afirmar. Si no hay ni veredicto ni puntaje, no se afirma nada.
   */
  async identitySignals(
    tenantId: string,
    customerId: string,
  ): Promise<{ verified: boolean; liveness: boolean; matchScore: number; confidence: number; inferred: boolean }> {
    const attempt = await this.identityAttempts.findOne({
      where: { tenantId, customerId },
      order: [['_id', 'DESC']],
    } as FindOptions);

    if (!attempt) return { verified: false, liveness: false, matchScore: 0, confidence: 0, inferred: false };
    const verified = attempt.finalResult === 'verified';

    // Los puntajes del proveedor llegan en 0..1; el artefacto los espera en 0..100.
    const liveness = toNumber(attempt.livenessScore);
    const selfie = clamp(Math.round(toNumber(attempt.selfieMatchScore) * 100), 0, 100);
    const name = clamp(Math.round(toNumber(attempt.nameMatchScore) * 100), 0, 100);
    const hasScores = liveness > 0 || selfie > 0 || name > 0;

    if (hasScores) {
      return { verified, liveness: liveness > 0, matchScore: selfie, confidence: name, inferred: false };
    }

    /*
     * Sin desglose. Se atestigua el aprobado del proveedor con el valor mínimo que la política
     * considera aprobado (70) y no con uno alto: Atlas no puede afirmar que la coincidencia fue
     * excelente, solo que fue suficiente para quien la midió.
     */
    return {
      verified,
      liveness: verified,
      matchScore: verified ? ATTESTED_PASS : 0,
      confidence: verified ? ATTESTED_PASS : 0,
      inferred: verified,
    };
  }
}
