/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * El expediente verificable del comercio: quién es, quién lo representa y en qué estado está.
 *
 * Qué es y qué NO es. Aquí vive la EVIDENCIA de que un negocio existe, opera y está representado
 * por quien dice: razón social, NIT, matrícula, contactos probados y el veredicto del onboarding.
 * NO vive aquí su ficha comercial —cuenta B2B, contratos, facturación, planes—, que es del ERP.
 * `erp_account_id` es el puente, y es nulo mientras el expediente va por delante de la ficha, que
 * es el orden normal: primero se verifica, después se contrata.
 *
 * Por qué existe. El partner tenía un flujo comercial —un caso con checklist— que registra que
 * alguien revisó unos papeles: no emite códigos, no consulta listas y no deja evidencia. Un
 * comprador de 300 Bs pasaba por más verificación que el comercio que le vende a crédito.
 */
@Table({ tableName: 'partner_profiles', schema: atlasSchemaFor('partner_profiles'), timestamps: false })
export class PartnerProfileModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'legal_name', type: DataType.STRING(200), allowNull: false })
  declare legalName: string;

  @Column({ field: 'trade_name', type: DataType.STRING(200) })
  declare tradeName: string | null;

  /** NIT. Único por tenant: dos expedientes del mismo NIT son el mismo negocio. */
  @Column({ field: 'tax_id', type: DataType.STRING(40), allowNull: false })
  declare taxId: string;

  @Column({ field: 'commercial_registry', type: DataType.STRING(60) })
  declare commercialRegistry: string | null;

  @Column({ field: 'business_category', type: DataType.STRING(80) })
  declare businessCategory: string | null;

  @Column({ field: 'contact_email', type: DataType.STRING(180), allowNull: false })
  declare contactEmail: string;

  @Column({ field: 'contact_phone', type: DataType.STRING(40) })
  declare contactPhone: string | null;

  /**
   * Cuándo se PROBÓ que el comercio controla ese contacto, no cuándo lo declaró. La diferencia es
   * el eslabón entero de la verificación: declarar un correo no cuesta nada.
   */
  @Column({ field: 'email_verified_at', type: DataType.DATE })
  declare emailVerifiedAt: Date | null;

  @Column({ field: 'phone_verified_at', type: DataType.DATE })
  declare phoneVerifiedAt: Date | null;

  /**
   * Código de verificación del contacto, HASHEADO. Sólo hay uno vivo por comercio: pedir otro
   * invalida el anterior, porque dos códigos válidos a la vez duplican la ventana de adivinanza.
   */
  @Column({ field: 'contact_code_hash', type: DataType.STRING(200) })
  declare contactCodeHash: string | null;

  @Column({ field: 'contact_code_expires_at', type: DataType.DATE })
  declare contactCodeExpiresAt: Date | null;

  /** Intentos gastados. Sin contarlos, seis dígitos se adivinan probando dentro del propio TTL. */
  @Column({ field: 'contact_code_attempts', type: DataType.INTEGER, allowNull: false })
  declare contactCodeAttempts: number;

  @Column({ field: 'contact_code_sent_at', type: DataType.DATE })
  declare contactCodeSentAt: Date | null;

  /** `draft` → `contact_verified` → `documents_submitted` → `under_review` → `approved` | `rejected`. */
  /** La comisión del comercio, en %. Se cobra sólo sobre lo que el cliente paga. Default 3.00. */
  @Column({ field: 'mdr_rate_percent', type: DataType.DECIMAL(5, 2), allowNull: false, defaultValue: '3.00' })
  declare mdrRatePercent: string;

  @Column({ field: 'onboarding_status', type: DataType.STRING(30), allowNull: false })
  declare onboardingStatus: string;

  @Column({ field: 'submitted_at', type: DataType.DATE })
  declare submittedAt: Date | null;

  @Column({ field: 'decided_at', type: DataType.DATE })
  declare decidedAt: Date | null;

  @Column({ field: 'decided_by_internal_user_id', type: DataType.BIGINT })
  declare decidedByInternalUserId: string | null;

  /**
   * El usuario de comercio dueño del expediente, cuando lo abrió un comercio.
   *
   * Es contra esto que se comprueba la propiedad: sin dueño, cualquier usuario con rol `merchant`
   * del mismo tenant podía operar sobre el expediente de otro —incluidos sus QR de cobro—, porque
   * el `partnerId` viaja en la URL y no había nada que lo atara a quien llama.
   *
   * Nulo en los expedientes abiertos por personal interno, y en los que existían antes de que la
   * columna se añadiera. `assertOwnPartnerResource` trata ese caso como accesible sólo para roles
   * internos: un expediente sin dueño deja de ser autoservicio hasta que alguien lo reasigne.
   */
  @Column({ field: 'owner_merchant_user_id', type: DataType.BIGINT })
  declare ownerMerchantUserId: string | null;

  @Column({ field: 'rejection_reason', type: DataType.STRING(200) })
  declare rejectionReason: string | null;

  @Column({ field: 'erp_account_id', type: DataType.STRING(64) })
  declare erpAccountId: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE })
  declare updatedAtValue: Date | null;

  @Column({ field: '_deleted', type: DataType.BOOLEAN, allowNull: false })
  declare deleted: boolean;
}
