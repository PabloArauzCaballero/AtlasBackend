/**
 * @file Permisos internos sobre el DATO.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system enumera los permisos internos de este grupo.
 */
import { permission, type InternalPermissionSeed } from './internal-rbac.permission-builder.js';

/**
 * Gobierno del catálogo y sus definiciones, calidad, políticas, reportes y linaje, auditoría y
 * notificaciones. Es la parte que decide QUÉ se puede ver y tocar del dato.
 */
export const DATA_PERMISSION_SEEDS: readonly InternalPermissionSeed[] = [
  permission({
    code: 'catalog.data.read',
    module: 'catalog',
    resource: 'data_catalog',
    action: 'read',
    description: 'Consultar catálogo de datos.',
  }),
  permission({
    code: 'catalog.data.manage',
    module: 'catalog',
    resource: 'data_catalog',
    action: 'manage',
    description: 'Administrar catálogo de datos.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'businessMetadata.read',
    module: 'business_metadata',
    resource: 'business_term',
    action: 'read',
    description: 'Consultar metadata de negocio.',
  }),
  permission({
    code: 'businessMetadata.manage',
    module: 'business_metadata',
    resource: 'business_term',
    action: 'manage',
    description: 'Administrar metadata de negocio.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'governance.data.read',
    module: 'governance',
    resource: 'data_governance',
    action: 'read',
    description: 'Consultar gobierno de datos.',
  }),
  permission({
    code: 'governance.data.manage',
    module: 'governance',
    resource: 'data_governance',
    action: 'manage',
    description: 'Administrar gobierno de datos.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'governance.policies.read',
    module: 'governance',
    resource: 'policy',
    action: 'read',
    description: 'Consultar políticas de gobierno.',
  }),
  permission({
    code: 'governance.policies.manage',
    module: 'governance',
    resource: 'policy',
    action: 'manage',
    description: 'Administrar políticas de gobierno.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'dataQuality.issues.read',
    module: 'data_quality',
    resource: 'quality_issue',
    action: 'read',
    description: 'Consultar incidencias de calidad.',
  }),
  permission({
    code: 'dataQuality.issues.resolve',
    module: 'data_quality',
    resource: 'quality_issue',
    action: 'resolve',
    description: 'Resolver incidencias de calidad.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'dataQuality.rules.read',
    module: 'data_quality',
    resource: 'quality_rule',
    action: 'read',
    description: 'Consultar reglas de calidad.',
  }),
  permission({
    code: 'dataQuality.rules.manage',
    module: 'data_quality',
    resource: 'quality_rule',
    action: 'manage',
    description: 'Administrar reglas de calidad.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'operations.catalogs.read',
    module: 'operations',
    resource: 'catalog',
    action: 'read',
    description: 'Consultar catálogos operativos.',
  }),
  permission({
    code: 'operations.definitions.read',
    module: 'operations',
    resource: 'definition',
    action: 'read',
    description: 'Consultar definiciones operativas.',
  }),
  permission({
    code: 'operations.riskPolicy.read',
    module: 'operations',
    resource: 'risk_policy',
    action: 'read',
    description: 'Consultar política de riesgo vigente.',
  }),
  permission({
    code: 'reporting.read',
    module: 'reporting',
    resource: 'report',
    action: 'read',
    description: 'Consultar reportes dinámicos.',
  }),
  permission({
    code: 'reporting.execute',
    module: 'reporting',
    resource: 'report',
    action: 'execute',
    description: 'Ejecutar reportes dinámicos.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'reporting.manage',
    module: 'reporting',
    resource: 'report',
    action: 'manage',
    description: 'Administrar reportes dinámicos.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'lineage.read',
    module: 'lineage',
    resource: 'lineage_graph',
    action: 'read',
    description: 'Consultar lineage e impacto.',
  }),
  permission({
    code: 'audit.events.read',
    module: 'audit',
    resource: 'audit_event',
    action: 'read',
    description: 'Consultar eventos de auditoría.',
    riskLevel: 'HIGH',
  }),
  permission({
    code: 'audit.events.detail',
    module: 'audit',
    resource: 'audit_event',
    action: 'detail',
    description: 'Consultar detalle de auditoría sensible.',
    riskLevel: 'HIGH',
  }),
  permission({
    code: 'notifications.messages.read',
    module: 'notifications',
    resource: 'notification_message',
    action: 'read',
    description: 'Consultar mensajes de notificación (in-app/push/email/sms/whatsapp) y su historial de entrega.',
  }),
  permission({
    code: 'notifications.messages.manage',
    module: 'notifications',
    resource: 'notification_message',
    action: 'manage',
    description: 'Reintentar o cancelar mensajes de notificación pendientes/fallidos.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  permission({
    code: 'notifications.templates.read',
    module: 'notifications',
    resource: 'notification_template',
    action: 'read',
    description: 'Consultar plantillas de notificación.',
  }),
  permission({
    code: 'notifications.templates.manage',
    module: 'notifications',
    resource: 'notification_template',
    action: 'manage',
    description: 'Crear y editar plantillas de notificación.',
    riskLevel: 'HIGH',
    requiresReason: true,
  }),
  /*
   * El EXPEDIENTE de una persona: sus archivos, con quién puede verlos.
   *
   * Cinco permisos y no uno solo porque las cuatro cosas que se pueden hacer con la carpeta de
   * evidencia de alguien tienen consecuencias muy distintas. Leer un carnet es parte del trabajo de
   * quien revisa; AMPLIAR quién más puede verlo es una decisión sobre datos de un tercero, y por eso
   * `compartir` y `administrar` exigen motivo escrito. `pii.revelar` va aparte de los cuatro niveles
   * porque no es un grado más: es la diferencia entre ver el teléfono de una referencia enmascarado
   * y verlo entero, y esa línea la cruza poca gente.
   */
];
