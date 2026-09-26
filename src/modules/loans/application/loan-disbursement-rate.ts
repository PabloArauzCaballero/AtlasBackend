/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business La tasa que se cobra no la elige libremente quien desembolsa.
 * @system resuelve y clampea la tasa del desembolso (Frente 3A). Separado de `loan-disbursement.service.ts`
 * por el gate de 300 líneas (`check:file-size`): es la MISMA regla que ya dividió otros dos archivos
 * de este Frente, no una carpeta nueva por capricho.
 */
import { BadRequestException, ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { env } from '../../../config/env.js';
import { InternalRbacRepository } from '../../internal-users/internal-rbac.repository.js';
import { DisburseLoanDto } from '../loans.schemas.js';

/**
 * Anular la tasa decidida es una operación con permiso propio, no un valor libre del cuerpo
 * (Frente 3A, plan `_plan-motor-decisiones-tasa-2026-09-25`, T-1). El valor que ese permiso autoriza
 * SIGUE clampeado al rango del producto y al tope de usura: el permiso autoriza a PEDIR una
 * excepción sobre la fuente de la tasa, nunca a saltarse el tope legal.
 */
export const OVERRIDE_RATE_PERMISSION = 'credit.loan_disbursement.override_rate';

function toNullableNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * La tasa ANTES de clampear: la que decidió el Motor, o si no hay decisión, la del producto.
 * `null` cuando NINGUNA de las dos existe — quien llama responde 422, nunca 0 % (T-1).
 */
function baseRateBeforeClamp(
  application: { decisionPricedRate: string | null },
  product: { annualInterestRate: string | null },
): number | null {
  const decided = toNullableNumber(application.decisionPricedRate);
  if (decided !== null) return decided;
  return toNullableNumber(product.annualInterestRate);
}

/**
 * El clamp real (T-1/T-4): al rango del producto cuando existe, y SIEMPRE al tope de usura. Los
 * límites ausentes (`null`) no acotan de ese lado — un producto sin `min`/`max` declarado no
 * bloquea, sólo deja de estrechar el rango.
 */
function clampRate(rate: number, minRate: number | null, maxRate: number | null, usuryCapPercent: number): number {
  let clamped = rate;
  if (minRate !== null) clamped = Math.max(clamped, minRate);
  if (maxRate !== null) clamped = Math.min(clamped, maxRate);
  return Math.min(clamped, usuryCapPercent);
}

/**
 * El permiso que un operador necesita para anular la tasa decidida (Frente 3A). `internalUserId`
 * ausente —un cliente, un token sin identidad interna— nunca puede tenerlo: ni siquiera se
 * consulta la base para eso.
 */
async function assertCanOverrideRate(rbac: InternalRbacRepository, currentUser: AuthenticatedUser, tenantId: string): Promise<void> {
  if (!currentUser.internalUserId) {
    throw new ForbiddenException(`Anular la tasa decidida exige una sesión interna con el permiso ${OVERRIDE_RATE_PERMISSION}.`);
  }
  const allowed = await rbac.hasPermissions(tenantId, currentUser.internalUserId, [OVERRIDE_RATE_PERMISSION]);
  if (!allowed) {
    throw new ForbiddenException(`El usuario interno no tiene el permiso ${OVERRIDE_RATE_PERMISSION} para anular la tasa decidida.`);
  }
}

/**
 * La tasa con la que se calcula el cronograma. Ya NO se acepta libre del cuerpo. En orden:
 *
 * 1. Si el operador manda `overrideAnnualInterestRate`, necesita el permiso
 *    `credit.loan_disbursement.override_rate` (403 si no) — el cuerpo YA exige `overrideReasonCode`
 *    junto a ella (`loans.schemas.ts`). Su valor sigue clampeado igual que cualquier otro: el
 *    permiso autoriza a PEDIR la excepción, no a saltarse el rango ni la usura.
 * 2. Si no hay override: la tasa que decidió el Motor (`application.decisionPricedRate`), o si no
 *    hay decisión (revisión humana, solicitud legado), la del producto.
 * 3. Si NINGUNA de las dos existe: **422** (`CREDIT_PRODUCT_WITHOUT_RATE`). Nunca 0 % — hasta el
 *    2026-09-26 un producto sin tasa desembolsaba gratis, y eso era el defecto, no una excepción.
 *
 * Lo que sale del paso 1 o 2 se clampea SIEMPRE a `[product.min, product.max, USURY_CAP_RATE]`
 * (los límites ausentes no acotan de ese lado): una tasa decidida por el Motor —o pedida por un
 * operador con permiso— fuera de rango se ajusta, nunca se usa tal cual.
 */
export async function resolveAnnualRate(input: {
  application: { decisionPricedRate: string | null };
  product: { annualInterestRate: string | null; minAnnualInterestRate: string | null; maxAnnualInterestRate: string | null };
  body: DisburseLoanDto;
  currentUser: AuthenticatedUser;
  tenantId: string;
  rbac: InternalRbacRepository;
}): Promise<number> {
  const minRate = toNullableNumber(input.product.minAnnualInterestRate);
  const maxRate = toNullableNumber(input.product.maxAnnualInterestRate);
  const usuryCapPercent = env.USURY_CAP_RATE * 100;

  if (input.body.overrideAnnualInterestRate !== undefined) {
    if (!Number.isFinite(input.body.overrideAnnualInterestRate) || input.body.overrideAnnualInterestRate < 0) {
      throw new BadRequestException('INVALID_INTEREST_RATE');
    }
    await assertCanOverrideRate(input.rbac, input.currentUser, input.tenantId);
    return clampRate(input.body.overrideAnnualInterestRate, minRate, maxRate, usuryCapPercent);
  }

  const baseRate = baseRateBeforeClamp(input.application, input.product);
  if (baseRate === null) throw new UnprocessableEntityException('CREDIT_PRODUCT_WITHOUT_RATE');
  return clampRate(baseRate, minRate, maxRate, usuryCapPercent);
}
