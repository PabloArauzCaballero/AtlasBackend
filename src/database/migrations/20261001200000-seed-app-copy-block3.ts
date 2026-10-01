/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Pasa al portal los textos de pagos, comprobante, soporte y Ayuda que la app llevaba fijos en el código.
 * @system siembra 8 textos más en la superficie `copy` de `app_content_entries`.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLE = `${atlasSchemaFor('app_content_entries')}.app_content_entries`;
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;

/**
 * Bloque 3 de los textos sueltos, TAL CUAL los lleva la app de fábrica (`copy-catalog.ts` de AtlasFrontend,
 * de donde se generaron estos valores). La superficie `copy` ya existe (20261001180000): no hay cambio de
 * restricción. Sólo si falta: no pisa lo editado en el portal ni resucita lo retirado.
 */
const COPY: Array<{ key: string; order: number; pantalla: string; donde: string; title: string | null; body: string }> = [
  {
    key: 'pago.qr_instruccion',
    order: 160,
    pantalla: 'Pagos',
    donde: 'Bajo «Paga con el QR…», al pagar una cuota',
    title: null,
    body: 'Abre la app de tu banco, escanea este código y paga el monto exacto.',
  },
  {
    key: 'pago.comprobante_falta',
    order: 170,
    pantalla: 'Pagos',
    donde: 'Al avisar un pago sin haber adjuntado el comprobante',
    title: null,
    body: 'Adjunta el comprobante de tu transferencia antes de avisar.',
  },
  {
    key: 'pago.comprobante_evidencia',
    order: 180,
    pantalla: 'Pagos',
    donde: 'Tras avisar un pago: qué pasa con el comprobante. Dice que te avisamos al confirmarlo',
    title: null,
    body: 'Tu comprobante es evidencia, no confirma el pago por sí solo. Lo damos por pagado cuando el comercio confirma que recibió el dinero. Te avisamos apenas ocurra.',
  },
  {
    key: 'pago.ya_pagaste',
    order: 190,
    pantalla: 'Pagos',
    donde: 'Tarjeta «Ya pagaste», donde se adjunta el comprobante',
    title: 'Ya pagaste',
    body: 'Adjunta el comprobante de tu transferencia. Es lo que el comercio mira para confirmarla.',
  },
  {
    key: 'soporte.cabecera',
    order: 200,
    pantalla: 'Soporte',
    donde: 'Cabecera de la tarjeta de búsqueda en Soporte',
    title: '¿Con qué te ayudamos?',
    body: 'Escribe tu duda en tus palabras.',
  },
  {
    key: 'soporte.ninguno',
    order: 210,
    pantalla: 'Soporte',
    donde: 'Última opción de la lista de ayuda: abrir la conversación',
    title: 'Ninguno de estos / prefiero contarlo',
    body: 'Abrimos la conversación y la clasificamos nosotros.',
  },
  {
    key: 'soporte.dato_oculto',
    order: 220,
    pantalla: 'Soporte',
    donde: 'Bajo un mensaje del chat al que se le quitó un dato sensible',
    title: null,
    body: 'Ocultamos un dato sensible de este mensaje por tu seguridad.',
  },
  {
    key: 'ayuda.hablar',
    order: 230,
    pantalla: 'Ayuda',
    donde: 'Tarjeta «¿Necesitas hablar con alguien?» de Ayuda',
    title: '¿Necesitas hablar con alguien?',
    body: 'Te respondemos por chat y queda registrado en tu caso.',
  },
];

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  for (const fila of COPY) {
    await queryInterface.sequelize.query(
      `
INSERT INTO ${TABLE} (
  _tenant_id, surface, content_key, locale, title, subtitle, body_md,
  bullets_json, metadata_json, display_order, is_active, published_at, _created_at
)
SELECT t._id, 'copy', :key, 'es-BO', :title, NULL, :body,
       NULL, CAST(:metadata AS JSONB), :ord, TRUE, NOW(), NOW()
FROM ${TENANTS} t
WHERE NOT EXISTS (
  SELECT 1 FROM ${TABLE} e
  WHERE e._tenant_id = t._id AND e.surface = 'copy' AND e.content_key = :key AND e.locale = 'es-BO'
);`,
      {
        replacements: {
          key: fila.key,
          title: fila.title,
          body: fila.body,
          metadata: JSON.stringify({ pantalla: fila.pantalla, donde: fila.donde }),
          ord: fila.order,
        },
      },
    );
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  // Sólo lo que sigue tal cual se sembró (`_updated_at` = `_created_at`): lo editado en el portal es suyo.
  for (const fila of COPY) {
    await queryInterface.sequelize.query(
      `DELETE FROM ${TABLE} WHERE surface = 'copy' AND content_key = :key AND _updated_at = _created_at;`,
      { replacements: { key: fila.key } },
    );
  }
}
