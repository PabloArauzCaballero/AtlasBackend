/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Pasa al portal los textos de pagos, comprobante, soporte, Ayuda y del alta (etapas, bloqueos, estado de la cuenta) que la app llevaba fijos en el código.
 * @system siembra 34 textos más en la superficie `copy` de `app_content_entries`.
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
  {
    key: 'etapa.contact_verification',
    order: 240,
    pantalla: 'Alta · etapas',
    donde: 'Etapa «Verifica tu teléfono» en la lista de pasos y en la cabecera de su pantalla',
    title: 'Verifica tu teléfono',
    body: 'Te enviamos un código para confirmar que es tuyo.',
  },
  {
    key: 'etapa.personal_data',
    order: 250,
    pantalla: 'Alta · etapas',
    donde: 'Etapa «Tus datos personales» en la lista de pasos y en la cabecera de su pantalla',
    title: 'Tus datos personales',
    body: 'Nombre, apellido y fecha de nacimiento.',
  },
  {
    key: 'etapa.financial_profile',
    order: 260,
    pantalla: 'Alta · etapas',
    donde: 'Etapa «Tu situación económica» en la lista de pasos y en la cabecera de su pantalla',
    title: 'Tu situación económica',
    body: 'Trabajo, ingresos y gastos declarados.',
  },
  {
    key: 'etapa.address',
    order: 270,
    pantalla: 'Alta · etapas',
    donde: 'Etapa «Tu domicilio» en la lista de pasos y en la cabecera de su pantalla',
    title: 'Tu domicilio',
    body: 'Dónde vives actualmente.',
  },
  {
    key: 'etapa.identity_documents',
    order: 280,
    pantalla: 'Alta · etapas',
    donde: 'Etapa «Tu documento de identidad» en la lista de pasos y en la cabecera de su pantalla',
    title: 'Tu documento de identidad',
    body: 'Foto del carnet por ambos lados y tres selfies: de frente y de cada lado.',
  },
  {
    key: 'etapa.reference_contacts',
    order: 290,
    pantalla: 'Alta · etapas',
    donde: 'Etapa «Tus referencias» en la lista de pasos y en la cabecera de su pantalla',
    title: 'Tus referencias',
    body: 'Opcional: personas que puedan dar referencia de ti.',
  },
  {
    key: 'etapa.device_permissions',
    order: 300,
    pantalla: 'Alta · etapas',
    donde: 'Etapa «Permisos del teléfono» en la lista de pasos y en la cabecera de su pantalla',
    title: 'Permisos del teléfono',
    body: 'Ubicación y contactos: decides tú, y puedes decir que no.',
  },
  {
    key: 'etapa.consumer_survey',
    order: 310,
    pantalla: 'Alta · etapas',
    donde: 'Etapa «Tus hábitos» en la lista de pasos y en la cabecera de su pantalla',
    title: 'Tus hábitos',
    body: 'Seis preguntas cortas sobre cómo manejas tu dinero.',
  },
  {
    key: 'bloqueo.ACCOUNT_NOT_ACTIVE',
    order: 320,
    pantalla: 'Alta · revisión',
    donde: 'Lo que se dice cuando el servidor reporta el bloqueo ACCOUNT_NOT_ACTIVE',
    title: 'Cuenta en proceso',
    body: 'Tu cuenta todavía no está activa.',
  },
  {
    key: 'bloqueo.CONTACT_NOT_VERIFIED',
    order: 330,
    pantalla: 'Alta · revisión',
    donde: 'Lo que se dice cuando el servidor reporta el bloqueo CONTACT_NOT_VERIFIED',
    title: 'Teléfono sin verificar',
    body: 'Confirma el código que te enviamos.',
  },
  {
    key: 'bloqueo.FINANCIAL_PROFILE_INCOMPLETE',
    order: 340,
    pantalla: 'Alta · revisión',
    donde: 'Lo que se dice cuando el servidor reporta el bloqueo FINANCIAL_PROFILE_INCOMPLETE',
    title: 'Falta tu información económica',
    body: 'Completa trabajo, ingresos y gastos.',
  },
  {
    key: 'bloqueo.ADDRESS_MISSING',
    order: 350,
    pantalla: 'Alta · revisión',
    donde: 'Lo que se dice cuando el servidor reporta el bloqueo ADDRESS_MISSING',
    title: 'Falta tu domicilio',
    body: 'Indica dónde vives.',
  },
  {
    key: 'bloqueo.REFERENCES_INSUFFICIENT',
    order: 360,
    pantalla: 'Alta · revisión',
    donde: 'Lo que se dice cuando el servidor reporta el bloqueo REFERENCES_INSUFFICIENT',
    title: 'Referencias',
    body: 'Ya no son obligatorias: puedes agregarlas si quieres.',
  },
  {
    key: 'bloqueo.IDENTITY_DOCUMENT_MISSING',
    order: 370,
    pantalla: 'Alta · revisión',
    donde: 'Lo que se dice cuando el servidor reporta el bloqueo IDENTITY_DOCUMENT_MISSING',
    title: 'Falta tu documento',
    body: 'Sube tu carnet de identidad.',
  },
  {
    key: 'bloqueo.IDENTITY_NOT_VERIFIED',
    order: 380,
    pantalla: 'Alta · revisión',
    donde: 'Lo que se dice cuando el servidor reporta el bloqueo IDENTITY_NOT_VERIFIED',
    title: 'Identidad en revisión',
    body: 'Una persona está revisando tu carnet y tu selfie.',
  },
  {
    key: 'bloqueo.CONSUMER_SURVEY_INCOMPLETE',
    order: 390,
    pantalla: 'Alta · revisión',
    donde: 'Lo que se dice cuando el servidor reporta el bloqueo CONSUMER_SURVEY_INCOMPLETE',
    title: 'Faltan tus hábitos',
    body: 'Contesta las seis preguntas.',
  },
  {
    key: 'bloqueo.DEVICE_PERMISSIONS_UNDECIDED',
    order: 400,
    pantalla: 'Alta · revisión',
    donde: 'Lo que se dice cuando el servidor reporta el bloqueo DEVICE_PERMISSIONS_UNDECIDED',
    title: 'Falta decidir los permisos',
    body: 'Ubicación y contactos: puedes decir que no.',
  },
  {
    key: 'bloqueo.EVIDENCE_PENDING_REVIEW',
    order: 410,
    pantalla: 'Alta · revisión',
    donde: 'Lo que se dice cuando el servidor reporta el bloqueo EVIDENCE_PENDING_REVIEW',
    title: 'Documentos en revisión',
    body: 'Un analista está revisando lo que enviaste.',
  },
  {
    key: 'bloqueo.RISK_NOT_APPROVED',
    order: 420,
    pantalla: 'Alta · revisión',
    donde: 'Lo que se dice cuando el servidor reporta el bloqueo RISK_NOT_APPROVED',
    title: 'Evaluación en curso',
    body: 'Estamos evaluando tu solicitud.',
  },
  {
    key: 'ciclo.registered',
    order: 430,
    pantalla: 'Alta · estado de la cuenta',
    donde: 'Cabecera del progreso del alta cuando la cuenta está «registered»',
    title: 'Cuenta creada',
    body: 'Termina de completar tus datos para pedir tu línea.',
  },
  {
    key: 'ciclo.onboarding_in_progress',
    order: 440,
    pantalla: 'Alta · estado de la cuenta',
    donde: 'Cabecera del progreso del alta cuando la cuenta está «onboarding_in_progress»',
    title: 'Registro en curso',
    body: 'Te falta poco para terminar.',
  },
  {
    key: 'ciclo.under_review',
    order: 450,
    pantalla: 'Alta · estado de la cuenta',
    donde: 'Cabecera del progreso del alta cuando la cuenta está «under_review»',
    title: 'Cuenta en revisión',
    body: 'Una persona está revisando tu identidad y tus datos. Te avisamos apenas tu cuenta esté verificada.',
  },
  {
    key: 'ciclo.observed',
    order: 460,
    pantalla: 'Alta · estado de la cuenta',
    donde: 'Cabecera del progreso del alta cuando la cuenta está «observed»',
    title: 'Necesitamos una correccion',
    body: 'Revisa las observaciones y vuelve a enviar.',
  },
  {
    key: 'ciclo.active',
    order: 470,
    pantalla: 'Alta · estado de la cuenta',
    donde: 'Cabecera del progreso del alta cuando la cuenta está «active»',
    title: 'Cuenta activa',
    body: 'Ya puedes comprar con Atlas.',
  },
  {
    key: 'ciclo.rejected',
    order: 480,
    pantalla: 'Alta · estado de la cuenta',
    donde: 'Cabecera del progreso del alta cuando la cuenta está «rejected»',
    title: 'Solicitud no aprobada',
    body: 'Por ahora no podemos habilitar tu línea.',
  },
  {
    key: 'ciclo.suspended',
    order: 490,
    pantalla: 'Alta · estado de la cuenta',
    donde: 'Cabecera del progreso del alta cuando la cuenta está «suspended»',
    title: 'Cuenta suspendida',
    body: 'Comunícate con soporte para revisar tu caso.',
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
