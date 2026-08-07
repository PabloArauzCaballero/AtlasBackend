/**
 * Política común de salto de los gates que necesitan PostgreSQL.
 *
 * ATLAS-CI-002 — un gate que no pudo comprobar nada NO puede reportarse en verde.
 *
 * Cuatro gates de base de datos (`check:read-api-views`, `check:domain-schema-layout`,
 * `check:db-privileges`, `db:seed:verify-prod-idempotency`) imprimían `[skip]` y salían con código 0
 * cuando Postgres no respondía. La auditoría integral del 2026-08-06 los vio pasar en VERDE sin
 * haber verificado absolutamente nada. El caso que importa no es el portátil sin base levantada: es
 * el job de CI que sí tiene Postgres y donde una credencial mal puesta convertía la comprobación de
 * la matriz de privilegios en un aprobado automático — justo el gate que existe para cazar eso.
 *
 * El salto sigue siendo legítimo en local, pero ahora hay que pedirlo explícitamente. CI no lo pide,
 * así que allí la ausencia de base es un fallo.
 */
export function gateSkipIsAllowed(): boolean {
  return process.argv.includes('--allow-skip') || process.env.ATLAS_GATES_ALLOW_SKIP === 'true';
}

/**
 * Trata una base inalcanzable. Devuelve `true` si el gate puede continuar como salto explícito;
 * si no, imprime la causa y termina el proceso con código 1 — nunca devuelve un "todo bien".
 */
export function handleUnreachableDatabase(error: unknown, gate: string): boolean {
  const message = error instanceof Error ? error.message : String(error);

  if (gateSkipIsAllowed()) {
    console.warn(`[skip] ${gate}: no se pudo conectar a PostgreSQL (${message}). Salto explícito por --allow-skip.`);
    return true;
  }

  console.error(
    `❌ ${gate}: no se pudo conectar a PostgreSQL (${message}).\n` +
      '   Este gate verifica el estado REAL de la base; sin conexión no comprueba nada y no puede aprobar.\n' +
      '   Levanta Postgres, o pasa --allow-skip / ATLAS_GATES_ALLOW_SKIP=true si de verdad quieres omitirlo.',
  );
  process.exit(1);
}
