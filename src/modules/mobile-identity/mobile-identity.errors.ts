/**
 * @file Cómo se describe un error de identidad en el registro, sin filtrar PII.
 * @business Un fallo tiene que poder diagnosticarse sin que el log guarde el documento de nadie.
 * @system normaliza a texto un error desconocido para el registro.
 */

/**
 * Vive aparte porque lo usan tanto el flujo de verificación como las señales externas, y
 * exportarlo desde cualquiera de los dos crearía un ciclo entre ellos.
 */
export function describir(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
