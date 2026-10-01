/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Saca del código de la app los textos sueltos de las pantallas y las promesas del extracto, para editarlos desde el portal.
 * @system amplía `ck_app_content_entries_surface` con `copy` y siembra 15 textos (`copy`) y 4 promesas del extracto (`signup`, grupo `extracto`).
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const TABLE = `${atlasSchemaFor('app_content_entries')}.app_content_entries`;
const TENANTS = `${atlasSchemaFor('tenants')}.tenants`;

const ANTES = ['onboarding', 'home', 'faq', 'help', 'legal', 'profile', 'credit', 'tour', 'privacy', 'signup', 'payments'];
const lista = (valores: string[]) => valores.map((valor) => `'${valor}'`).join(', ');

/**
 * Textos sueltos de las pantallas, TAL CUAL los lleva la app de fábrica (`copy-catalog.ts` de AtlasFrontend,
 * de donde se generaron estos valores: no se reescribe nada). Cada clave la pide una pantalla concreta; el
 * portal enseña `donde` para que quien edita sepa qué está cambiando.
 *
 * Dicen lo que el sistema hace hoy (avisos que llegan, plazos): quien los edite en el portal responde de que
 * sigan siendo verdad.
 */
const COPY: Array<{ key: string; order: number; pantalla: string; donde: string; title: string | null; body: string }> = [
  {
    key: 'inicio.calculando',
    order: 10,
    pantalla: 'Inicio',
    donde: 'Bajo «Tu línea», mientras la política aún no la resuelve',
    title: null,
    body: 'Todavía estamos calculando tu línea. En cuanto la política la resuelva, aparecerá aquí.',
  },
  {
    key: 'inicio.pagos.vacio',
    order: 20,
    pantalla: 'Inicio',
    donde: 'Tarjeta «Tus pagos», cuando no hay una compra activa',
    title: null,
    body: 'Cuando tengas una compra activa, aquí aparece tu próxima cuota y el QR bancario del comercio donde pagarla.',
  },
  {
    key: 'pagos.subtitulo',
    order: 30,
    pantalla: 'Pagos',
    donde: 'Bajo el título «Tus pagos»',
    title: null,
    body: 'Agrupados por el comercio donde compraste.',
  },
  {
    key: 'pagos.vacio',
    order: 40,
    pantalla: 'Pagos',
    donde: 'Cuando todavía no hay cuotas que mostrar',
    title: 'Todavía no hay cuotas que mostrar',
    body: 'Cuando compres con Atlas, aquí verás en qué día te toca cada pago.',
  },
  {
    key: 'escanear.camara',
    order: 50,
    pantalla: 'Escanear',
    donde: 'Antes de pedir el permiso de la cámara',
    title: 'Necesitamos tu cámara',
    body: 'Solo la usamos mientras escaneas. No grabamos video ni guardamos imágenes.',
  },
  {
    key: 'escanear.qr.no_reconocido',
    order: 60,
    pantalla: 'Escanear',
    donde: 'Cuando el QR escaneado no es de Atlas',
    title: 'Este QR no es de Atlas',
    body: 'Pide al comercio el código QR de Atlas que está pegado en la caja. El QR del banco se usa después.',
  },
  {
    key: 'escanear.qr.revocado',
    order: 70,
    pantalla: 'Escanear',
    donde: 'Cuando el QR fue dado de baja',
    title: 'QR dado de baja',
    body: 'Este código fue revocado por seguridad. Pide al comercio el código vigente.',
  },
  {
    key: 'escanear.qr.vencido',
    order: 80,
    pantalla: 'Escanear',
    donde: 'Cuando el QR venció',
    title: 'QR vencido',
    body: 'Este código ya no está activo. Pide al comercio el código vigente.',
  },
  {
    key: 'avisos.resumen',
    order: 90,
    pantalla: 'Avisos',
    donde: 'Resumen de los avisos que SÍ llegan (Avisos y Preferencias). Dice lo que el sistema envía hoy',
    title: null,
    body: 'Hoy te avisamos de tus pagos (reportado, confirmado o rechazado), de la verificación de tu identidad y de cuando tu cuenta queda activa.',
  },
  {
    key: 'avisos.sin_recordatorios',
    order: 100,
    pantalla: 'Avisos',
    donde: 'En Preferencias, junto a los avisos de cuota que todavía no se envían',
    title: null,
    body: 'Todavía no te avisamos cuando se acerca o vence una cuota. Revisa tus fechas en la pestaña Pagos.',
  },
  {
    key: 'demo.compra',
    order: 110,
    pantalla: 'Pagos',
    donde: 'Cuando se intenta avisar un pago de una compra de demostración',
    title: null,
    body: 'Esta compra es de demostración: el aviso no se envía a ningún comercio. Los pagos reales se avisan desde Pagos, abriendo la cuota.',
  },
  {
    key: 'demo.plan_simulado',
    order: 120,
    pantalla: 'Compra',
    donde: 'Bajo el plan de pago simulado, al comprar',
    title: null,
    body: 'Simulación de demostración: no es una oferta ni un cobro. En un crédito real, el plazo, las cuotas y la tasa los fija Atlas al aprobar tu solicitud, y los ves en la pantalla de tu crédito.',
  },
  {
    key: 'cuota.vencida',
    order: 130,
    pantalla: 'Cuota',
    donde: 'En el detalle de una cuota vencida',
    title: null,
    body: 'Mientras esta cuota siga vencida, tu puntaje baja. Págala cuanto antes para que deje de afectarte.',
  },
  {
    key: 'puntaje.tramo_alto',
    order: 140,
    pantalla: 'Perfil',
    donde: 'Bajo el puntaje, cuando está en el tramo más alto',
    title: null,
    body: 'Estás en el tramo más alto. Mantenerlo depende de seguir pagando a tiempo.',
  },
  {
    key: 'puntaje.mora',
    order: 150,
    pantalla: 'Perfil',
    donde: 'Encabezado del aviso de mora bajo el puntaje',
    title: null,
    body: 'La mora te está costando puntos',
  },
];

/** Las 4 promesas de la pantalla del extracto: mismo formato que las del alta, en el grupo `extracto`. */
const EXTRACTO: Array<{ key: string; order: number; icon: string; title: string; body: string }> = [
  {
    key: 'extracto.1',
    order: 510,
    icon: 'candado',
    title: 'Viaja por una conexión segura',
    body: 'El archivo sube directo al almacén de Atlas por una conexión segura. Para subirlo, la app lo lee de una copia temporal en tu teléfono y la borra al terminar.',
  },
  {
    key: 'extracto.2',
    order: 520,
    icon: 'escudo',
    title: 'Solo se usa para calcular tu capacidad de pago',
    body: 'Es una entrada del cálculo, nada más. No se comparte con comercios, ni con terceros, ni se usa para publicidad.',
  },
  {
    key: 'extracto.3',
    order: 530,
    icon: 'ojo-tachado',
    title: 'Nadie lo lee por curiosidad',
    body: 'El acceso queda registrado y auditado. De tu extracto solo se extraen tus ingresos, tus gastos y los rechazos por fondos insuficientes.',
  },
  {
    key: 'extracto.4',
    order: 540,
    icon: 'reloj',
    title: 'Puedes pedir que lo borremos',
    body: 'Una vez recalculada tu línea, el archivo ya no hace falta. Pídelo desde Privacidad, en tu perfil, como solicitud de supresión de datos: queda registrada con un plazo de resolución de 15 días.',
  },
];

async function sembrar(
  queryInterface: QueryInterface,
  pieza: { surface: string; key: string; title: string | null; body: string; metadata: Record<string, unknown>; order: number },
): Promise<void> {
  /*
   * Sólo si falta: reejecutar no pisa lo editado en el portal ni resucita lo retirado (el `NOT EXISTS` no
   * mira `_deleted` a propósito).
   */
  await queryInterface.sequelize.query(
    `
INSERT INTO ${TABLE} (
  _tenant_id, surface, content_key, locale, title, subtitle, body_md,
  bullets_json, metadata_json, display_order, is_active, published_at, _created_at
)
SELECT t._id, :surface, :key, 'es-BO', :title, NULL, :body,
       NULL, CAST(:metadata AS JSONB), :ord, TRUE, NOW(), NOW()
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
        body: pieza.body,
        metadata: JSON.stringify(pieza.metadata),
        ord: pieza.order,
      },
    },
  );
}

export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ck_app_content_entries_surface;`);
  await queryInterface.sequelize.query(
    `ALTER TABLE ${TABLE} ADD CONSTRAINT ck_app_content_entries_surface CHECK (surface IN (${lista([...ANTES, 'copy'])}));`,
  );
  for (const fila of COPY) {
    await sembrar(queryInterface, {
      surface: 'copy',
      key: fila.key,
      title: fila.title,
      body: fila.body,
      metadata: { pantalla: fila.pantalla, donde: fila.donde },
      order: fila.order,
    });
  }
  for (const fila of EXTRACTO) {
    await sembrar(queryInterface, {
      surface: 'signup',
      key: fila.key,
      title: fila.title,
      body: fila.body,
      metadata: { icon: fila.icon },
      order: fila.order,
    });
  }
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  /*
   * Sólo se retiran las piezas que siguen tal cual se sembraron (`_updated_at` = `_created_at`): lo editado o
   * creado en el portal es suyo. Si queda algo en `copy`, la restricción anterior no puede volver (rechazaría
   * esas filas) y se deja ampliada: es inofensiva y evita perder contenido de negocio por deshacer.
   */
  const piezas = [
    ...COPY.map((fila) => ({ surface: 'copy', key: fila.key })),
    ...EXTRACTO.map((fila) => ({ surface: 'signup', key: fila.key })),
  ];
  for (const pieza of piezas) {
    await queryInterface.sequelize.query(
      `DELETE FROM ${TABLE} WHERE surface = :surface AND content_key = :key AND _updated_at = _created_at;`,
      { replacements: pieza },
    );
  }
  const [filas] = (await queryInterface.sequelize.query(`SELECT COUNT(*)::int AS n FROM ${TABLE} WHERE surface = 'copy';`)) as [
    Array<{ n: number }>,
    unknown,
  ];
  if (filas[0]?.n > 0) return;
  await queryInterface.sequelize.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT IF EXISTS ck_app_content_entries_surface;`);
  await queryInterface.sequelize.query(
    `ALTER TABLE ${TABLE} ADD CONSTRAINT ck_app_content_entries_surface CHECK (surface IN (${lista(ANTES)}));`,
  );
}
