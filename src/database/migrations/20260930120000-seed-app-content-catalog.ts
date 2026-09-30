/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Hace que «Contenido de la app» enseñe lo que el cliente lee de verdad, y no una lista vacía.
 * @system siembra las superficies `onboarding`, `help` y `faq` de `app_content_entries` para cada tenant.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLE = `${atlasSchemaFor('app_content_entries')}.app_content_entries`;
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;

type Bullet = { text: string; icon?: string; emphasis?: boolean };
type Pieza = {
  surface: 'onboarding' | 'help' | 'faq';
  key: string;
  title: string | null;
  subtitle: string | null;
  body: string | null;
  bullets: Bullet[] | null;
  metadata: Record<string, unknown> | null;
  action: { kind: string; label: string; value: string } | null;
  order: number;
};

/**
 * Por qué hace falta esta migración.
 *
 * `app_content_entries` nace vacía y la siembra que la llenaba salió del repositorio
 * (`seeders/production/20260822100000`). El resultado: el portal enseñaba «0 piezas» en Bienvenida,
 * Preguntas frecuentes y Ayuda, y la app —que lee de aquí— pintaba lo que trae por defecto o nada.
 * Quien entraba a corregir un texto no encontraba qué corregir. Se hizo una vez para `legal`
 * (`20260904160000`); esto lo completa.
 *
 * ## Qué texto se siembra y qué no
 *
 * NO es el del seed antiguo. Ese prometía cosas que el sistema no hace (recordatorios de cuota,
 * «resultado en 24 horas», «se guarda cifrado», mora que bloquea la línea) y la auditoría del
 * 2026-09-29 las retiró de la app. Aquí sólo hay frases que ya pasan por la lista de prohibidas de la
 * app (`__tests__/textos-verdaderos.test.ts`). Son un punto de partida: quien responde del texto lo
 * edita desde el portal, y esta migración nunca lo pisa.
 *
 * ## Sólo si falta
 *
 * Reejecutar no puede sobrescribir lo que alguien ya corrigió en el portal, ni resucitar una pieza
 * que retiró: el `NOT EXISTS` no mira `_deleted`, a propósito.
 */
const PIEZAS: Pieza[] = [
  // ── Bienvenida ────────────────────────────────────────────────────────────────────────────────
  {
    surface: 'onboarding',
    key: 'eslogan',
    title: 'Eslogan',
    subtitle: 'Tu primer crédito no debería depender de un banco.',
    body: 'Crédito para comprar en los comercios de Santa Cruz.',
    bullets: null,
    metadata: null,
    action: null,
    order: 0,
  },
  {
    surface: 'onboarding',
    key: 'paso-1',
    title: 'Escaneas y listo',
    subtitle: 'En la caja del comercio escaneas su QR y escribes el monto. Sin tarjeta de crédito de por medio.',
    body: null,
    bullets: null,
    metadata: null,
    action: null,
    order: 1,
  },
  {
    surface: 'onboarding',
    key: 'paso-2',
    title: 'Pagas en cuotas mensuales',
    subtitle:
      'Atlas revisa tu solicitud y te asigna una línea con su tasa. Lo que compras con ella lo pagas en cuotas mensuales, y el detalle de cada cuota lo ves en la pantalla de tu crédito.',
    body: null,
    bullets: null,
    metadata: null,
    action: null,
    order: 2,
  },
  {
    surface: 'onboarding',
    key: 'paso-3',
    title: 'Construyes tu historial',
    subtitle:
      'Cada cuota que pagas a tiempo sube tu puntaje Atlas y tu línea. El historial que ningún buró tiene todavía, lo empiezas aquí.',
    body: null,
    bullets: null,
    metadata: null,
    action: null,
    order: 3,
  },

  // ── Ayuda y contacto ──────────────────────────────────────────────────────────────────────────
  {
    surface: 'help',
    key: 'whatsapp',
    title: '¿Necesitas ayuda?',
    subtitle: 'Escríbenos por WhatsApp.',
    body: null,
    bullets: null,
    metadata: { whatsappMessage: 'Hola, necesito ayuda con mi cuenta de Atlas.' },
    action: { kind: 'whatsapp', label: 'Escribir por WhatsApp', value: '77377232' },
    order: 0,
  },
  {
    surface: 'help',
    key: 'tour',
    title: 'Volver a ver el recorrido',
    subtitle: 'Te enseñamos otra vez cómo funciona cada pantalla.',
    body: null,
    bullets: null,
    metadata: null,
    action: { kind: 'tour', label: 'Repetir el recorrido', value: 'inicio' },
    order: 1,
  },

  // ── Preguntas frecuentes ──────────────────────────────────────────────────────────────────────
  {
    surface: 'faq',
    key: 'que-es-atlas',
    title: '¿Qué es exactamente Atlas?',
    subtitle: null,
    body: 'Atlas te permite comprar en comercios afiliados y pagar en cuotas mensuales, sin tarjeta de crédito y sin pasar por un banco.',
    bullets: [
      { text: 'No necesitas tarjeta de crédito ni cuenta en un banco específico.', icon: 'check' },
      { text: 'El registro se hace desde el celular.', icon: 'check' },
      {
        text: 'Lo que compras lo pagas en cuotas mensuales; el detalle de cada una lo ves en la pantalla de tu crédito.',
        icon: 'check',
        emphasis: true,
      },
    ],
    metadata: null,
    action: null,
    order: 10,
  },
  {
    surface: 'faq',
    key: 'como-se-calcula-mi-limite',
    title: '¿Cómo deciden cuánto me prestan?',
    subtitle: null,
    body: 'Tu línea la calcula el motor de decisión de Atlas con una política de crédito publicada y versionada. No sale de una tabla fija igual para todos.',
    bullets: [
      { text: 'Tu ingreso disponible: lo que te queda después de tus gastos declarados.', icon: 'billetera' },
      { text: 'Cómo pagas en Atlas: cada cuota puntual suma y cada atraso resta.', icon: 'tendencia' },
      { text: 'Tu extracto bancario, si decides subirlo.', icon: 'documento' },
    ],
    metadata: null,
    action: null,
    order: 20,
  },
  {
    surface: 'faq',
    key: 'para-que-el-extracto',
    title: '¿Para qué me piden el extracto bancario?',
    subtitle: null,
    body: 'Para calcular mejor tu capacidad de pago. Es el documento que cualquiera puede descargar de su banca en línea en un minuto.',
    bullets: [
      { text: 'Sirve como dato de entrada del cálculo de tu capacidad de pago.', icon: 'documento' },
      { text: 'Si quieres que lo eliminemos, lo pides como solicitud de supresión desde Privacidad.', icon: 'candado', emphasis: true },
    ],
    metadata: null,
    action: null,
    order: 30,
  },
  {
    surface: 'faq',
    key: 'que-pasa-si-me-atraso',
    title: '¿Qué pasa si me atraso en una cuota?',
    subtitle: null,
    body: 'Atrasarte baja tu puntaje Atlas, y con él tu línea. Lo que no pasa hoy: no cobramos interés penal y la mora no bloquea tu cuenta.',
    bullets: [
      { text: 'Ponerte al día lo revierte: el puntaje se recalcula con cada pago.', icon: 'check', emphasis: true },
      { text: 'Todavía no te avisamos cuando se acerca o vence una cuota. Revisa tus fechas en la pestaña Pagos.', icon: 'reloj' },
    ],
    metadata: null,
    action: null,
    order: 40,
  },
  {
    surface: 'faq',
    key: 'que-hacen-con-mis-datos',
    title: '¿Qué hacen con mis datos?',
    subtitle: null,
    body: 'Los usamos para decidir tu crédito y para cumplir lo que la normativa nos exige guardar. Puedes pedir ver qué tenemos de ti, corregirlo o retirar tu consentimiento desde Privacidad.',
    bullets: null,
    metadata: null,
    action: { kind: 'screen', label: 'Ir a Privacidad', value: '/privacidad' },
    order: 50,
  },
  {
    surface: 'faq',
    key: 'puedo-apagar-avisos',
    title: '¿Puedo apagar las notificaciones?',
    subtitle: null,
    body: 'Desde Preferencias de avisos eliges cuáles recibir. Hoy te avisamos de tus pagos (reportado, confirmado o rechazado), de la verificación de tu identidad y de cuando tu cuenta queda activa.',
    bullets: null,
    metadata: null,
    action: { kind: 'screen', label: 'Ir a preferencias de avisos', value: '/preferencias-avisos' },
    order: 60,
  },
];

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  for (const pieza of PIEZAS) {
    await queryInterface.sequelize.query(
      `
INSERT INTO ${TABLE} (
  _tenant_id, surface, content_key, locale, title, subtitle, body_md,
  bullets_json, metadata_json, action_kind, action_label, action_value,
  display_order, is_active, published_at, _created_at
)
SELECT t._id, :surface, :key, 'es-BO', :title, :subtitle, :body,
       CAST(:bullets AS JSONB), CAST(:metadata AS JSONB), :actionKind, :actionLabel, :actionValue,
       :ord, TRUE, NOW(), NOW()
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
          actionKind: pieza.action?.kind ?? null,
          actionLabel: pieza.action?.label ?? null,
          actionValue: pieza.action?.value ?? null,
          ord: pieza.order,
        },
      },
    );
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  /*
   * Sólo las piezas que siguen tal cual se sembraron (`_updated_at` igual a `_created_at`): lo que alguien editó en el
   * portal es suyo y un `down` no lo borra.
   */
  for (const pieza of PIEZAS) {
    await queryInterface.sequelize.query(
      `DELETE FROM ${TABLE} WHERE surface = :surface AND content_key = :key AND _updated_at = _created_at;`,
      { replacements: { surface: pieza.surface, key: pieza.key } },
    );
  }
}
