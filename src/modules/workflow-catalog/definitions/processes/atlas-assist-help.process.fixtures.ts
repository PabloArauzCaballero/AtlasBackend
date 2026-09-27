/**
 * @file Proceso declarado en código: Atlas Assist, ayuda contextual y chat en la app.
 * @business El botón de ayuda contesta al momento las dudas de uso de la app y de qué es Atlas, sin hacer esperar a una persona del equipo, y deriva a soporte humano cuando la pregunta es un reclamo o un pago no reconocido.
 * @system fixture que `syncWorkflowCatalog` vuelca a `workflow_*`; escrita el 2026-09-26 desde `src/modules/assist`, el módulo `assist` de AtlasAIService y la hoja del asistente de la app.
 */
import type { WorkflowDefinitionFixture } from '../workflow-definition.types.js';

export const ATLAS_ASSIST_HELP: WorkflowDefinitionFixture = {
  processId: 'P-14',
  code: 'atlas_assist_help',
  version: 'v1',
  name: 'Atlas Assist: ayuda contextual y chat en la app',
  description:
    'El cliente pulsa el botón de ayuda de la app, pregunta y recibe una respuesta del asistente de IA basada en un catálogo versionado de ayuda; si la duda requiere a una persona, la app lo lleva a Soporte. La app sólo habla con Atlas, que reenvía al servicio de IA con una referencia opaca del cliente.',
  processType: 'integration',
  ownerDomain: 'customer_support',
  ownerRole: 'OPERATIONS_MANAGER',
  priority: 'P2',
  systems: ['ATLAS_BACKEND', 'AI_SERVICE'],
  narrative: {
    whyExists:
      'Las dudas de uso de la app (dónde está algo, qué significa un estado, qué es Atlas y cómo es el plan de pagos) llegan a cualquier hora; el asistente las contesta al momento con un catálogo de ayuda que cita pantallas reales, y así soporte humano se queda con lo que de verdad necesita a una persona.',
    whoStartsAndCloses:
      'Lo inicia el cliente al pulsar el botón de ayuda flotante de la app y escribir su pregunta; lo cierra el propio cliente al obtener la respuesta o al aceptar «Hablar con una persona», que lo lleva a Soporte. Ninguna persona interna interviene en la conversación con el asistente.',
    startAndEnd:
      'Empieza cuando la app abre la hoja del asistente y recupera la conversación vigente (si contesta 404 el botón ni se pinta). Termina con la respuesta del asistente guardada en el historial del servicio de IA, o con la derivación a la pantalla de Soporte cuando la respuesta sugiere hablar con una persona.',
    whenItFails:
      'Con el asistente apagado en Atlas o en el servicio de IA todo responde 404 y la app esconde el botón. Si la misma pregunta sigue en curso responde 409 y la app reintenta sola cada 2 segundos con la misma clave; si hay demasiadas consultas, 429. Una clave de servicio que no coincide se registra como error y el cliente ve un aviso amable que lo manda a Soporte; nadie interno recibe alerta.',
    healthIndicator:
      'Proporción de preguntas contestadas frente a respuestas 503 de indisponibilidad y 429 de saturación, y proporción de respuestas que sugieren hablar con una persona; hoy sólo se pueden leer en los registros del servicio de IA, porque ningún tablero ni pantalla del portal lo muestra.',
  },
  success: 'El cliente recibe una respuesta útil del catálogo de ayuda, o llega a Soporte cuando su caso necesita a una persona.',
  failure: 'El botón desaparece por un interruptor apagado o la clave de servicio no coincide y nadie interno se entera.',
  sources: [
    'src/modules/assist/assist.controller.ts',
    'src/modules/assist/assist.service.ts',
    'src/modules/assist/ai-assist.client.ts',
    'src/modules/assist/assist.schemas.ts',
    'AtlasAIService/src/modules/assist/assist.controller.ts',
    'AtlasAIService/src/modules/assist/assist-catalog.v1.ts',
    'AtlasAIService/docs/support/status.md',
    'AtlasAIService/docs/support/help-surface-map.md',
    'AtlasAIService/docs/support/catalog.v1.json',
    'AtlasFrontend/apps/consumer-app/src/features/assist.ts',
    'AtlasFrontend/apps/consumer-app/src/ui/assist-sheet.tsx',
    'memoria atlas-assist-boton-de-ayuda',
    '_plan-documentar-procesos-y-cableado-portal-2026-09-26/datos/procesos.json (P-14)',
  ],
  metadata: {
    gaps: [
      'El portal admin no referencia al servicio de IA: nadie observa su salud, su catálogo ni sus conversaciones.',
      'El inventario pide dueño SUPPORT_ADMIN, que no es un rol interno; se usa SUPPORT_AGENT.',
      'Dos catálogos con estado distinto: el de la app (consumer-app-assist-v2-edcfc0c) está en uso; el de soporte de comercios (catalog.v1.json) sigue DRAFT_NOT_PUBLISHED y el contrato IA↔soporte PROPOSED_DISABLED.',
      'En DEV el asistente está apagado (404, botón oculto) y falta crear el servicio de IA en el H310; sólo TEST lo tiene encendido.',
    ],
  },
  stages: [
    {
      code: 'assist_open',
      name: 'Apertura de la hoja de ayuda',
      description:
        'La app pide la conversación vigente para rehidratar la hoja. Si responde 404 el asistente está apagado y el botón no se muestra.',
      module: 'assist',
      actor: 'customer',
      client: 'CONSUMER_APP',
      entry: true,
      steps: [
        {
          code: 'assist.conversation',
          name: 'Recuperar la conversación vigente',
          description:
            'Últimos turnos del hilo más reciente en orden cronológico; si el historial no se puede leer devuelve el hilo vacío.',
          method: 'GET',
          path: '/mobile/assist/conversation',
          roles: ['customer'],
          errors: ['404 ASSIST_DISABLED'],
          successStatus: [200],
        },
      ],
    },
    {
      code: 'assist_ask',
      name: 'Pregunta al asistente',
      description: 'El cliente escribe su duda; la app la envía con una clave de idempotencia y la pantalla desde la que pregunta.',
      module: 'assist',
      actor: 'customer',
      client: 'CONSUMER_APP',
      steps: [
        {
          code: 'assist.chat',
          name: 'Enviar la pregunta',
          description:
            'Reenvía la pregunta al servicio de IA con la referencia opaca del cliente autenticado; el asistente no ve la cuenta ni el token. Tope de 10 preguntas por minuto.',
          method: 'POST',
          path: '/mobile/assist/chat',
          roles: ['customer'],
          idempotencyKey: true,
          repeatable: true,
          input: {
            prompt: 'string (1-2000)',
            clientMessageId: 'uuid',
            conversationId: 'uuid (opcional)',
            screen: 'ASSIST_SCREENS (opcional)',
          },
          output: {
            reply: 'string',
            suggestHandoff: 'boolean',
            conversationId: 'string | null',
            turnId: 'string | null',
          },
          errors: ['400 ASSIST_REJECTED', '404 ASSIST_DISABLED', '409 ASSIST_IN_FLIGHT', '429 ASSIST_BUSY', '503 ASSIST_UNAVAILABLE'],
          successStatus: [200],
        },
      ],
    },
    {
      code: 'assist_answer',
      name: 'Respuesta del servicio de IA',
      description:
        'El servicio de IA valida la clave de servicio, selecciona hechos del catálogo de ayuda, llama al modelo y guarda el turno en su historial (90 días).',
      module: 'ai_service_assist',
      actor: 'system',
      client: 'BLOCK',
      steps: [
        {
          code: 'assist.ai_chat',
          name: 'Contestar con el catálogo de ayuda',
          description:
            'Recibe la pregunta con `x-atlas-service-key` y el actor opaco `tenantId:customerId`; devuelve la respuesta y si conviene derivar.',
          system: 'AI_SERVICE',
          method: 'POST',
          path: '/v1/assist/chat',
          errors: [
            '401 clave de servicio inválida',
            '404 ATLAS_AI_ASSIST_ENABLED apagado',
            '409 consulta en curso',
            '429 tope de llamadas al proveedor',
          ],
          successStatus: [200],
        },
        {
          code: 'assist.ai_latest',
          name: 'Leer la última conversación',
          description: 'Sirve el historial con el que Atlas rehidrata la hoja; Atlas no persiste nada.',
          system: 'AI_SERVICE',
          method: 'GET',
          path: '/v1/assist/conversations/latest',
          successStatus: [200],
        },
      ],
    },
    {
      code: 'assist_handoff',
      name: 'Derivación a soporte humano',
      description:
        'Si la respuesta sugiere hablar con una persona (reclamos, pagos no reconocidos) o el asistente no está disponible, la app ofrece ir a Soporte; allí sigue el proceso de soporte.',
      module: 'assist',
      actor: 'customer',
      client: 'CONSUMER_APP',
      optional: true,
      terminal: true,
      steps: [
        {
          code: 'assist.handoff',
          name: 'Ir a la pantalla de Soporte',
          description:
            'La hoja del asistente navega a `/soporte`; el caso o la conversación humana se abren en el proceso de soporte (P-12).',
          kind: 'manual',
          reason:
            'Es una navegación dentro de la app decidida por el cliente; no hay llamada propia, la conversación humana la abre el proceso de soporte.',
          optional: true,
        },
      ],
    },
    {
      code: 'assist_oversight',
      name: 'Supervisión del asistente',
      description:
        'Alguien de soporte debería ver la salud del servicio de IA, la versión del catálogo y la tasa de derivaciones. No existe pantalla para ello en el portal.',
      module: 'assist',
      actor: 'internal_user',
      client: 'ADMIN_PORTAL',
      optional: true,
      steps: [
        {
          code: 'assist.oversight',
          name: 'Revisar salud y catálogo del asistente',
          description: 'Hoy sólo es posible leyendo los registros del servicio de IA en el servidor.',
          kind: 'manual',
          reason:
            'El portal admin no referencia al servicio de IA: no hay ruta ni pantalla que muestre su salud, su catálogo ni sus conversaciones.',
          optional: true,
        },
      ],
    },
  ],
  transitions: [
    {
      code: 'assist.entry',
      from: null,
      to: 'assist.conversation',
      condition: 'always',
      description: 'Entrada: el cliente abre la hoja de ayuda.',
      isDefault: true,
    },
    {
      code: 'assist.open_to_chat',
      from: 'assist.conversation',
      to: 'assist.chat',
      condition: 'on_success',
      description: 'Con la hoja abierta, el cliente pregunta.',
      isDefault: true,
    },
    {
      code: 'assist.open_disabled',
      from: 'assist.conversation',
      to: null,
      condition: 'on_error',
      expression: { status: 404 },
      description: 'Asistente apagado: la app esconde el botón.',
    },
    {
      code: 'assist.chat_to_ai',
      from: 'assist.chat',
      to: 'assist.ai_chat',
      condition: 'always',
      description: 'Atlas reenvía la pregunta al servicio de IA.',
      isDefault: true,
    },
    {
      code: 'assist.ai_to_handoff',
      from: 'assist.ai_chat',
      to: 'assist.handoff',
      condition: 'conditional',
      expression: { suggestHandoff: true },
      description: 'La respuesta sugiere hablar con una persona.',
    },
    {
      code: 'assist.ai_retry',
      from: 'assist.ai_chat',
      to: 'assist.chat',
      condition: 'on_error',
      expression: { status: 409 },
      description: 'La misma consulta sigue en curso: la app reintenta con la misma clave.',
    },
    {
      code: 'assist.exit',
      from: 'assist.ai_chat',
      to: null,
      condition: 'on_success',
      description: 'Salida: el cliente tiene su respuesta.',
      isDefault: true,
    },
  ],
  dependencies: [
    {
      step: 'assist.chat',
      dependsOn: 'assist.conversation',
      type: 'soft',
      description: 'La app sólo muestra el botón si la conversación no respondió 404.',
    },
    {
      step: 'assist.conversation',
      dependsOn: 'assist.ai_latest',
      type: 'requires_data',
      description: 'El historial vive en el servicio de IA.',
    },
  ],
};
