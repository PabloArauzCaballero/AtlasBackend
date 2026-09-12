/**
 * @file La forma de una entrada del catálogo de permisos, y su constructor.
 * @business Esta pieza controla quién puede operar Atlas y deja evidencia de cada asignación de privilegios.
 * @system normaliza cada permiso interno antes de sembrarlo.
 */

/**
 * Vive aparte porque el catálogo se partió en cuatro archivos y los cuatro lo necesitan. Antes
 * estaba junto a la lista, que era lo que hacía crecer el archivo sin techo.
 */
export type InternalPermissionSeed = {
  code: string;
  module: string;
  resource: string;
  action: string;
  description: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  requiresReason: boolean;
};

/*
 * Cada permiso se declara con los campos nombrados.
 *
 * La forma anterior era posicional y compacta, que para una tabla se lee bien hasta las dos
 * últimas columnas: `riskLevel` y `requiresReason` son opcionales, van al final y son
 * precisamente los dos CONTROLES —el nivel de riesgo y la exigencia de motivo escrito—. Un
 * permiso al que se le olvida el `true` final no falla en ninguna parte: simplemente deja de
 * pedir justificación, y eso no se descubre leyendo la fila.
 */
export function permission(entrada: {
  code: string;
  module: string;
  resource: string;
  action: string;
  description: string;
  riskLevel?: InternalPermissionSeed['riskLevel'];
  requiresReason?: boolean;
}): InternalPermissionSeed {
  return {
    code: entrada.code,
    module: entrada.module,
    resource: entrada.resource,
    action: entrada.action,
    description: entrada.description,
    riskLevel: entrada.riskLevel ?? 'MEDIUM',
    requiresReason: entrada.requiresReason ?? false,
  };
}
