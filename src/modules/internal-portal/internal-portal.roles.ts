/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza ofrece a operaciones una vista gobernada del negocio sin acceso directo a tablas sensibles.
 * @system declara una sola vez los roles internos que abren los controllers del portal.
 */

/**
 * Roles internos autorizados para el portal operacional.
 *
 * Los controllers del portal exponen lectura y escritura administrativa; nunca deben aceptar actores
 * `customer`. Vive aparte para que los controllers del portal compartan la MISMA lista y no una copia.
 */
export const INTERNAL_PORTAL_ROLES = [
  'internal_operator',
  'risk_analyst',
  'compliance_analyst',
  'admin',
  'platform_admin',
  'system_admin',
  'qa_engineer',
  'devops',
  'readonly_auditor',
] as const;
