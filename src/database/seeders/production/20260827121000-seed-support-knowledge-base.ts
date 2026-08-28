/**
 * @file Seeder idempotente: instala datos de referencia o fixtures del perfil.
 * @business Las primeras respuestas publicadas: lo que evita abrir un caso para preguntar lo mismo.
 * @system siembra `knowledge_articles` con su versión publicada y su búsqueda en español.
 */
import { createHash } from 'node:crypto';
import { QueryInterface, QueryTypes } from 'sequelize';
import { atlasSchemaFor } from '../../domain-schemas.js';

type SeedContext = { context: QueryInterface };

const ARTICLES = `${atlasSchemaFor('knowledge_articles')}.knowledge_articles`;
const VERSIONS = `${atlasSchemaFor('knowledge_article_versions')}.knowledge_article_versions`;

/**
 * Contenido de PRODUCCIÓN, no relleno de demostración.
 *
 * Un centro de ayuda vacío no deflecta nada: el buscador devuelve cero resultados y todo el mundo
 * abre un caso. Estas seis respuestas cubren los motivos que más consultas generan y se publican
 * como versión 1, con su aprobador pendiente de asignar por el equipo dueño.
 *
 * Cada artículo dice CUÁNDO ESCALAR. Una guía que no lo dice convierte a la persona en alguien que
 * insiste con instrucciones que ya no aplican a su caso.
 */
const ARTICLES_SEED = [
  {
    key: 'no-recibo-el-codigo',
    audience: 'PUBLIC_CONSUMER',
    owner: 'support',
    faq: true,
    featured: true,
    title: 'No me llega el código de verificación',
    question: '¿Qué hago si no recibo el código para entrar a mi cuenta?',
    short: 'Revisa la señal, espera un minuto y pide otro código. Si tras tres intentos no llega, escríbenos y lo revisamos.',
    body: [
      '## Qué revisar primero',
      '',
      '1. Que tengas señal y espacio en la bandeja de mensajes del teléfono.',
      '2. Que el número que aparece en pantalla sea el tuyo y esté completo.',
      '3. Espera un minuto antes de pedir otro código: los mensajes a veces llegan con retraso.',
      '',
      '## Si aún así no llega',
      '',
      'Pide un código nuevo desde la misma pantalla. Cada código anterior deja de servir en cuanto pides otro,',
      'así que usa siempre el último que recibiste.',
      '',
      '## Lo que nunca debes hacer',
      '',
      'No compartas el código con nadie, ni siquiera con alguien que diga ser de Atlas. Nosotros nunca te lo pedimos.',
    ].join('\n'),
    escalate: 'Si pediste tres códigos en quince minutos y ninguno llegó, abre un caso: puede ser un problema del operador o de tu número registrado.',
    tags: ['acceso', 'otp', 'codigo', 'ingresar'],
    terms: ['no me llega el codigo', 'no recibo otp', 'no puedo entrar', 'codigo de verificacion'],
  },
  {
    key: 'pague-y-no-me-lo-reconocen',
    audience: 'AUTHENTICATED_CONSUMER',
    owner: 'payments',
    faq: true,
    featured: true,
    title: 'Pagué mi cuota y todavía figura pendiente',
    question: '¿Por qué mi pago no aparece si ya transferí?',
    short: 'El comprobante es evidencia, no confirmación: el comercio verifica que el dinero entró y recién ahí se registra el pago.',
    body: [
      '## Por qué pasa',
      '',
      'Cuando pagas por transferencia, el dinero llega a la cuenta del comercio, no a Atlas. Por eso tu comprobante',
      'sirve como evidencia pero no salda la cuota por sí solo: alguien tiene que confirmar que ese dinero entró.',
      '',
      '## Qué hacer',
      '',
      '1. Avisa el pago desde la app y adjunta el comprobante con la referencia que te dio tu banco.',
      '2. Espera la verificación del comercio. Mientras tanto tu aviso queda registrado con fecha.',
      '3. Si el comercio confirma, la cuota se marca pagada con la fecha en que avisaste.',
      '',
      '## Qué NO hacer',
      '',
      'No pagues dos veces por las dudas. Si crees que el cobro se duplicó, abre un caso y lo revisamos.',
    ].join('\n'),
    escalate: 'Si pasaron más de 48 horas hábiles desde tu aviso y sigue pendiente, o si el comercio lo rechazó y no estás de acuerdo, abre un caso: pasa al equipo de operaciones.',
    tags: ['pagos', 'comprobante', 'transferencia', 'cuota'],
    terms: ['pague y no aparece', 'mi pago no figura', 'comprobante rechazado'],
  },
  {
    key: 'como-se-evalua-mi-credito',
    audience: 'AUTHENTICATED_CONSUMER',
    owner: 'credit',
    faq: true,
    featured: false,
    title: 'Cómo se evalúa tu solicitud de crédito',
    question: '¿Por qué me aprobaron o rechazaron, y qué puedo hacer?',
    short: 'La evaluación combina tu identidad verificada, tu capacidad de pago y tu historial. Puedes pedir la explicación de tu resultado.',
    body: [
      '## Qué se mira',
      '',
      '- Que tu identidad esté verificada y tus datos sean consistentes.',
      '- Tu capacidad de pago según la información que aportaste.',
      '- Tu comportamiento previo con Atlas, si ya eres cliente.',
      '',
      '## Si el resultado no fue el esperado',
      '',
      'Puedes pedirnos la explicación de los motivos principales de la decisión. Soporte te explica el resultado y',
      'qué información adicional puedes presentar, pero **no modifica la evaluación**: eso lo hace el equipo que',
      'corresponde, con su propio procedimiento y su registro.',
    ].join('\n'),
    escalate: 'Si crees que la decisión se basó en información equivocada, abre un caso indicando qué dato es incorrecto: se deriva al especialista de crédito.',
    tags: ['credito', 'evaluacion', 'limite'],
    terms: ['por que me rechazaron', 'mi limite', 'evaluacion de credito'],
  },
  {
    key: 'sospecho-que-entraron-a-mi-cuenta',
    audience: 'PUBLIC_CONSUMER',
    owner: 'security',
    faq: true,
    featured: true,
    title: 'Creo que alguien entró a mi cuenta',
    question: '¿Qué hago si veo movimientos que no reconozco?',
    short: 'Escríbenos de inmediato desde la app. No compartas tus claves con nadie, ni siquiera con quien diga ser de Atlas.',
    body: [
      '## Qué hacer ahora',
      '',
      '1. Abre un caso desde la app marcando «Creo que alguien entró a mi cuenta».',
      '2. Cuéntanos qué movimiento no reconoces y cuándo lo viste.',
      '3. No compartas por ningún canal tu contraseña, tu PIN ni tus códigos de verificación.',
      '',
      '## Qué hacemos nosotros',
      '',
      'Tu caso entra directo al equipo de seguridad con prioridad máxima y visibilidad restringida: sólo quien lo',
      'investiga puede leerlo.',
      '',
      '## Recuerda',
      '',
      'Atlas nunca te pedirá tu contraseña, tu PIN, tu código de verificación ni tu código de recuperación.',
    ].join('\n'),
    escalate: 'Este caso no espera: se escala a seguridad en cuanto se abre, sin que tengas que pedirlo.',
    tags: ['seguridad', 'fraude', 'acceso'],
    terms: ['me hackearon', 'entraron a mi cuenta', 'movimientos que no reconozco'],
  },
  {
    key: 'mi-qr-de-cobro-no-carga',
    audience: 'PARTNER',
    owner: 'support',
    faq: true,
    featured: true,
    title: 'Mi QR de cobro no carga',
    question: '¿Qué reviso si el QR del comercio no se muestra?',
    short: 'Verifica que el QR esté vigente en tu portal y que no haya sido reemplazado. Si sigue sin cargar, abre un caso con la sucursal afectada.',
    body: [
      '## Qué revisar',
      '',
      '1. Que el QR figure vigente en tu portal: un QR reemplazado deja de mostrarse.',
      '2. Que la sucursal y el terminal estén activos.',
      '3. Que la imagen se haya subido completa (a veces una carga interrumpida deja el archivo a medias).',
      '',
      '## Mientras se resuelve',
      '',
      'Tus clientes pueden seguir pagando por los otros medios habilitados. El aviso de pago con comprobante',
      'sigue funcionando aunque el QR no cargue.',
    ].join('\n'),
    escalate: 'Si el QR figura vigente y aun así no carga, abre un caso indicando la sucursal: pasa a soporte de comercios.',
    tags: ['qr', 'cobro', 'comercio'],
    terms: ['qr no carga', 'no se ve el qr', 'qr roto'],
  },
  {
    key: 'como-funciona-mi-caso-de-soporte',
    audience: 'PUBLIC_CONSUMER',
    owner: 'support',
    faq: true,
    featured: false,
    title: 'Cómo funciona tu caso de soporte',
    question: '¿Qué significa cada estado y cuándo me responden?',
    short: 'Cada caso tiene un número, un estado y un plazo. Cerrar el chat no cierra el caso: puedes salir y volver.',
    body: [
      '## Los estados que verás',
      '',
      '- **Recibido**: ya está en nuestro sistema con su número.',
      '- **En revisión**: lo estamos clasificando.',
      '- **Estamos trabajando**: alguien lo tiene asignado.',
      '- **Necesitamos tu respuesta**: te pedimos algo y esperamos.',
      '- **Estamos investigando**: depende de una revisión interna.',
      '- **Solución enviada**: te respondimos; puedes confirmarnos o decirnos que sigue igual.',
      '- **Cerrado**: quedó terminado. Puedes pedir reabrirlo si el problema vuelve.',
      '',
      '## Cerrar el chat no cierra tu caso',
      '',
      'Si se te corta la conexión o cierras la app, tu caso sigue igual y te avisamos cuando haya novedades.',
    ].join('\n'),
    escalate: 'Si tu caso lleva más tiempo del plazo que te indicamos sin novedades, escríbenos en la misma conversación: eso lo pone en revisión del supervisor.',
    tags: ['soporte', 'caso', 'estados'],
    terms: ['estado de mi caso', 'cuanto tardan', 'como sigo mi reclamo'],
  },
];

async function tenantIds(queryInterface: QueryInterface): Promise<string[]> {
  const rows = await queryInterface.sequelize.query<{ id: string }>(
    `SELECT _id AS id FROM ${atlasSchemaFor('tenants')}.tenants WHERE _deleted = FALSE ORDER BY _id;`,
    { type: QueryTypes.SELECT },
  );
  return rows.map((row) => String(row.id));
}

export async function up({ context: queryInterface }: SeedContext): Promise<void> {
  for (const tenantId of await tenantIds(queryInterface)) {
    for (const article of ARTICLES_SEED) {
      const [inserted] = await queryInterface.sequelize.query<{ _id: string }>(
        `INSERT INTO ${ARTICLES}
           (_tenant_id, article_key, audience, status, owner_team, is_faq, is_featured, review_cycle_days,
            next_review_at, helpful_count, not_helpful_count, display_order)
         VALUES (:tenantId, :key, :audience, 'PUBLISHED', :owner, :faq, :featured, 180,
                 NOW() + INTERVAL '180 days', 0, 0, 100)
         ON CONFLICT (_tenant_id, article_key) DO UPDATE SET
           audience = EXCLUDED.audience,
           owner_team = EXCLUDED.owner_team,
           is_faq = EXCLUDED.is_faq,
           is_featured = EXCLUDED.is_featured,
           _updated_at = NOW()
         RETURNING _id;`,
        {
          replacements: {
            tenantId,
            key: article.key,
            audience: article.audience,
            owner: article.owner,
            faq: article.faq,
            featured: article.featured,
          },
          type: QueryTypes.SELECT,
        },
      );
      const articleId = String(inserted._id);
      const checksum = createHash('sha256').update(`${article.title}${article.body}`).digest('hex');

      const [version] = await queryInterface.sequelize.query<{ _id: string }>(
        `INSERT INTO ${VERSIONS}
           (_tenant_id, article_id, version_number, locale, status, title, question, short_answer,
            body_markdown, tags_json, canonical_query_terms_json, escalate_when, change_reason, checksum, published_at)
         VALUES (:tenantId, :articleId, 1, 'es-BO', 'PUBLISHED', :title, :question, :short,
                 :body, CAST(:tags AS JSONB), CAST(:terms AS JSONB), :escalate,
                 'Versión inicial sembrada con el motor de soporte.', :checksum, NOW())
         ON CONFLICT (article_id, locale, version_number) DO UPDATE SET
           title = EXCLUDED.title,
           question = EXCLUDED.question,
           short_answer = EXCLUDED.short_answer,
           body_markdown = EXCLUDED.body_markdown,
           tags_json = EXCLUDED.tags_json,
           canonical_query_terms_json = EXCLUDED.canonical_query_terms_json,
           escalate_when = EXCLUDED.escalate_when,
           checksum = EXCLUDED.checksum,
           _updated_at = NOW()
         RETURNING _id;`,
        {
          replacements: {
            tenantId,
            articleId,
            title: article.title,
            question: article.question,
            short: article.short,
            body: article.body,
            tags: JSON.stringify(article.tags),
            terms: JSON.stringify(article.terms),
            escalate: article.escalate,
            checksum,
          },
          type: QueryTypes.SELECT,
        },
      );

      await queryInterface.sequelize.query(
        `UPDATE ${ARTICLES} SET current_version_id = :versionId, _updated_at = NOW() WHERE _id = :articleId;`,
        { replacements: { versionId: String(version._id), articleId } },
      );
    }
  }
}

export async function down({ context: queryInterface }: SeedContext): Promise<void> {
  const keys = ARTICLES_SEED.map((article) => article.key);
  await queryInterface.sequelize.query(
    `UPDATE ${ARTICLES} SET current_version_id = NULL WHERE article_key IN (:keys);`,
    { replacements: { keys } },
  );
  await queryInterface.sequelize.query(
    `DELETE FROM ${VERSIONS} WHERE article_id IN (SELECT _id FROM ${ARTICLES} WHERE article_key IN (:keys));`,
    { replacements: { keys } },
  );
  await queryInterface.sequelize.query(`DELETE FROM ${ARTICLES} WHERE article_key IN (:keys);`, { replacements: { keys } });
}
