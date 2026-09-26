/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza decide qué columnas del modelo se marcan como sensibles en el catálogo de gobierno.
 * @system descubre endpoints, cataloga impacto de datos, ejecuta pruebas controladas y expone salud y cobertura.
 */

/** Señales de gobierno derivadas del nombre de una columna y su tabla. */
export type ColumnSignals = {
  containsPii: boolean;
  piiType: string | null;
  containsFinancialData: boolean;
  containsRiskData: boolean;
  containsFraudSignal: boolean;
  containsCapacitySignal: boolean;
  containsSensitive: boolean;
  isMlCandidate: boolean;
  usedInScoring: boolean;
  usedInMl: boolean;
};

/**
 * Clasificación heurística de una columna por su nombre.
 *
 * Extraída de `SystemsCatalogSeedService`, donde vivía como método privado de un servicio de 731
 * líneas y **sin una sola prueba**. No es un detalle de implementación del seeding: es la regla que
 * decide qué queda marcado como PII, dato financiero o señal de fraude en
 * `system_data_field_catalog` — el catálogo que después alimenta el portal de gobierno, las
 * políticas de retención y las respuestas sobre qué datos toca cada endpoint.
 *
 * Es deliberadamente conservadora: ante la duda marca de más, porque el coste de revisar un campo
 * que no era sensible es incomparablemente menor que el de tratar como inocuo uno que sí lo era.
 * `piiType` distingue la CATEGORÍA (que determina el tratamiento: cifrado, hash, enmascarado),
 * mientras que `containsPii` es más amplio e incluye señales indirectas (`customer`, `name`,
 * `birth`) que no tienen categoría propia pero siguen siendo dato personal.
 *
 * **Límite conocido:** clasifica por NOMBRE, no por contenido. Una columna con un nombre neutro que
 * guarde un correo no se detecta. Por eso el catálogo admite curaduría manual encima
 * (`reviewStatus: 'AUTO_DETECTED'` es el punto de partida, no la palabra final).
 */
export function classifyColumn(columnName: string, tableName: string): ColumnSignals {
  const normalized = `${tableName}.${columnName}`.toLowerCase();

  const piiType = detectPiiCategory(normalized);
  // Más amplio que `piiType`: recoge dato personal sin categoría propia de tratamiento.
  const containsPii = Boolean(piiType) || /customer|user|name|birth/.test(normalized);
  const containsFinancialData = /amount|balance|income|salary|payment|loan|debt|credit|currency|limit/.test(normalized);
  const containsRiskData = /risk|score|rating|policy|rule|decision|quality/.test(normalized);
  const containsFraudSignal = /fraud|watchlist|reputation|fingerprint/.test(normalized);
  const containsCapacitySignal = /capacity|quota|limit|usage/.test(normalized);
  const usedInScoring = /score|risk|feature|model|assessment/.test(normalized);
  const usedInMl = /feature|model|prediction|embedding|ml_/.test(normalized);

  return {
    containsPii,
    piiType,
    containsFinancialData,
    containsRiskData,
    containsFraudSignal,
    containsCapacitySignal,
    containsSensitive: containsPii || containsFinancialData || containsRiskData || containsFraudSignal,
    isMlCandidate: usedInMl || usedInScoring,
    usedInScoring,
    usedInMl,
  };
}

/**
 * Categoría de PII, en orden de precedencia. El orden importa: una columna
 * `identity_document_email` es antes un correo que un documento, porque el tratamiento que exige
 * (verificación, canal de contacto) lo determina el correo.
 */
function detectPiiCategory(normalized: string): string | null {
  const categories: ReadonlyArray<[RegExp, string]> = [
    [/email/, 'EMAIL'],
    [/phone|mobile|whatsapp/, 'PHONE'],
    [/dni|document|identity|passport|nit/, 'IDENTITY_DOCUMENT'],
    [/address|gps|lat|lon|location/, 'LOCATION'],
    [/token|password|secret|credential/, 'CREDENTIAL'],
  ];

  return categories.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

/** `customer_contact_methods` -> `Customer Contact Methods`. Etiqueta de partida para el catálogo. */
export function humanizeIdentifier(value: string): string {
  return value
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
