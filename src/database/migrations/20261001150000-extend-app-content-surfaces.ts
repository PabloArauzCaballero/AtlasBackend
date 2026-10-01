/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Saca del código de la app los textos de privacidad, el recorrido guiado y las promesas del alta, para editarlos desde el portal.
 * @system amplía `ck_app_content_entries_surface` con `tour`, `privacy`, `signup` y `payments`, y siembra las tres primeras.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLE = `${atlasSchemaFor('app_content_entries')}.app_content_entries`;
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;

const ANTES = ['onboarding', 'home', 'faq', 'help', 'legal', 'profile', 'credit'];
const NUEVAS = ['tour', 'privacy', 'signup', 'payments'];
const lista = (valores: string[]) => valores.map((valor) => `'${valor}'`).join(', ');

type Garantia = { text: string; icon: string };
type Pieza = {
  surface: 'tour' | 'privacy' | 'signup';
  key: string;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  bullets: Garantia[] | null;
  metadata: Record<string, unknown> | null;
  order: number;
};

/** Una promesa del alta: el dato que se pide, por qué, y las garantías que se dan sobre él. */
const promesa = (key: string, order: number, icon: string, dato: string, porque: string, garantias: Garantia[]): Pieza => ({
  surface: 'signup',
  key,
  title: dato,
  subtitle: null,
  body: porque,
  bullets: garantias,
  metadata: { icon },
  order,
});

const SOLO_ATLAS: Garantia = { icon: 'ojo', text: 'Solo Atlas' };
const NUNCA_AL_COMERCIO: Garantia = { icon: 'comercio', text: 'Nunca al comercio' };
const CIFRADO: Garantia = { icon: 'candado', text: 'Cifrado' };
const NO_SE_GUARDA: Garantia = { icon: 'escudo', text: 'No se guarda' };
const ULTIMAS_CIFRAS: Garantia = { icon: 'ojo', text: 'Solo las últimas cifras' };

/**
 * Los textos que la app llevaba fijos en el código, TAL CUAL: `features/tour-inicio.ts`,
 * `features/trust-copy.ts` y `app/(app)/privacidad.tsx`. Ya pasaron por la lista de frases
 * prohibidas de la app (`__tests__/textos-verdaderos.test.ts`); esta migración no reescribe nada, sólo
 * los pone donde negocio puede editarlos. La app conserva los suyos como respaldo: se abre sin red.
 *
 * Las promesas del alta son texto con implicaciones legales y SALEN del portal a propósito: quien firma
 * la política de privacidad es quien debe poder corregirlas sin esperar a una versión de las tiendas.
 */
const PIEZAS: Pieza[] = [
  // ── Recorrido guiado de Inicio (clave = el elemento que señala) ────────────────────────────
  {
    surface: 'tour',
    key: 'inicio.linea',
    title: 'Esto es lo que puedes gastar hoy',
    subtitle: null,
    body: 'Tu disponible es lo que te queda libre ahora mismo: el límite aprobado menos lo que aún debes. Es la cifra que manda cuando compras.',
    bullets: null,
    metadata: { icon: 'billetera' },
    order: 10,
  },
  {
    surface: 'tour',
    key: 'inicio.escanear',
    title: 'Comprar es escanear el QR del comercio',
    subtitle: null,
    body: 'En la caja, escaneas su código y escribes el monto. Antes de confirmar nada te mostramos cuánto pagas hoy y cómo quedan tus cuotas.',
    bullets: null,
    metadata: { icon: 'escanear' },
    order: 20,
  },
  {
    surface: 'tour',
    key: 'inicio.pagos',
    title: 'Tus cuotas se pagan al comercio',
    subtitle: null,
    body: 'Atlas nunca recibe tu dinero: cada cuota se paga al QR bancario del comercio donde compraste. Aquí te decimos cuál y cuándo.',
    bullets: null,
    metadata: { icon: 'escudo' },
    order: 30,
  },

  // ── Promesas del alta: qué se le dice a la persona sobre cada dato ─────────────────────────
  promesa('registro.1', 10, 'perfil', 'Tu nombre y tu apellido', 'El crédito se abre a tu nombre, no a una cuenta anónima.', [
    SOLO_ATLAS,
    NUNCA_AL_COMERCIO,
  ]),
  promesa('registro.2', 20, 'reloj', 'Tu fecha de nacimiento', 'Para firmar un crédito hay que tener 18 años cumplidos.', [
    { icon: 'check', text: 'Solo para la edad' },
    SOLO_ATLAS,
  ]),
  promesa(
    'registro.3',
    30,
    'telefono',
    'Tu teléfono y tu correo',
    'Ahí llega el código que confirma tu cuenta y los avisos de tus pagos.',
    [CIFRADO, { icon: 'ojo', text: 'Solo las últimas cifras' }],
  ),
  promesa('registro.4', 40, 'candado', 'Tu PIN de 4 dígitos', 'Impide que alguien con tu teléfono en la mano compre en tu nombre.', [
    NO_SE_GUARDA,
    { icon: 'escudo', text: 'Solo guardamos su huella' },
  ]),
  promesa('economia.1', 110, 'billetera', 'Cuánto ingresas y cuánto gastas', 'Es lo que fija una cuota que puedas pagar sin ahogarte.', [
    { icon: 'chispa', text: 'Lo decide el motor' },
    NUNCA_AL_COMERCIO,
  ]),
  promesa(
    'economia.2',
    120,
    'grafico',
    'De qué trabajas y desde cuándo',
    'Un ingreso estable pesa distinto que uno que empezó el mes pasado.',
    [{ icon: 'telefono', text: 'Sin llamar sin avisarte' }, SOLO_ATLAS],
  ),
  promesa('domicilio.1', 210, 'ubicacion', 'Dónde vives', 'Es requisito del expediente y por donde te buscamos si no contestas.', [
    CIFRADO,
    { icon: 'documento', text: 'Verificar y cobranza' },
    SOLO_ATLAS,
  ]),
  promesa(
    'domicilio.2',
    220,
    'chispa',
    'Tu ubicación, si la das',
    'Con el botón de ubicación o pegando un enlace de Maps. Puedes seguir sin darla. Si das el permiso, la app registra tu ubicación cada cierto tiempo mientras el permiso siga dado.',
    [{ icon: 'check', text: 'Opcional' }, { icon: 'reloj', text: 'Cada cierto tiempo' }, NUNCA_AL_COMERCIO],
  ),
  promesa('identidad.1', 310, 'documento', 'Tu número de carnet', 'Se consulta en el registro oficial para confirmar que es tuyo.', [
    NO_SE_GUARDA,
    ULTIMAS_CIFRAS,
  ]),
  promesa(
    'identidad.2',
    320,
    'camara',
    'Las fotos del carnet y tu selfie',
    'Separan que pidas crédito tú de que lo pida quien consiguió tus datos.',
    [{ icon: 'candado', text: 'Viaja por conexión segura' }, { icon: 'escudo', text: 'Solo verificación' }, NUNCA_AL_COMERCIO],
  ),
  promesa('referencias.1', 410, 'sobre', 'Dos personas de contacto', 'Son a quienes acudimos solo si dejamos de poder contactarte a ti.', [
    { icon: 'alerta', text: 'Solo si no te ubicamos' },
    { icon: 'billetera', text: 'Sin datos de tu deuda' },
  ]),

  // ── Privacidad: «Tus datos» ────────────────────────────────────────────────────────────────
  {
    surface: 'privacy',
    key: 'cabecera',
    title: 'Tus datos',
    subtitle: 'Que permisos diste, cuales puedes retirar y que puedes pedir sobre tu informacion.',
    body: null,
    bullets: null,
    metadata: null,
    order: 10,
  },
  {
    surface: 'privacy',
    key: 'permisos',
    title: 'Permisos que diste',
    subtitle: null,
    body: 'Retirar uno corta su uso de aqui en adelante. Lo que ya se decidio con ese dato se conserva, porque una decision de credito tiene que poder explicarse despues.',
    bullets: null,
    metadata: null,
    order: 20,
  },
  {
    surface: 'privacy',
    key: 'permisos.guardado.retirados',
    title: null,
    subtitle: null,
    body: 'Listo. Los permisos que retiraste dejan de usarse desde ahora.',
    bullets: null,
    metadata: null,
    order: 25,
  },
  {
    surface: 'privacy',
    key: 'permisos.guardado.igual',
    title: null,
    subtitle: null,
    body: 'Listo. Tus permisos quedan como estaban.',
    bullets: null,
    metadata: null,
    order: 26,
  },
  {
    surface: 'privacy',
    key: 'derechos',
    title: 'Pedir algo sobre tus datos',
    subtitle: null,
    body: 'Cada solicitud queda registrada con su fecha con un plazo de resolución de 15 días. Hoy la respuesta no te llega como aviso: vuelve a esta pantalla o escríbenos para saber cómo va.',
    bullets: null,
    metadata: null,
    order: 30,
  },
  {
    surface: 'privacy',
    key: 'derechos.ayuda',
    title: 'Que quieres pedir',
    subtitle: null,
    body: 'Elige qué derecho quieres ejercer sobre tus datos personales. La solicitud queda registrada con su fecha con un plazo de resolución de 15 días. Hoy no te enviamos un aviso cuando cambia de estado, así que escríbenos por soporte si quieres saber cómo va; puedes enviar otra distinta después.',
    bullets: null,
    metadata: null,
    order: 35,
  },
  {
    surface: 'privacy',
    key: 'solicitud.enviada',
    title: null,
    subtitle: null,
    body: 'Tu solicitud quedó registrada con un plazo de resolución de 15 días. No te enviaremos un aviso cuando cambie: escríbenos por soporte si quieres saber cómo va.',
    bullets: null,
    metadata: null,
    order: 36,
  },
  ...(
    [
      ['access', 'Ver mis datos', 'Que se sabe de mi y de donde salio.'],
      ['rectification', 'Corregir un dato', 'Algo esta mal escrito o desactualizado.'],
      ['portability', 'Llevarme mis datos', 'Recibirlos en un archivo que pueda usar en otro sitio.'],
      ['restriction', 'Limitar el uso', 'Que dejen de usarse para algo concreto.'],
      ['revocation', 'Retirar consentimientos', 'Dejar sin efecto los permisos que di.'],
      ['deletion', 'Borrar mi cuenta', 'Se revisa: hay datos que la ley obliga a conservar.'],
    ] as const
  ).map(([tipo, etiqueta, detalle], indice): Pieza => ({
    surface: 'privacy',
    key: `derecho.${tipo}`,
    title: etiqueta,
    subtitle: detalle,
    body: null,
    bullets: null,
    metadata: null,
    order: 40 + indice,
  })),
];

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ck_app_content_entries_surface;`);
  await queryInterface.sequelize.query(
    `ALTER TABLE ${TABLE} ADD CONSTRAINT ck_app_content_entries_surface CHECK (surface IN (${lista([...ANTES, ...NUEVAS])}));`,
  );

  for (const pieza of PIEZAS) {
    /*
     * Sólo si falta: reejecutar no puede pisar lo que alguien ya corrigió en el portal. Y el
     * `NOT EXISTS` no mira `_deleted` a propósito, para no resucitar una pieza que se retiró.
     */
    await queryInterface.sequelize.query(
      `
INSERT INTO ${TABLE} (
  _tenant_id, surface, content_key, locale, title, subtitle, body_md,
  bullets_json, metadata_json, display_order, is_active, published_at, _created_at
)
SELECT t._id, :surface, :key, 'es-BO', :title, :subtitle, :body,
       CAST(:bullets AS JSONB), CAST(:metadata AS JSONB), :ord, TRUE, NOW(), NOW()
FROM ${TENANTS} t
WHERE NOT EXISTS (
  SELECT 1 FROM ${TABLE} e
  WHERE e._tenant_id = t._id AND e.surface = :surface AND e.content_key = :key AND e.locale = 'es-BO'
);`,
      {
        replacements: {
          surface: pieza.surface,
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
   * Sólo se retiran las piezas que siguen tal cual se sembraron (`_updated_at` = `_created_at`): lo
   * que alguien editó o creó en el portal es suyo y un `down` no lo borra.
   *
   * Si queda algo en las superficies nuevas, la restricción anterior no puede volver (rechazaría
   * esas filas y el `ALTER` fallaría a mitad). En ese caso se deja la restricción ampliada: es
   * inofensiva y evita perder contenido de negocio por deshacer una migración.
   */
  for (const pieza of PIEZAS) {
    await queryInterface.sequelize.query(
      `DELETE FROM ${TABLE} WHERE surface = :surface AND content_key = :key AND _updated_at = _created_at;`,
      { replacements: { surface: pieza.surface, key: pieza.key } },
    );
  }
  const [filas] = (await queryInterface.sequelize.query(
    `SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE surface IN (${lista(NUEVAS)});`,
  )) as [Array<{ n: number }>, unknown];
  if (filas[0]?.n > 0) return;
  await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ck_app_content_entries_surface;`);
  await queryInterface.sequelize.query(
    `ALTER TABLE ${TABLE} ADD CONSTRAINT ck_app_content_entries_surface CHECK (surface IN (${lista(ANTES)}));`,
  );
}
