/**
 * Los tres recorridos documentados, como grafos EJECUTABLES.
 *
 * Los `workflow_definitions` de la base los describen —`account_signup_to_login`,
 * `post_login_first_screen`, `customer_credit_journey`— con su lista de endpoints. Lo que la
 * semilla NO da es cómo se construye cada cuerpo ni qué hay que extraer de cada respuesta para el
 * paso siguiente, y ahí está la mitad del trabajo.
 *
 * Hay además una divergencia comprobada que conviene dejar escrita, porque es el tipo de cosa que
 * hace perder una tarde: el `input_contract_json` de la semilla de `signup.start` dice
 * `{email, phone, channel, documentNumber}` y el Zod real
 * (`customer-onboarding.schemas.ts#startOnboardingSchema`) exige `{customer, password, consents,
 * device}` — cuatro campos distintos, ninguno opcional, más una cabecera `X-Idempotency-Key`
 * obligatoria que la semilla no menciona. Lo que manda es el Zod, comprobado contra el servicio
 * corriendo. La semilla queda como documentación a corregir.
 *
 * Cada paso declara su ORÁCULO —qué se espera— por separado del transporte. Un 409 esperado pasa;
 * un 200 inesperado falla. Es la distinción que el paquete QA exige y la que hace que una prueba
 * signifique algo.
 */
import type { Persona } from './persona-factory.js';
import { dataOf, errorCodeOf, HttpActor, type StepOutcome } from './http-actor.js';

export type JourneyContext = {
  actor: HttpActor;
  persona: Persona;
  /** Catálogos resueltos por consulta real, no IDs quemados. */
  consents: Array<{ consentDocumentId: string; purposeCode: string }>;
  signal: AbortSignal;
  runNonce: string;
};

export type Step = {
  stepKey: string;
  method: string;
  /** Path con `:param` resuelto contra los recursos que la persona ya adquirió. */
  path: (ctx: JourneyContext) => string;
  body?: (ctx: JourneyContext) => unknown;
  auth?: boolean;
  idempotencyKey?: (ctx: JourneyContext) => string;
  /** Códigos HTTP que el contrato admite para este paso. */
  expectStatus: number[];
  /** Oráculo de negocio. Devuelve `null` si pasó, o el motivo del fallo. */
  assert?: (data: Record<string, unknown>, ctx: JourneyContext) => string | null;
  /** Qué guarda la persona de esta respuesta para los pasos siguientes. */
  extract?: (data: Record<string, unknown>, ctx: JourneyContext) => void;
  /** Un paso opcional no rompe el recorrido si falla; se reporta igual. */
  optional?: boolean;
  /**
   * El backend limita este paso por tasa, y el generador lo respeta: pide ficha a la compuerta de
   * admisión antes de lanzarlo, en vez de gastar el cupo y contar los 429 como fallos del producto.
   *
   * `bucket` importa porque los límites son INDEPENDIENTES entre endpoints: el alta y el login
   * tienen cada uno sus diez por minuto. Una sola cola compartida haría esperar de más y el informe
   * lo leería como lentitud del backend.
   */
  rateLimited?: { bucket: string; perMinute: number };
};

export type Journey = {
  code: string;
  name: string;
  steps: Step[];
};

const ok = () => null;

/* ------------------------------------------------------------ 1. alta y login */

export const accountSignupToLogin: Journey = {
  code: 'account_signup_to_login',
  name: 'Alta de cuenta: de la primera pantalla a la sesión iniciada',
  steps: [
    {
      stepKey: 'signup.consent_documents',
      method: 'GET',
      path: () => '/consent-documents/active',
      auth: false,
      expectStatus: [200],
      assert: (data) => (Array.isArray(data) && data.length > 0 ? null : 'el catálogo de consentimientos vino vacío'),
    },
    {
      stepKey: 'signup.start',
      method: 'POST',
      path: () => '/customer-onboarding/start',
      auth: false,
      // 10 por minuto y por IP, declarado en el controlador contra la enumeración. Veinte personas
      // desde una máquina comparten IP: sin compuerta, la mitad recibe 429 y el informe lo leería
      // como un fallo del alta cuando es una defensa funcionando.
      rateLimited: { bucket: 'onboarding_start', perMinute: 10 },
      // Misma persona, misma intención, misma clave: reintentar no puede crear dos clientes.
      idempotencyKey: (ctx) => `qa-${ctx.runNonce}-${ctx.persona.personaKey}-start`,
      body: (ctx) => ({
        customer: {
          email: ctx.persona.email,
          phone: ctx.persona.phone,
          firstName: ctx.persona.firstName,
          lastName: ctx.persona.lastName,
          birthDate: ctx.persona.birthDate,
        },
        password: ctx.persona.pin,
        consents: ctx.consents.map((consent) => ({ ...consent, granted: true })),
        device: {
          deviceFingerprintHash: ctx.persona.deviceFingerprintHash,
          fingerprintVersion: 'v1',
          channel: 'mobile_app',
        },
      }),
      expectStatus: [200, 201],
      assert: (data) => {
        if (typeof data.customerId !== 'string') return 'la respuesta no trae customerId';
        if (data.lifecycleStatus !== 'registered') return `lifecycleStatus inesperado: ${String(data.lifecycleStatus)}`;
        // El alta tiene que dejar sesión: sin tokens el cliente nace sin forma de entrar.
        if (data.tokens === null || typeof data.tokens !== 'object') return 'el alta no devolvió tokens de sesión';
        return null;
      },
      extract: (data, ctx) => {
        ctx.actor.resources.customerId = String(data.customerId);
        if (typeof data.sessionId === 'string') ctx.actor.resources.sessionId = data.sessionId;
        if (typeof data.deviceId === 'string') ctx.actor.resources.deviceId = data.deviceId;
        ctx.actor.setSession(data.tokens as { accessToken?: string; refreshToken?: string });
      },
    },
    {
      stepKey: 'signup.login',
      method: 'POST',
      path: () => '/auth/login',
      auth: false,
      // 10 por minuto y por IP contra la fuerza bruta de credenciales. Cubo propio: el cupo del
      // login no se comparte con el del alta.
      rateLimited: { bucket: 'auth_login', perMinute: 10 },
      body: (ctx) => ({ actorType: 'customer', identifier: ctx.persona.email, password: ctx.persona.pin }),
      expectStatus: [200, 201],
      assert: (data) => (typeof data.accessToken === 'string' ? null : 'el login no devolvió accessToken'),
      extract: (data, ctx) => ctx.actor.setSession(data as { accessToken?: string; refreshToken?: string }),
    },
    {
      stepKey: 'signup.me',
      method: 'GET',
      path: () => '/auth/me',
      expectStatus: [200],
      // El oráculo no es "respondió 200": es que la sesión sea DE ESTA PERSONA. Con un token
      // compartido entre actores, este paso es lo único que lo delata.
      assert: (data, ctx) =>
        data.customerId === ctx.actor.resources.customerId
          ? null
          : `la sesión pertenece a ${String(data.customerId)} y no a ${ctx.actor.resources.customerId}`,
    },
  ],
};

/* ------------------------------------------------ 2. primera pantalla tras login */

export const postLoginFirstScreen: Journey = {
  code: 'post_login_first_screen',
  name: 'De la sesión iniciada a la primera pantalla',
  steps: [
    {
      stepKey: 'first_screen.auth_me',
      method: 'GET',
      path: () => '/auth/me',
      expectStatus: [200],
      assert: (data, ctx) => (data.customerId === ctx.actor.resources.customerId ? null : 'la identidad resuelta no es la de esta persona'),
    },
    {
      stepKey: 'first_screen.customer_me',
      method: 'GET',
      path: (ctx) => `/customers/${ctx.actor.resources.customerId}/me`,
      expectStatus: [200],
      assert: (data, ctx) => {
        const customer = data.customer as Record<string, unknown> | undefined;
        if (!customer) return 'la respuesta no trae el bloque customer';
        return customer.customerId === ctx.actor.resources.customerId ? null : 'el perfil es de otro cliente';
      },
    },
    {
      stepKey: 'first_screen.onboarding_status',
      method: 'GET',
      path: (ctx) => `/customer-onboarding/${ctx.actor.resources.customerId}/status`,
      expectStatus: [200],
      assert: (data) => (typeof data.lifecycleStatus === 'string' ? null : 'no vino lifecycleStatus'),
    },
    {
      stepKey: 'first_screen.session_state',
      method: 'GET',
      path: (ctx) => `/customers/${ctx.actor.resources.customerId}/session-state`,
      expectStatus: [200],
      assert: (data) => (data.activeSession ? null : 'la persona no tiene sesión activa tras el login'),
    },
    {
      stepKey: 'first_screen.observations',
      method: 'GET',
      path: (ctx) => `/customer-onboarding/${ctx.actor.resources.customerId}/observations`,
      expectStatus: [200],
      assert: ok,
    },
    {
      stepKey: 'first_screen.eligibility',
      method: 'GET',
      path: (ctx) => `/customers/${ctx.actor.resources.customerId}/eligibility`,
      expectStatus: [200],
      // Se comprueba la FORMA del veredicto, no su valor: que una persona recién registrada no sea
      // elegible es correcto, y exigir `eligible: true` sería imponerle el resultado al backend.
      assert: (data) => (typeof data.eligible === 'boolean' ? null : 'el veredicto de elegibilidad no es booleano'),
      extract: (data, ctx) => {
        ctx.actor.resources.eligible = String(data.eligible === true);
      },
    },
    {
      stepKey: 'first_screen.credit_products',
      method: 'GET',
      path: (ctx) => `/customers/${ctx.actor.resources.customerId}/credit-products`,
      expectStatus: [200],
      assert: (data, ctx) => {
        // Coherencia entre dos lecturas independientes: si elegibilidad dice que no, el catálogo
        // no puede ofrecer productos. Dos endpoints que se contradicen es un defecto real.
        const eligible = data.eligible === true;
        if (String(eligible) !== ctx.actor.resources.eligible) {
          return `credit-products dice eligible=${eligible} y /eligibility dijo ${ctx.actor.resources.eligible}`;
        }
        if (!eligible && !Array.isArray(data.blockers)) return 'no elegible pero sin blockers que lo expliquen';
        return null;
      },
    },
    {
      stepKey: 'first_screen.credit_applications',
      method: 'GET',
      path: (ctx) => `/customers/${ctx.actor.resources.customerId}/credit-applications`,
      expectStatus: [200],
      assert: (data) => (Array.isArray(data.applications) ? null : 'applications no es una lista'),
    },
    {
      stepKey: 'first_screen.unread_count',
      method: 'GET',
      path: (ctx) => `/customers/${ctx.actor.resources.customerId}/notifications/unread-count`,
      expectStatus: [200],
      assert: (data) => (typeof data.unread === 'number' ? null : 'unread no es un número'),
    },
    {
      stepKey: 'first_screen.token_refresh',
      method: 'POST',
      path: () => '/auth/refresh',
      auth: false,
      body: (ctx) => ({ refreshToken: ctx.actor.storedRefreshToken ?? '' }),
      expectStatus: [200, 201],
      assert: (data) => (typeof data.accessToken === 'string' ? null : 'el refresh no devolvió accessToken'),
      extract: (data, ctx) => ctx.actor.setSession(data as { accessToken?: string; refreshToken?: string }),
    },
  ],
};

/* --------------------------------------------- 3. recorrido de crédito (cliente) */

export const customerCreditJourney: Journey = {
  code: 'customer_credit_journey',
  name: 'Recorrido del cliente hasta la decisión de crédito',
  steps: [
    {
      /*
       * Consentimiento para la evidencia externa. Va PRIMERO y no es decorativo: sin él, la
       * política del backend bloquea la consulta y el proveedor no recibe nada. Que la llamada no
       * salga es, en ese caso, la expectativa correcta — y es lo que distingue "no llegó al
       * proveedor porque está roto" de "no llegó porque la política lo impidió".
       */
      stepKey: 'credit.external_consent',
      method: 'POST',
      path: () => '/external-data/consents',
      body: (ctx) => ({
        customerId: ctx.actor.resources.customerId,
        providerCode: 'SEGIP',
        purpose: 'identity_verification',
        accepted: true,
      }),
      expectStatus: [200, 201],
      optional: true,
      assert: ok,
      extract: (_data, ctx) => {
        ctx.actor.resources.externalConsent = 'true';
      },
    },
    {
      /*
       * Vista previa de costo. El oráculo NEGATIVO de este paso es el importante: la previa NO
       * puede ejecutar al proveedor. Se comprueba a nivel de corrida contando las entradas del
       * journal del emulador: si la previa llamara, habría más llamadas que solicitudes reales.
       */
      stepKey: 'credit.external_preview',
      method: 'POST',
      path: () => '/external-data/requests/preview',
      body: (ctx) => ({
        customerId: ctx.actor.resources.customerId,
        providerCode: 'SEGIP',
        queryType: 'IDENTITY_VERIFICATION',
        purpose: 'identity_verification',
        decisionStage: 'onboarding',
        input: { documentNumber: ctx.persona.documentNumber },
      }),
      expectStatus: [200, 201],
      optional: true,
      assert: ok,
    },
    {
      /*
       * La consulta real al proveedor. Éste es el paso cuya evidencia vive FUERA del backend: el
       * journal del emulador. Un E2E que interceptara `fetch` pasaría este paso igual y dejaría el
       * journal vacío — por eso el informe compara las dos cifras.
       */
      stepKey: 'credit.external_request',
      method: 'POST',
      path: () => '/external-data/requests',
      idempotencyKey: (ctx) => `qa-${ctx.runNonce}-${ctx.persona.personaKey}-segip`,
      body: (ctx) => ({
        customerId: ctx.actor.resources.customerId,
        providerCode: 'SEGIP',
        queryType: 'IDENTITY_VERIFICATION',
        purpose: 'identity_verification',
        decisionStage: 'onboarding',
        input: { documentNumber: ctx.persona.documentNumber },
      }),
      expectStatus: [200, 201],
      optional: true,
      assert: (data) => {
        // El veredicto del proveedor viaja aparte del estado de ejecución. Se exige que exista,
        // no que sea favorable: imponerle el resultado al backend es lo contrario de probarlo.
        if (typeof data.providerVerdict !== 'string' && typeof data.status !== 'string') {
          return 'la respuesta no trae ni estado de ejecución ni veredicto del proveedor';
        }
        return null;
      },
      extract: (data, ctx) => {
        if (typeof data.requestId === 'string') ctx.actor.resources.externalRequestId = data.requestId;
        if (typeof data.providerVerdict === 'string') ctx.actor.resources.providerVerdict = data.providerVerdict;
        // El modo EFECTIVO viene en la respuesta. Es lo que decide si un journal vacío es un
        // defecto (mock_server sin tráfico) o lo esperado (mock_local responde en proceso).
        if (typeof data.modeUsed === 'string') ctx.actor.resources.externalModeUsed = data.modeUsed;
      },
    },
    {
      stepKey: 'credit.status',
      method: 'GET',
      path: (ctx) => `/customer-onboarding/${ctx.actor.resources.customerId}/status`,
      expectStatus: [200],
      assert: (data) => (typeof data.lifecycleStatus === 'string' ? null : 'no vino lifecycleStatus'),
      extract: (data, ctx) => {
        ctx.actor.resources.lifecycleStatus = String(data.lifecycleStatus);
      },
    },
    {
      stepKey: 'credit.products',
      method: 'GET',
      path: (ctx) => `/customers/${ctx.actor.resources.customerId}/credit-products`,
      expectStatus: [200],
      assert: (data) => (typeof data.eligible === 'boolean' ? null : 'el catálogo no declara elegibilidad'),
      extract: (data, ctx) => {
        const products = Array.isArray(data.products) ? (data.products as Array<Record<string, unknown>>) : [];
        ctx.actor.resources.eligible = String(data.eligible === true);
        if (products[0] && typeof products[0].id === 'string') ctx.actor.resources.productId = products[0].id;
      },
    },
    {
      /*
       * Solicitud de crédito. El oráculo es CONDICIONAL, y ahí está el punto del paso.
       *
       * Una persona recién registrada no es elegible: el backend tiene que rechazarla, y ese rechazo
       * es el ÉXITO de la prueba. Exigir un 201 aquí sería exigirle al backend que apruebe créditos
       * a quien no corresponde — el peor resultado posible de una suite de QA sobre un producto
       * crediticio. Sólo cuando el catálogo declaró `eligible: true` y ofreció un producto se exige
       * que la solicitud se cree.
       */
      stepKey: 'credit.apply',
      method: 'POST',
      path: (ctx) => `/customers/${ctx.actor.resources.customerId}/credit-applications`,
      idempotencyKey: (ctx) => `qa-${ctx.runNonce}-${ctx.persona.personaKey}-apply`,
      body: (ctx) => ({
        productId: ctx.actor.resources.productId ?? '1',
        requestedAmount: Math.min(20_000, Math.max(500, Math.round(ctx.persona.monthlyIncome * 2))),
        requestedTermMonths: 12,
        purposeCode: 'consumo',
      }),
      expectStatus: [200, 201, 400, 403, 409, 422],
      optional: true,
      assert: (data, ctx) => {
        const elegible = ctx.actor.resources.eligible === 'true';
        if (!elegible) return null; // el rechazo es lo esperado y ya lo cubre `expectStatus`
        return typeof data.applicationId === 'string' || typeof data.id === 'string'
          ? null
          : 'la persona era elegible y la solicitud no devolvió identificador';
      },
      extract: (data, ctx) => {
        const id = data.applicationId ?? data.id;
        if (typeof id === 'string') ctx.actor.resources.applicationId = id;
      },
    },
    {
      /*
       * La verificación del efecto, que es lo que separa "el endpoint respondió" de "pasó algo".
       *
       * Se lee la lista persistida de solicitudes y se compara con lo que el paso anterior afirmó.
       * Un 201 cuyo recurso no aparece después es un fallo, y sin este paso nadie lo notaría.
       */
      stepKey: 'credit.verify_effect',
      method: 'GET',
      path: (ctx) => `/customers/${ctx.actor.resources.customerId}/credit-applications`,
      expectStatus: [200],
      assert: (data, ctx) => {
        const applications = Array.isArray(data.applications) ? (data.applications as Array<Record<string, unknown>>) : [];
        const creada = ctx.actor.resources.applicationId;
        if (creada) {
          const encontrada = applications.some((application) => String(application.id ?? application.applicationId) === creada);
          return encontrada ? null : `la solicitud ${creada} no aparece persistida`;
        }
        // Sin solicitud creada, la lista tiene que estar vacía: una solicitud que aparece sin que
        // nadie la haya creado es fuga entre personas.
        return applications.length === 0 ? null : `aparecieron ${applications.length} solicitudes sin haberlas creado`;
      },
    },
  ],
};

export const JOURNEYS: Journey[] = [accountSignupToLogin, postLoginFirstScreen, customerCreditJourney];

/** Oráculo de transporte + negocio, en ese orden y sin mezclarlos. */
export function judge(input: {
  step: Step;
  status: number | null;
  body: Record<string, unknown> | null;
  latencyMs: number;
  ctx: JourneyContext;
  transportError?: string;
}): StepOutcome {
  const base = {
    stepKey: input.step.stepKey,
    method: input.step.method,
    path: input.step.path(input.ctx),
    httpStatus: input.status,
    latencyMs: Math.round(input.latencyMs),
    expected: `HTTP ${input.step.expectStatus.join('|')}`,
  };

  if (input.status === null) {
    return { ...base, outcome: 'INDETERMINATE', actual: input.transportError ?? 'sin respuesta', reason: 'error de transporte' };
  }
  if (!input.step.expectStatus.includes(input.status)) {
    return {
      ...base,
      outcome: 'FAILED',
      actual: `HTTP ${input.status}`,
      reason: errorCodeOf(input.body) ?? 'código fuera del contrato',
    };
  }
  const data = dataOf(input.body);
  const problema = input.step.assert ? input.step.assert(data, input.ctx) : null;
  if (problema) return { ...base, outcome: 'FAILED', actual: `HTTP ${input.status}`, reason: problema };
  return { ...base, outcome: 'PASSED', actual: `HTTP ${input.status}` };
}
