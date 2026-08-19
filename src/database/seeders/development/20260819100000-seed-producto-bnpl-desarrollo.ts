/**
 * @file Seeder de desarrollo: el producto de crédito BNPL con el que se puede pedir una compra.
 * @business Sin un producto activo el catálogo llega vacío y ningún cliente puede solicitar crédito.
 * @system define development para que el flujo de compra sea recorrible en una máquina nueva.
 */
import { QueryInterface, QueryTypes } from 'sequelize';

/**
 * El producto BNPL de Atlas en una base de desarrollo.
 *
 * ## Por qué existe
 *
 * `GET /customers/:id/credit-products` devolvía una lista vacía en toda instalación nueva, y
 * `POST /customers/:id/credit-applications` fallaba con `CREDIT_PRODUCT_NOT_FOUND` sin que nada
 * explicara qué faltaba. El resultado es que el camino completo —solicitud, motor de decisión,
 * originación— no se podía recorrer en local aunque todos los servicios estuvieran arriba: el
 * dominio de crédito parecía roto cuando lo único que pasaba es que no había nada que ofrecer.
 *
 * Las condiciones comerciales son dato administrado por negocio, no constantes del backend. Este
 * seeder NO pretende fijar la oferta real: pone una coherente con el modelo BNPL que documenta el
 * producto —60 % inicial y 3 cuotas cada 14 días, es decir unos 2 meses de calendario— para que
 * exista algo que solicitar. En producción el catálogo lo da de alta operaciones por su endpoint.
 *
 * ## Rango
 *
 * `min_amount` de Bs 40 y `max_amount` de Bs 4.000 acotan el importe FINANCIADO (el 40 %), que es
 * lo que la app envía como `requestedAmount`. Con el 60 % inicial encima, cubre compras de entre
 * Bs 100 y Bs 10.000 aproximadamente, que es el rango que el flujo de compra sabe presentar.
 *
 * ## Idempotencia por CÓDIGO
 *
 * La clave natural es `product_code` dentro del tenant, no el identificador: si el seeder se
 * reejecuta sobre una base que ya lo tiene, actualizar por código evita duplicar la oferta y
 * evita romper las solicitudes que ya apuntan al producto existente.
 */
const TENANT_ID = 1;
const PRODUCT_CODE = 'bnpl_atlas_estandar';

const PRODUCTO = {
  productCode: PRODUCT_CODE,
  productName: 'BNPL Atlas estandar',
  description: 'Compra dividida: 60% inicial y 3 cuotas cada 14 dias.',
  currencyCode: 'BOB',
  minAmount: '40.00',
  maxAmount: '4000.00',
  minTermMonths: 1,
  maxTermMonths: 6,
  annualInterestRate: '0.00',
  // Se siembra ACTIVO a propósito: un producto en `draft` no se oferta, y dejarlo así reproduce
  // exactamente el síntoma que este seeder viene a eliminar.
  status: 'active',
} as const;

export async function up({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  await queryInterface.sequelize.query(
    `
    INSERT INTO credit.credit_products (
      _tenant_id, product_code, product_name, description, currency_code,
      min_amount, max_amount, min_term_months, max_term_months,
      annual_interest_rate, requires_manual_review, status,
      effective_from, _created_at, _updated_at, _deleted
    ) VALUES (
      :tenantId, :productCode, :productName, :description, :currencyCode,
      :minAmount, :maxAmount, :minTermMonths, :maxTermMonths,
      :annualInterestRate, false, :status,
      now(), now(), now(), false
    )
    -- El predicado repite el del indice: ux_credit_products_tenant_code es PARCIAL
    -- (WHERE _deleted = false), y sin el Postgres no reconoce el conflicto y el INSERT revienta.
    ON CONFLICT (_tenant_id, product_code) WHERE _deleted = false DO UPDATE SET
      product_name = EXCLUDED.product_name,
      description = EXCLUDED.description,
      min_amount = EXCLUDED.min_amount,
      max_amount = EXCLUDED.max_amount,
      min_term_months = EXCLUDED.min_term_months,
      max_term_months = EXCLUDED.max_term_months,
      annual_interest_rate = EXCLUDED.annual_interest_rate,
      status = EXCLUDED.status,
      _updated_at = now(),
      _deleted = false;
  `,
    {
      type: QueryTypes.INSERT,
      replacements: { tenantId: TENANT_ID, ...PRODUCTO },
    },
  );
}

/**
 * El `down` sólo retira el producto si nadie lo solicitó.
 *
 * Borrarlo con solicitudes vivas dejaría expedientes apuntando a una oferta inexistente, que es
 * justo el estado que ninguna auditoría puede reconstruir. Si hay solicitudes, se retira el
 * producto del catálogo en lugar de eliminarlo: deja de ofertarse y la historia sigue en pie.
 */
export async function down({ context: queryInterface }: { context: QueryInterface }): Promise<void> {
  const [usado] = await queryInterface.sequelize.query<{ total: string }>(
    `
    SELECT count(*)::text AS total
    FROM credit.credit_applications a
    JOIN credit.credit_products p ON p._id = a.credit_product_id
    WHERE p._tenant_id = :tenantId AND p.product_code = :productCode;
  `,
    { type: QueryTypes.SELECT, replacements: { tenantId: TENANT_ID, productCode: PRODUCT_CODE } },
  );

  if (Number(usado?.total ?? '0') > 0) {
    await queryInterface.sequelize.query(
      `UPDATE credit.credit_products SET status = 'retired', _updated_at = now()
       WHERE _tenant_id = :tenantId AND product_code = :productCode;`,
      { type: QueryTypes.UPDATE, replacements: { tenantId: TENANT_ID, productCode: PRODUCT_CODE } },
    );
    return;
  }

  await queryInterface.sequelize.query(
    `DELETE FROM credit.credit_products WHERE _tenant_id = :tenantId AND product_code = :productCode;`,
    { type: QueryTypes.DELETE, replacements: { tenantId: TENANT_ID, productCode: PRODUCT_CODE } },
  );
}
