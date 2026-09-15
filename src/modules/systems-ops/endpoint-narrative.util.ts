/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system redacta la narrativa de negocio con la que el escaneo de código describe un endpoint.
 */

/**
 * La prosa con la que el escaneo de CÓDIGO describe un endpoint: para qué sirve, qué audita y de
 * dónde viene su payload.
 *
 * Es una deducción a partir de la ruta y el método, no una lectura del contrato — por eso vive
 * aparte del escáner y por eso el camino `OPENAPI_CONTRACT` no la usa: allí el propósito sale del
 * `summary` que el endpoint declara, que es lo que su autor escribió, y no de una plantilla que
 * adivina por el nombre de la ruta.
 */
export function endpointBusinessContext(method: string, path: string, handlerName: string | null) {
  const normalized = path.toLowerCase();
  const action = handlerName ?? `${method} ${path}`;
  if (/risk|score|assessment|decision/.test(normalized)) {
    return {
      businessPurpose: `Ejecuta una operación relacionada con riesgo/scoring (${action}). Debe explicar qué datos leyó, qué versión de reglas/modelo usó y qué resultado produjo para que el comité de riesgo pueda auditar decisiones.`,
      businessValue: 'Permite aprobar, rechazar, escalar o monitorear decisiones de crédito/fraude con evidencia reconstruible.',
      auditStrategy:
        'Registrar actor, requestId, sujeto evaluado, feature snapshot, ruleset/model version, reglas disparadas, resultado, razones y latencia sin exponer PII innecesaria.',
      decisionUseCases: [
        'asignación de línea',
        'revisión manual',
        'monitoreo de cartera',
        'calibración de reglas',
        'auditoría de decisiones',
      ],
    };
  }
  if (/fraud|watchlist|manual-review/.test(normalized)) {
    return {
      businessPurpose: `Gestiona investigación, listas o revisión antifraude (${action}). Debe conectar evidencia, dispositivo, cliente, caso y resultado operativo.`,
      businessValue: 'Reduce pérdidas, abuso multi-cuenta, identidad falsa y exposición operativa frente a comercios.',
      auditStrategy:
        'Registrar apertura/cierre de caso, motivo, evidencia, usuario interno responsable, cambios de estado y decisión final.',
      decisionUseCases: ['bloqueo preventivo', 'escalamiento a analista', 'rehabilitación', 'retroalimentación de reglas antifraude'],
    };
  }
  if (/consent|privacy|data-subject|retention/.test(normalized)) {
    return {
      businessPurpose: `Administra consentimiento, privacidad o derechos del titular (${action}). Debe demostrar finalidad, versión legal, canal y vigencia del tratamiento.`,
      businessValue: 'Permite operar con privacidad por diseño y reducir riesgo legal al escalar a nuevos mercados.',
      auditStrategy:
        'Registrar versión de documento, finalidad, estado granted/revoked, canal, sesión, IP, dispositivo y usuario interno si aplica.',
      decisionUseCases: [
        'habilitar procesamiento permitido',
        'bloquear uso no autorizado',
        'responder auditoría legal',
        'gestionar solicitudes de titular',
      ],
    };
  }
  if (/customer|identity|kyc|contact|address|evidence/.test(normalized)) {
    return {
      businessPurpose: `Opera identidad, perfil, contacto o evidencia del cliente (${action}). Debe sostener KYC, contactabilidad, soporte y trazabilidad de cambios.`,
      businessValue: 'Permite saber quién es el cliente, cómo contactarlo y qué evidencia respalda su elegibilidad.',
      auditStrategy:
        'Registrar origen del dato, versión, validación, evidencia, hashes/cifrado, usuario/servicio que cambió estado y timestamps.',
      decisionUseCases: ['onboarding', 'validación KYC', 'soporte operativo', 'resolución de disputas', 'calidad de datos'],
    };
  }
  if (/device|session|auth|telemetry|sim|ip/.test(normalized)) {
    return {
      businessPurpose: `Captura o consulta señales técnicas de sesión/dispositivo (${action}). Debe servir para seguridad, abuso, continuidad de sesión y señales tempranas de fraude.`,
      businessValue:
        'Permite detectar dispositivos reutilizados, VPN/proxy, SIM swap, sesiones anómalas y patrones de riesgo antes de la mora.',
      auditStrategy:
        'Registrar fingerprint, versión, sesión, IP, canal, app version, estado de autenticación y vínculos con cliente cuando exista.',
      decisionUseCases: ['detección de fraude temprano', 'seguridad de sesión', 'feature engineering', 'investigación de incidentes'],
    };
  }
  if (/system|operation|catalog|definition|quality|test|stress|health/.test(normalized)) {
    return {
      businessPurpose: `Soporta gobierno interno, catálogo, QA o salud operativa (${action}). Debe hacer visible qué existe, cómo se prueba y qué impacto tiene.`,
      businessValue: 'Convierte el backend en plataforma gobernable, auditable y mantenible para escalar internacionalmente.',
      auditStrategy:
        'Registrar cambios de catálogo, ejecuciones de prueba, health checks, errores, actor, endpoint y entidades impactadas.',
      decisionUseCases: ['gobierno de datos', 'QA del portal', 'priorización técnica', 'auditoría interna', 'monitoreo operativo'],
    };
  }
  return {
    businessPurpose: `Endpoint detectado automáticamente (${action}). Requiere revisión funcional para cerrar propósito de negocio, payload, owner e impacto de datos.`,
    businessValue: 'Aporta capacidad operativa al backend Atlas; debe completarse en el catálogo antes de aprobarse para producción.',
    auditStrategy: 'Registrar requestId, actor, método, ruta, parámetros seguros, resultado y side effects detectados.',
    decisionUseCases: ['operación del portal', 'soporte', 'auditoría', 'diagnóstico técnico'],
  };
}

export function endpointPayloadSummary(method: string, path: string) {
  const hasPathParams = /:[A-Za-z0-9_]+/.test(path);
  const normalized = path.toLowerCase();
  const bodyExpected = method !== 'GET' && method !== 'DELETE';
  return {
    inputPayloadContract: {
      body: bodyExpected
        ? { inferred: true, reviewRequired: true, reason: 'Endpoint de escritura; validar DTO/Zod y documentar campos obligatorios.' }
        : {},
      query: /page|catalog|list|search|queue|report|history|mine/.test(normalized)
        ? { page: 'number?', limit: 'number?', filters: 'object?' }
        : {},
      path: hasPathParams ? { inferredFromRoute: path.match(/:[A-Za-z0-9_]+/g)?.map((value) => value.slice(1)) ?? [] } : {},
      headers: { authorization: 'Bearer JWT cuando no sea público', 'x-request-id': 'opcional para trazabilidad' },
    },
    payloadOriginSummary: bodyExpected
      ? 'Payload principal viene de body; filtros/paginación vienen de query; identificadores vienen de path; actor y tenant se derivan del JWT/contexto backend.'
      : 'Payload esperado principalmente por query/path/headers; actor y tenant se derivan del JWT/contexto backend.',
  };
}
