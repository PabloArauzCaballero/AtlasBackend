/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita operar con parámetros inseguros o ambiguos.
 * @system valida y compone configuración tipada al arrancar.
 */
import { z } from 'zod';
import { optionalUrlEnvSchema } from './env.primitives.js';

/**
 * ATLAS Decision Engine: el motor de políticas versionadas que decide crédito, riesgo y fraude.
 *
 * Vacío = integración APAGADA, y entonces la decisión de crédito NO se automatiza: cae a revisión
 * manual. Ese es el respaldo correcto. El heurístico `risk_heuristic_v0` sigue sirviendo al
 * onboarding, pero un motor ausente nunca debe traducirse en una aprobación automática de crédito
 * — decidir crédito con constantes escritas en código es justo lo que el propio autor de esas
 * constantes dejó anotado que no se hiciera.
 *
 * Hay DOS credenciales y no una porque el motor separa dos planos: la audiencia `runtime` (rol
 * `DECISION_RUNTIME`) sólo ejecuta decisiones, y el plano de gestión (rol `OPERATIONS`) es el que
 * carga desenlaces. Una sola llave para ambos le daría al componente que decide la capacidad de
 * reescribir la medida de su propio acierto.
 *
 * Bloque propio y no dentro de `env.schema.ts` por el gate de tamaño de archivo: la configuración
 * de una integración crece con la integración, y meterla en el esquema general lo empuja por
 * encima del límite cada vez que se añade una.
 */
export const decisionEngineEnvShape = {
  DECISION_ENGINE_BASE_URL: optionalUrlEnvSchema,
  DECISION_ENGINE_API_KEY: z.string().optional(),
  DECISION_ENGINE_OUTCOME_API_KEY: z.string().optional(),
  /*
   * Credencial del plano de GOBIERNO del motor: registrar el consentimiento del titular.
   *
   * Separada de la de ejecución por la misma razón que la de desenlaces: quien decide no debe poder
   * escribir el permiso que le autoriza a decidir. Si no está configurada se usa la de desenlaces,
   * que ya es del plano de gestión — no se cae a la de ejecución en ningún caso.
   */
  DECISION_ENGINE_GOVERNANCE_API_KEY: z.string().optional(),
  /**
   * El inquilino DEL MOTOR con el que habla este backend por el plano de gestión (catálogo de
   * artefactos, casos de revisión manual, worker de extractos). Es el tenant del Motor, no el de
   * Atlas: son dos instalaciones y sus identificadores no tienen por qué coincidir. Estaba clavado
   * a `'1'` en tres sitios; ahora es una sola variable con ese mismo valor por defecto.
   */
  DECISION_ENGINE_TENANT_ID: z.string().trim().min(1).max(64).default('1'),
  /**
   * Cuántas horas vale una decisión de crédito para CONCEDER (P-10/P-11, 2026-09-24).
   *
   * Pasado ese plazo el desembolso se niega (`CREDIT_DECISION_EXPIRED`) y la reserva de cupo deja
   * de contar: una aprobación vieja se tomó con otra deuda, otra línea y otros consentimientos. 72 h
   * es el valor conservador por defecto; el plazo real lo ratifica Riesgo (docs/compliance/decisions.md).
   */
  CREDIT_DECISION_VALIDITY_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(72),
  /**
   * Credencial con la que se encarga la LOCUCIÓN de bienvenida al worker de audio del motor.
   *
   * Es una tercera llave y no la de gobierno reaprovechada porque lo que autoriza cuesta dinero:
   * cada locución que no está en caché es una llamada facturada a ElevenLabs. Una credencial propia
   * es lo que permite revocarla —o recortarle el rol— sin tocar el consentimiento ni los desenlaces,
   * que es exactamente lo que hay que poder hacer el día en que alguien encuentre la forma de pedir
   * locuciones en bucle. Si no está configurada se cae a la de gobierno, que ya es del plano de
   * gestión; nunca a la de ejecución.
   */
  DECISION_ENGINE_AUDIO_API_KEY: z.string().optional(),
  /**
   * Cuánto se espera al worker de locución. Aparte del timeout de las decisiones, y más largo.
   *
   * Medido contra el motor local: encolar una locución tarda entre uno y catorce segundos —el
   * worker consulta su caché por contenido, su presupuesto y su cuota antes de contestar—, mientras
   * que una decisión de crédito contesta por debajo del segundo. Con los 10 s de
   * `DECISION_ENGINE_TIMEOUT_MS` la mitad de los saludos se abortaban por timeout y llegaban al
   * móvil como fallo. Aquí esperar de más no cuesta nada: quien espera es una petición de fondo que
   * nadie está mirando.
   */
  DECISION_ENGINE_AUDIO_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(25_000),
  /**
   * Plantilla del catálogo de locución con la que se saluda a quien acaba de entrar.
   *
   * Es un CÓDIGO de plantilla, no un texto: el motor no locuta texto libre. Ahí está el control —lo
   * que se puede poner en boca de la marca lo decide el catálogo del tenant, que se cambia sin
   * desplegar esta app—, y de paso lo que impide que un cliente manipulado consiga que la voz de
   * Atlas diga cualquier cosa.
   */
  DECISION_ENGINE_WELCOME_TEMPLATE: z.string().trim().max(160).default('onboarding.welcome.named'),
  /**
   * A qué plantilla caer cuando no se sabe el nombre de quien entra.
   *
   * `onboarding.welcome.named` lleva la variable `{{name}}` y sin ella el motor rechaza la
   * solicitud. Eso pasa más de lo que parece: un cliente recién creado todavía no tiene versión de
   * perfil publicada. Saludar sin nombre es peor que saludar con nombre y mucho mejor que no
   * saludar.
   */
  DECISION_ENGINE_WELCOME_FALLBACK_TEMPLATE: z.string().trim().max(160).default('onboarding.welcome.generic'),
  /**
   * Código del artefacto que resuelve una solicitud de crédito en el Motor.
   *
   * El defecto era `credit_underwriting`, un código que EL MOTOR NO TIENE: toda solicitud caía en
   * 404 y se resolvía como `engine_unavailable_manual`, con el crédito esperando a una persona sin
   * que nada dijera que el motor ni se había consultado (ver
   * `20260824030000-create-decision-artifact-bindings.ts`). Aquello se tapó en el compose y con la
   * tabla de asignaciones, pero el defecto del esquema seguía roto: quien arranca sin compose y sin
   * fila de asignación —un entorno nuevo, un proceso suelto— heredaba el fallo entero. Ahora el
   * defecto es el código real; la asignación por inquilino sigue mandando sobre él.
   */
  DECISION_ENGINE_CREDIT_ARTIFACT: z.string().trim().min(1).max(120).default('ATLAS_BNPL_UNDERWRITING'),
  /**
   * Artefacto que evalúa el riesgo de onboarding, el trabajo que hoy hace `risk_heuristic_v0`.
   *
   * Vacío = el motor no participa en riesgo y manda la política local. Se puede apagar por separado
   * del de crédito porque son dos decisiones distintas con dos artefactos distintos, y una
   * instalación puede querer automatizar una y todavía no la otra.
   */
  DECISION_ENGINE_RISK_ARTIFACT: z.string().trim().max(120).optional(),
  /**
   * Artefacto que verifica la identidad de una persona con su carnet y su selfie.
   *
   * Vacío = el flujo móvil de verificación no está disponible y sus endpoints
   * contestan 503 en vez de fallar a mitad. Se apaga por separado de los otros
   * dos por lo mismo: son tres decisiones distintas con tres artefactos
   * distintos, y una instalación puede querer automatizar una y no las demás.
   *
   * El valor por defecto es el código que el motor siembra
   * (`identity-mobile.seed.ts`), de modo que un entorno de desarrollo funcione
   * sin configurar nada.
   */
  DECISION_ENGINE_IDENTITY_ARTIFACT: z.string().trim().max(120).default('IDENTIDAD_CARNET_MOVIL'),

  /*
   * El artefacto que verifica el expediente del comercio (KYB).
   *
   * Existía desplegado en el Motor desde el 2026-08-27 y no lo ejecutaba nadie: la decisión que
   * habilita a un comercio a cobrar se firmaba a mano en el portal, sin versión de política ni
   * traza. Igual que los otros tres, el valor del entorno es sólo el RESPALDO: manda la fila de
   * `decision_artifact_bindings` cuando alguien elige de verdad desde el portal.
   */
  DECISION_ENGINE_PARTNER_ARTIFACT: z.string().trim().max(120).default('PARTNER_KYB_REVIEW'),
  DECISION_ENGINE_ENVIRONMENT_CODE: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_-]{2,40}$/)
    .optional(),
  /**
   * Ruta del healthcheck del motor. Parametrizada por la misma razón que la del ERP: el prefijo de
   * rutas es del otro repo y un cambio suyo no debe leerse aquí como «motor caído».
   */
  /**
   * Dirección del motor SÓLO para reportar su salud en el panel de sistemas.
   *
   * Existe aparte de `DECISION_ENGINE_BASE_URL` porque son dos permisos distintos: integrarse con
   * el motor para decidir crédito exige credenciales reales y sal de sujeto —y el arranque lo
   * verifica—, mientras que preguntarle «¿estás en pie?» no exige nada. Sin esta separación, un
   * despliegue que sólo quiere ver el motor en el panel tendría que encender la automatización del
   * crédito para conseguirlo, que es exactamente al revés de lo prudente. Si `BASE_URL` está
   * configurada manda ella: la integración real sabe mejor dónde vive el motor.
   */
  DECISION_ENGINE_HEALTH_BASE_URL: optionalUrlEnvSchema,
  /**
   * Ruta del manifiesto de catálogo del motor.
   *
   * El manifiesto enumera las rutas que el motor sirve y las tablas que su base contiene; es lo que
   * permite que el catálogo del portal deje de ser «las tablas de Atlas Backend» y pase a ser el del
   * ecosistema.
   *
   * NO hay credencial que configurar, y es a propósito: el motor trata a ESTE backend como su
   * proveedor de identidad, así que la lectura viaja con el token de la persona que la pidió. Una
   * llave de servicio aquí sustituiría a esa persona por «Atlas» en la auditoría del motor y
   * saltaría su control de roles, que es justo lo que no debe pasar cuando la fuente de verdad de
   * las identidades es este backend.
   */
  DECISION_ENGINE_CATALOG_PATH: z.string().trim().min(1).max(200).default('/v1/platform/catalog-manifest'),
  /**
   * Ruta del resumen de accesos del motor, la evidencia con la que Flujos verifica sus flujos.
   * Parametrizada por lo mismo que la del manifiesto: el prefijo de su API es SUYO. Escribirla a
   * pelo aquí daba un 404, que se leería como «ese bloque no ha ejecutado nada».
   */
  DECISION_ENGINE_ACCESS_RUNS_PATH: z.string().trim().min(1).max(200).default('/v1/audit/access-runs'),
  /** Plazo propio del manifiesto: una introspección completa no cabe en el tiempo de un healthcheck. */
  DECISION_ENGINE_CATALOG_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
  /**
   * Ruta de listado de artefactos del motor, para la vista de artefactos activos del portal.
   *
   * Parametrizada por la misma razón que el healthcheck: el prefijo de rutas es del otro repo y un
   * cambio suyo no debe leerse aquí como «el motor no tiene artefactos».
   */
  DECISION_ENGINE_ARTIFACTS_PATH: z.string().trim().min(1).max(200).default('/v1/artifacts'),
  DECISION_ENGINE_DEPLOYMENTS_PATH: z.string().trim().min(1).max(200).default('/v1/deployments'),
  DECISION_ENGINE_HEALTH_PATH: z.string().trim().min(1).max(200).default('/health'),
  DECISION_ENGINE_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(10_000),
  /**
   * La verificación de identidad tiene su propio plazo y NO se reintenta.
   *
   * El worker lee el carnet y coteja la cara: medido en TEST el 2026-09-18, 11,4 s. Con el plazo
   * general de 10 s el cliente abortaba y reintentaba con la misma clave de idempotencia; el motor
   * contestaba `409 IDEMPOTENCY_IN_PROGRESS` y el intento quedaba `UNAVAILABLE` aunque la decisión
   * se tomara y se cobrara. Un reintento aquí sólo puede producir ese 409.
   */
  DECISION_ENGINE_IDENTITY_TIMEOUT_MS: z.coerce.number().int().positive().max(180_000).default(60_000),
  DECISION_ENGINE_RETRIES: z.coerce.number().int().min(0).max(5).default(1),
  DECISION_ENGINE_RETRY_BASE_DELAY_MS: z.coerce.number().int().positive().max(10_000).default(250),
  /**
   * Sal del identificador opaco del sujeto.
   *
   * Cambiarla rompe la unión con las decisiones históricas: el mismo cliente pasaría a verse como
   * uno nuevo y su historia dentro del motor quedaría partida en trozos que ya no se pueden volver
   * a unir. Rotarla es una migración, no un ajuste de configuración.
   */
  DECISION_ENGINE_SUBJECT_SALT: z.string().optional(),
  /**
   * Credencial con la que se manda el extracto bancario al worker del motor.
   *
   * ## Por qué el extracto lo lee el motor y no este backend
   *
   * Porque el motor ya sabe leerlo, y este backend no. El worker de extractos del motor tiene siete
   * analizadores verificados de bancos bolivianos, reconocimiento óptico, el padrón de ASFI con el
   * que atribuye el documento a su emisor, y las tres compuertas de admisión —contenedor, contenido
   * y emisor—. Lo que había aquí era un lector de expresiones regulares que sumaba todo lo que
   * decía «abono» y restaba todo lo que decía «cargo».
   *
   * Mantener dos implementaciones de la misma regla es peor que tener una mala: acaban discrepando,
   * y el día que discrepan nadie sabe cuál de las dos es la que decidió. Así que aquí no queda
   * ninguna: este backend recibe el archivo, lo manda, y aplica lo que el motor concluya.
   *
   * ## Por qué es una llave PROPIA
   *
   * Es la cuarta y por el mismo criterio que las otras tres: lo que autoriza es distinto. Ésta
   * permite subir documentos de clientes al worker del motor, que es la operación con más dato
   * personal de toda la integración; poder revocarla sin tocar las decisiones, los desenlaces ni la
   * locución es exactamente lo que hay que poder hacer el día que se sospeche de ella. Si no está
   * configurada se cae a la de gobierno, que ya es del plano de gestión, nunca a la de ejecución.
   */
  DECISION_ENGINE_STATEMENT_API_KEY: z.string().optional(),
  /**
   * Cuánto se espera a CADA llamada del worker de extractos.
   *
   * Más largo que el de las decisiones porque la subida lleva el PDF entero —hasta 10 MiB— y la
   * carga de un archivo por la red no se parece a una petición JSON de dos kilobytes.
   */
  DECISION_ENGINE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().positive().max(120_000).default(30_000),
  /**
   * Cada cuánto se pregunta por el resultado, y hasta cuándo.
   *
   * El worker del motor es asíncrono: responde 202 y procesa aparte. Quien espera aquí es un trabajo
   * de fondo con el compromiso de 24 horas por delante, así que sondear con calma no le cuesta nada
   * a nadie; lo que sí costaría es un sondeo apretado multiplicado por cada extracto de la cola.
   *
   * El techo existe para que un worker del motor caído no deje este trabajo colgado: al agotarse, la
   * revisión se queda como estaba y el siguiente barrido la vuelve a intentar. Es la diferencia
   * entre una espera larga y una espera infinita.
   */
  DECISION_ENGINE_STATEMENT_POLL_MS: z.coerce.number().int().positive().max(30_000).default(2_000),
  DECISION_ENGINE_STATEMENT_MAX_WAIT_MS: z.coerce.number().int().positive().max(600_000).default(180_000),

  /**
   * El tope legal de interés que el core hace cumplir de verdad (Frente 3A, plan
   * `_plan-motor-decisiones-tasa-2026-09-25`, T-4).
   *
   * Hasta el 2026-09-26 este valor estaba escrito DOS veces: `underwriting-features.service.ts` lo
   * mandaba al Motor como variable (`usury_cap_rate: 0.24`, sin poder cambiarlo sin desplegar) y
   * `loan-disbursement.service.ts` no lo miraba en absoluto — el desembolso aceptaba la tasa del
   * cuerpo de la petición sin ningún tope real (T-1). Ahora es UNA sola fuente, usada en los dos
   * sitios: la variable que se manda al Motor y el clamp real del desembolso.
   *
   * En TANTO POR UNO (`0.24`, no `24`), igual que exige el rol semántico `PRICED_RATE` del Motor.
   */
  USURY_CAP_RATE: z.coerce.number().positive().max(1).default(0.24),
};
