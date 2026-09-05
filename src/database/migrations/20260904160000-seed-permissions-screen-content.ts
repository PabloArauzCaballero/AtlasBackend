/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Pone el texto de la pantalla de permisos en manos de quien responde de él, no de quien compila la app.
 * @system siembra las cinco piezas de la superficie `legal` que pinta `app/(public)/permisos.tsx`.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLE = `${atlasSchemaFor('app_content_entries')}.app_content_entries`;
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;

/**
 * El texto de la pantalla de permisos, sembrado para que el PORTAL pueda editarlo.
 *
 * ## Por qué se siembra si la app ya lo trae por defecto
 *
 * Por descubribilidad. `app_content_entries` no se siembra nunca —la tabla nace vacía— y eso
 * funciona para la bienvenida, donde quien edita ya sabe que existe `eslogan`. Aquí no: nadie va a
 * adivinar que la clave es `permisos.ubicacion`, así que sin estas filas el portal enseñaría una
 * lista vacía y el texto seguiría de hecho en el código, que es justo lo que se quiere evitar.
 *
 * Sembradas, quien entra en «Contenido de la app» ve exactamente lo que hoy sale en pantalla y lo
 * corrige encima. Los valores por defecto se quedan igualmente en la app, porque esta pantalla se
 * abre sin sesión y a veces sin red.
 *
 * ## Superficie `legal` y no `onboarding`
 *
 * `bienvenida.tsx` convierte **toda** entrada de `onboarding` que no sea `eslogan` en un paso de su
 * carrusel. Meter estas cinco ahí las pintaría como pantallas de bienvenida. `legal` está libre y
 * además dice lo que son: el texto con el que se pide un consentimiento.
 */
const PIEZAS = [
  {
    key: 'permisos.cabecera',
    title: 'Dos permisos, y para qué',
    subtitle:
      'Atlas presta dinero sin pedirte garantías. Estas dos señales son parte de lo que nos permite hacerlo. Puedes decir que no y abrir tu cuenta igual.',
    body: null,
    bullets: null,
    metadata: { eyebrow: 'Antes de empezar' },
    order: 10,
  },
  {
    key: 'permisos.ubicacion',
    title: 'Tu ubicación',
    subtitle: null,
    body: 'No la compartimos con los comercios ni la usamos para publicidad.',
    bullets: [
      { text: 'Comprobar que el domicilio que declaras es donde realmente estás.' },
      { text: 'Avisarte si alguien usa tu cuenta desde otro lugar.' },
      { text: 'Detectar ubicaciones simuladas, la señal más común de una solicitud falsa.' },
    ],
    metadata: null,
    order: 20,
  },
  {
    key: 'permisos.contactos',
    title: 'Tus contactos',
    subtitle: null,
    body: 'No les escribimos, no les ofrecemos nada y no vendemos su información.',
    bullets: [
      { text: 'Verificar que las referencias que das son personas con las que hablas.' },
      { text: 'Detectar varias cuentas distintas que se avalan entre sí.' },
      { text: 'Poder ubicarte a través de tus referencias si perdemos contacto contigo.' },
    ],
    metadata: null,
    order: 30,
  },
  {
    key: 'permisos.aviso',
    title: null,
    subtitle: null,
    body:
      'Tu teléfono te va a preguntar por cada permiso. Si eliges «Siempre» en la ubicación, también la registramos con la app cerrada; si eliges «Mientras uso la app», solo mientras la tienes abierta. Puedes cambiarlo cuando quieras desde «Privacidad» o desde los ajustes de tu teléfono.',
    bullets: null,
    metadata: null,
    order: 40,
  },
  {
    key: 'permisos.siempre',
    title: '¿También con la app cerrada?',
    subtitle:
      'Ya puedes seguir. Esto solo añade una señal más, y puedes decir que no sin que cambie nada de tu cuenta.',
    body:
      'Registramos tu ubicación cada cierto tiempo aunque no tengas la app abierta. Sirve para lo mismo: comprobar tu domicilio y detectar si alguien usa tu cuenta desde otro lugar.',
    bullets: null,
    metadata: { eyebrow: 'Un paso más, opcional' },
    order: 50,
  },
];

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  for (const pieza of PIEZAS) {
    /*
     * Sólo si falta. Reejecutar la migración no puede pisar lo que alguien ya corrigió en el portal:
     * el texto legal editado a mano es exactamente el que no se puede sobrescribir por un despliegue.
     */
    await queryInterface.sequelize.query(
      `
INSERT INTO ${TABLE} (
  _tenant_id, surface, content_key, locale, title, subtitle, body_md,
  bullets_json, metadata_json, display_order, is_active, published_at, _created_at
)
SELECT t._id, 'legal', :key, 'es-BO', :title, :subtitle, :body,
       CAST(:bullets AS JSONB), CAST(:metadata AS JSONB), :ord, TRUE, NOW(), NOW()
FROM ${TENANTS} t
WHERE NOT EXISTS (
  SELECT 1 FROM ${TABLE} e
  WHERE e._tenant_id = t._id AND e.surface = 'legal' AND e.content_key = :key AND e.locale = 'es-BO'
);`,
      {
        replacements: {
          key: pieza.key,
          title: pieza.title,
          subtitle: pieza.subtitle,
          body: pieza.body,
          bullets: pieza.bullets === null ? null : JSON.stringify(pieza.bullets),
          metadata: pieza.metadata === null ? null : JSON.stringify(pieza.metadata),
          ord: pieza.order,
        },
      },
    );
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  /*
   * Se retiran las cinco piezas. Al revés que un documento de consentimiento, aquí no queda nada
   * colgando: la app vuelve a pintar sus valores por defecto, que son los mismos textos.
   */
  await queryInterface.sequelize.query(
    `DELETE FROM ${TABLE} WHERE surface = 'legal' AND content_key IN (:keys);`,
    { replacements: { keys: PIEZAS.map((pieza) => pieza.key) } },
  );
}
