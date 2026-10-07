/**
 * @file Utilidad pura: el nombre con el que el cliente guarda un extracto que él mismo subió.
 * @business La persona reconoce su extracto por la fecha en que lo subió, no por un identificador interno.
 * @system `extracto-AAAA-MM-DD.pdf`; si la fecha no se puede leer, el id de la revisión.
 */
export function bankStatementFileName(review: { id: string | number; createdAtValue?: Date | string | null }): string {
  const subido = review.createdAtValue ? new Date(review.createdAtValue) : null;
  const fecha = subido && !Number.isNaN(subido.getTime()) ? subido.toISOString().slice(0, 10) : String(review.id);
  return `extracto-${fecha}.pdf`;
}
