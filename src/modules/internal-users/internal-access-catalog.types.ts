/**
 * @file Tipos de dominio: hacen explícitos estados y contratos internos.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system implementa identidad interna, RBAC, catálogo de permisos y guards de autorización granular.
 */
export type InternalPermissionListItem = {
  id: string;
  code: string;
  module: string;
  resource: string;
  action: string;
  description: string | null;
  riskLevel: string;
  requiresReason: boolean;
  requiresMfa: boolean;
};

export type InternalRoleListItem = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  department: string | null;
  legacyRoleCode: string;
  status: string;
  permissions: string[];
};

export type InternalRoleCatalogRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  department: string | null;
  legacyRoleCode: string;
  status: string;
  permissionCode: string | null;
};
