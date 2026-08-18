/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza hace observable y gobernable el propio backend para operaciones, QA y arquitectura.
 * @system responde si una ruta existe sin convertir su ausencia en una excepción.
 */
import { stat } from 'node:fs/promises';

/**
 * Existe como función y no como `try/catch` suelto porque la ausencia de un directorio de modelos o
 * de documentación NO es un error: es un despliegue donde ese artefacto no se publicó, y el
 * reseeding tiene que devolver cero en vez de romper.
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
