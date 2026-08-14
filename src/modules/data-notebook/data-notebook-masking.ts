/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza abre los datos gobernados al análisis sin dejar que nadie los altere ni los extraiga en claro.
 * @system enmascara por categoría de PII las columnas que devuelve el cuaderno de datos.
 */
import { classifyColumn } from '../systems-ops/column-classification.util.js';

export type NotebookColumnPolicy = 'PLAIN' | 'MASKED' | 'REDACTED';

export type NotebookColumnDescriptor = {
  name: string;
  /** Categoría detectada por el clasificador del catálogo (`EMAIL`, `PHONE`, `IDENTITY_DOCUMENT`…). */
  piiType: string | null;
  policy: NotebookColumnPolicy;
  /** Por qué se aplicó esa política, en una línea, para que la pantalla lo explique sin adivinar. */
  reason: string | null;
};

const MASK = '••••';

/**
 * Decide la política de cada columna del resultado.
 *
 * Tres políticas y no dos. `REDACTED` no es un enmascarado más fuerte: es la negativa a servir el
 * valor bajo ninguna condición, y se reserva a las columnas de categoría `CREDENTIAL` —tokens,
 * contraseñas, secretos—. Un permiso de «ver en claro» sirve para investigar un caso con dato
 * personal; no existe una investigación que requiera leer el hash de una contraseña por pantalla, y
 * dejar ese camino abierto convierte el permiso más alto de la consola en una extracción de
 * credenciales.
 *
 * El clasificador trabaja por NOMBRE de columna, así que hereda su límite conocido: una columna con
 * nombre neutro que guarde un correo no se detecta. Por eso el enmascarado es una capa sobre el
 * privilegio de la base, no un sustituto.
 */
export function describeColumns(names: readonly string[], reveal: boolean): NotebookColumnDescriptor[] {
  return names.map((name) => {
    const signals = classifyColumn(name, '');

    if (signals.piiType === 'CREDENTIAL') {
      return { name, piiType: signals.piiType, policy: 'REDACTED', reason: 'Credencial: no se sirve nunca en claro.' };
    }

    if (!signals.containsPii) {
      return { name, piiType: signals.piiType, policy: 'PLAIN', reason: null };
    }

    if (reveal) {
      return { name, piiType: signals.piiType, policy: 'PLAIN', reason: 'Dato personal servido en claro por permiso explícito.' };
    }

    return {
      name,
      piiType: signals.piiType,
      policy: 'MASKED',
      reason: signals.piiType ? `Dato personal (${signals.piiType}) enmascarado.` : 'Dato personal enmascarado.',
    };
  });
}

/** Aplica las políticas fila a fila. Devuelve objetos nuevos: no muta lo que vino del driver. */
export function applyColumnPolicies(
  rows: readonly Record<string, unknown>[],
  columns: readonly NotebookColumnDescriptor[],
): Record<string, unknown>[] {
  const policies = new Map(columns.map((column) => [column.name, column]));

  return rows.map((row) => {
    const masked: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      const column = policies.get(key);
      masked[key] = column ? maskValue(value, column) : value;
    }
    return masked;
  });
}

function maskValue(value: unknown, column: NotebookColumnDescriptor): unknown {
  if (column.policy === 'PLAIN') return value;
  if (column.policy === 'REDACTED') return value === null || value === undefined ? value : MASK;
  if (value === null || value === undefined) return value;

  const text = typeof value === 'string' ? value : String(value);
  if (text.length === 0) return text;

  switch (column.piiType) {
    case 'EMAIL':
      return maskEmail(text);
    case 'PHONE':
      return keepTail(text, 2);
    case 'IDENTITY_DOCUMENT':
      return keepTail(text, 3);
    case 'LOCATION':
      return MASK;
    default:
      // Sin categoría propia: nombres, fechas de nacimiento, identificadores de cliente. Se deja la
      // inicial porque distinguir dos filas entre sí es el uso legítimo, y leer el nombre no lo es.
      return keepHead(text, 1);
  }
}

/**
 * `pablo.arauz@atlas.internal` -> `p••••@atlas.internal`.
 *
 * El dominio se conserva: es lo que permite ver de un vistazo que una cuenta es interna o de un
 * proveedor, que es la pregunta que se hace en un diagnóstico. La parte local es la que identifica
 * a la persona.
 */
function maskEmail(value: string): string {
  const at = value.indexOf('@');
  if (at <= 0) return MASK;
  return `${value.slice(0, 1)}${MASK}${value.slice(at)}`;
}

function keepTail(value: string, visible: number): string {
  if (value.length <= visible) return MASK;
  return `${MASK}${value.slice(-visible)}`;
}

function keepHead(value: string, visible: number): string {
  if (value.length <= visible) return MASK;
  return `${value.slice(0, visible)}${MASK}`;
}
