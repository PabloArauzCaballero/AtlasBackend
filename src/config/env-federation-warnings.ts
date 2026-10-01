/**
 * @file Avisos de arranque sobre la federación con otros bloques de la plataforma.
 * @business Evita que producción llegue al panel de salud de red con un bloque «Falta configurar».
 * @system compara dirección y credencial de cada bloque federado y devuelve avisos legibles.
 */

/** Forma mínima del entorno que se revisa; `AppEnv` la cumple sin más. */
export interface FederationEnv {
  ERP_BACKEND_BASE_URL?: string | undefined;
  ERP_BACKEND_CATALOG_API_KEY?: string | undefined;
  DASHBOARDS_BASE_URL?: string | undefined;
  DASHBOARDS_CATALOG_API_KEY?: string | undefined;
}

const hasValue = (value: string | undefined): boolean => typeof value === 'string' && value.trim().length > 0;

/**
 * Bloques con dirección pero sin credencial de lectura.
 *
 * **Por qué aviso y no error de arranque.** Esa combinación no rompe ninguna petición de negocio:
 * sólo deja al panel `/internal/systems/network-health` mostrando «Falta configurar» para ese
 * bloque. Tumbar la API por ello convertiría un hueco de observabilidad en un servicio caído, y
 * `migrate` ya corre DESPUÉS de retirar los contenedores viejos. Por eso se avisa, con el nombre
 * exacto de las DOS variables que tienen que coincidir, y el runbook de despliegue lo pone en la
 * lista de comprobación previa.
 *
 * La credencial del otro lado (`PLATFORM_CATALOG_API_KEY` del ERP y de Tableros) debe tener el
 * MISMO valor: si una sola de las dos falta, el bloque sigue sin federarse.
 */
export function federationCredentialWarnings(env: FederationEnv): string[] {
  const blocks = [
    { name: 'ERP', baseUrl: env.ERP_BACKEND_BASE_URL, key: env.ERP_BACKEND_CATALOG_API_KEY, here: 'ERP_BACKEND_CATALOG_API_KEY' },
    { name: 'Tableros', baseUrl: env.DASHBOARDS_BASE_URL, key: env.DASHBOARDS_CATALOG_API_KEY, here: 'DASHBOARDS_CATALOG_API_KEY' },
  ];
  return blocks
    .filter((block) => hasValue(block.baseUrl) && !hasValue(block.key))
    .map(
      (block) =>
        `[ATLAS][FEDERACIÓN] ${block.name} tiene dirección pero falta ${block.here}: el panel de salud de red lo mostrará ` +
        `como «Falta configurar». Debe coincidir con PLATFORM_CATALOG_API_KEY del ${block.name}. ` +
        'Ver docs/runbooks/despliegue-produccion.md, sección «Federación entre bloques».',
    );
}
