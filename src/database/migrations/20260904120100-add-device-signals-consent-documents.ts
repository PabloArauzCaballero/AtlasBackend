/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Convierte el permiso del sistema en un consentimiento probable y retirable, no en un diálogo del teléfono.
 * @system siembra los documentos `device_address_book` y `location_tracking`.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const DOCUMENTS = `${atlasSchemaFor('consent_documents')}.consent_documents`;
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;

/**
 * El permiso del sistema operativo NO es un consentimiento, y esta es la diferencia.
 *
 * El diálogo de iOS o Android sólo prueba que alguien pulsó «Permitir» en una caja que redacta
 * Apple. No dice qué se le prometió que se haría con eso, ni con qué texto, ni deja nada que
 * retirar después. Guardar la agenda entera y el rastro de posiciones de una persona apoyándose sólo
 * en ese diálogo es apoyarse en la prueba equivocada.
 *
 * Estos dos documentos son la prueba correcta: texto versionado, fecha de vigencia, y una fila en
 * `privacy.customer_consents` con el canal, la IP y la huella del dispositivo desde el que se
 * aceptó. Es lo mismo que ya se hacía con términos, privacidad e historial crediticio.
 *
 * ## Por qué `requires_explicit_action` es `false`
 *
 * Porque NO bloquean el alta. Quien niegue la agenda o la ubicación tiene que poder abrir una
 * cuenta igual; lo que cambia es cuánta evidencia hay en su expediente, y eso lo pondera el motor.
 * Marcarlos como obligatorios los metería en la lista que `customer-onboarding-guards` exige para
 * registrarse, y convertiría un permiso opcional en un peaje — además de romper el alta de toda
 * versión de la app anterior a esta.
 */
const DOCS = [
  {
    code: 'device_address_book',
    title: 'Tus contactos',
    summary: 'Nos autorizas a guardar los contactos de tu teléfono para verificar tu identidad y contactarte. Es opcional.',
    body: [
      '## Qué autorizas',
      '',
      'Que Atlas lea la agenda de tu teléfono y guarde la ficha de cada contacto —nombre, teléfonos,',
      'correos, empresa y cumpleaños— en nuestros servidores, cifrada.',
      '',
      '## Para qué la usamos',
      '',
      '- Verificar que las referencias que declaras son personas con las que realmente hablas.',
      '- Detectar solicitudes coordinadas: varias cuentas distintas que se avalan entre sí.',
      '- Localizarte a ti, a través de tus referencias, si perdemos contacto contigo.',
      '',
      '## Qué NO hacemos',
      '',
      'No escribimos a tus contactos, no les ofrecemos productos y no vendemos ni cedemos su',
      'información a terceros.',
      '',
      '## Tus contactos son terceros',
      '',
      'Las personas de tu agenda no nos autorizaron nada. Por eso guardamos su información cifrada,',
      'con el mismo tratamiento que la tuya, y la borramos cuando retiras este permiso.',
      '',
      '## Puedes retirarlo cuando quieras',
      '',
      'Desde «Privacidad» en la app. Al retirarlo dejamos de sincronizar tu agenda y borramos la que',
      'tengamos guardada. No afecta a tu línea de crédito ni a las condiciones de tus cuotas.',
      '',
      '## Aviso',
      '',
      'Esta es una versión genérica en revisión legal.',
    ].join('\n'),
  },
  {
    code: 'location_tracking',
    title: 'Tu ubicación',
    summary: 'Nos autorizas a registrar tu ubicación periódicamente para prevenir fraude. Es opcional.',
    body: [
      '## Qué autorizas',
      '',
      'Que Atlas registre la ubicación de tu teléfono cada cierto tiempo mientras usas la app y, si',
      'concedes el permiso «Siempre», también cuando la app está cerrada.',
      '',
      '## Para qué la usamos',
      '',
      '- Comprobar que el domicilio que declaras es donde realmente estás.',
      '- Detectar si alguien usa tu cuenta desde otro lugar.',
      '- Detectar ubicaciones simuladas, que es la señal más común de una solicitud fraudulenta.',
      '',
      '## Qué NO hacemos',
      '',
      'No compartimos tu ubicación con comercios ni con terceros, y no la usamos para publicidad.',
      '',
      '## Puedes retirarlo cuando quieras',
      '',
      'Desde «Privacidad» en la app, o quitando el permiso desde los ajustes de tu teléfono. Al',
      'retirarlo dejamos de registrar posiciones nuevas. No afecta a tu línea de crédito ni a las',
      'condiciones de tus cuotas.',
      '',
      '## Aviso',
      '',
      'Esta es una versión genérica en revisión legal.',
    ].join('\n'),
  },
];

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  for (const doc of DOCS) {
    /* Se inserta sólo si falta: reejecutar la migración no puede duplicar el documento. */
    await queryInterface.sequelize.query(
      `
INSERT INTO ${DOCUMENTS} (
  _tenant_id, document_code, version_code, language, title, summary, body_md,
  content_url, requires_explicit_action, effective_from, status, _created_at
)
SELECT t._id, :code, 'v1', 'es', :title, :summary, :body, NULL, false, DATE '2026-09-04', 'published', NOW()
FROM ${TENANTS} t
WHERE NOT EXISTS (
  SELECT 1 FROM ${DOCUMENTS} d
  WHERE d._tenant_id = t._id AND d.document_code = :code AND d.version_code = 'v1' AND d.language = 'es'
);`,
      { replacements: { code: doc.code, title: doc.title, summary: doc.summary, body: doc.body } },
    );
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  /*
   * Sólo se retira el documento si NADIE lo aceptó. Borrar uno con consentimientos colgando dejaría
   * filas en `customer_consents` apuntando a un texto que ya no se puede leer, y un consentimiento
   * cuyo texto no se puede reconstruir no prueba nada.
   */
  for (const doc of DOCS) {
    await queryInterface.sequelize.query(
      `
DELETE FROM ${DOCUMENTS} d
 WHERE d.document_code = :code
   AND NOT EXISTS (
     SELECT 1 FROM ${atlasSchemaFor('customer_consents')}.customer_consents c
      WHERE c.consent_document_id = d._id
   );`,
      { replacements: { code: doc.code } },
    );
  }
}
