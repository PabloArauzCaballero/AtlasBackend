/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */
import { ToolSeed } from './systems-ops.types.js';

/**
 * Los otros dos backends del ecosistema ATLAS, catalogados como herramientas.
 *
 * ## Por qué viven en el catálogo de herramientas
 *
 * El panel de sistemas del portal interno se alimenta de `system_tool_catalog`: lo que no está ahí
 * sencillamente no existe para operaciones. Hasta ahora el motor de decisión y el ERP eran justo
 * eso —dos servicios que se despliegan, se caen y se depuran, pero sobre los que el portal no sabía
 * decir absolutamente nada—. Un operador que veía el panel en verde no estaba viendo «todo el
 * ecosistema sano», sino «la parte del ecosistema que alguien se acordó de catalogar».
 *
 * ## Por qué no son `PLANNED`
 *
 * `PLANNED` significa que no hay contrato ni integración implementada, y por eso su salud se
 * reporta como NOT_APPLICABLE. Estos dos servicios existen, exponen healthcheck y se pueden probar
 * ahora mismo: son `ACTIVE`. Si falta la variable con su dirección, el chequeo lo dirá con esas
 * palabras —«no configurada»— en lugar de fingir que no aplica.
 *
 * ## Por qué el ERP no es crítico y el motor sí
 *
 * `isCritical` dispara notificación de incidente. Que el motor de decisión no responda degrada de
 * inmediato el crédito de este backend —las solicitudes caen a revisión manual—, así que merece el
 * aviso. El ERP es un producto contiguo con su propia base: que esté caído es un problema del ERP,
 * no una degradación de Atlas, y marcarlo crítico sólo entrenaría a operaciones a ignorar alertas.
 */
export const PLATFORM_SERVICE_TOOL_SEEDS: ToolSeed[] = [
  {
    code: 'DECISION_ENGINE',
    name: 'ATLAS Decision Engine',
    type: 'DECISION_SERVICE',
    provider: 'ATLAS',
    purpose: 'Motor de políticas versionadas que decide crédito, riesgo y fraude.',
    requiredEnvVars: ['DECISION_ENGINE_HEALTH_BASE_URL'],
    healthcheckRoute: '/health',
    requiresCredentials: true,
    hasSandbox: true,
    isCritical: true,
    status: 'ACTIVE',
    ownerTeam: 'Riesgo y Decisión',
    description:
      'Servicio externo a este backend, con su propio repositorio (AtlasDecisionEngineBackend) y su propia base. Atlas lo consume por HTTP desde el módulo `decision-engine`.',
    businessValue:
      'Es lo que separa una decisión de crédito trazable y versionada de una decisión tomada con constantes escritas en código. Cada aprobación que emite queda atada a la versión de política que la produjo, que es lo que se puede auditar después.',
    technicalUsage:
      'El módulo `decision-engine` lo llama con dos credenciales separadas: la audiencia `runtime` ejecuta decisiones y el plano `OPERATIONS` carga desenlaces. La separación evita que el componente que decide pueda reescribir la medida de su propio acierto.',
    auditNotes:
      'Las decisiones se referencian por identificador opaco de sujeto, derivado con `DECISION_ENGINE_SUBJECT_SALT`. Rotar esa sal parte la historia del sujeto en dos y es una migración, no un ajuste.',
    failureRisks:
      'Caído o sin configurar, la decisión de crédito NO se automatiza: cae a revisión manual, que es el respaldo correcto. El riesgo real no es la caída sino confundirla con una aprobación: un motor ausente jamás debe traducirse en aprobación automática.',
  },
  {
    code: 'ERP_BACKEND',
    name: 'ATLAS ERP Backend',
    type: 'BUSINESS_SERVICE',
    provider: 'ATLAS',
    purpose: 'Backend de administración, inventario y facturación del ecosistema.',
    requiredEnvVars: ['ERP_BACKEND_BASE_URL'],
    healthcheckRoute: '/api/v1/health',
    requiresCredentials: false,
    hasSandbox: true,
    isCritical: false,
    status: 'ACTIVE',
    ownerTeam: 'Plataforma ERP',
    description:
      'Producto contiguo con repositorio (AtlasERPBackend) y base de datos propios. Este backend no consume su API: lo cataloga para poder responder por su salud desde un solo panel.',
    businessValue:
      'Operaciones necesita un único lugar donde mirar cuando algo del ecosistema falla. Tener el ERP fuera del catálogo obligaba a saber de antemano que existe y dónde vive, que es exactamente el conocimiento que un panel debería quitar de la cabeza de las personas.',
    technicalUsage:
      'Sólo se comprueba su healthcheck HTTP (`ERP_BACKEND_HEALTH_PATH`, por defecto `/api/v1/health`). No hay llamadas de negocio entre ambos backends y catalogar la herramienta no crea ninguna.',
    auditNotes:
      'La comprobación es una petición GET sin credenciales ni cuerpo; no toca datos del ERP ni deja rastro en su dominio más allá de su propio log de acceso.',
    failureRisks:
      'Caído, este backend no se degrada en absoluto: son productos separados. Lo que se pierde es la visibilidad, y por eso la herramienta no es crítica — marcarla como tal entrenaría a operaciones a ignorar avisos que no exigen actuar sobre Atlas.',
  },
];
