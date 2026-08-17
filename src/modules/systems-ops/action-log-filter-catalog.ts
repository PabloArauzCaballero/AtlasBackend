/**
 * @file Catálogo de opciones de filtrado de la auditoría de acciones.
 * @business Permite filtrar la bitácora por valores que EXISTEN, en vez de obligar a teclearlos de memoria.
 * @system deriva los conjuntos cerrados del propio esquema de consulta y los abiertos de la tabla.
 */
import { systemsActionLogQuerySchema } from './systems-ops.schemas.js';

/**
 * De dónde salen las opciones de un filtro, y por qué importa la distinción.
 *
 * **`SCHEMA`** — conjunto cerrado, declarado en el esquema de consulta. El
 * backend rechaza cualquier otro valor, así que ofrecer uno distinto en la
 * interfaz sería ofrecer un filtro que responde 400.
 *
 * **`DATA`** — conjunto abierto: los módulos y los tipos de actor que REALMENTE
 * aparecen en la bitácora de este tenant. No hay lista canónica en ningún sitio
 * —los escribe quien instrumenta cada endpoint— así que la única fuente honesta
 * es la propia tabla. Una lista escrita a mano envejece en silencio: se añade un
 * módulo, nadie actualiza la constante, y el filtro deja de poder encontrarlo.
 *
 * La distinción viaja al cliente porque cambia lo que la interfaz puede
 * prometer: un conjunto cerrado se puede pintar como un `select` estricto; uno
 * abierto necesita admitir además un valor que todavía no se ha visto.
 */
export type FilterOptionSource = 'SCHEMA' | 'DATA';

export interface ActionLogFilterField {
  /** Nombre del parámetro de consulta, tal cual lo acepta el endpoint. */
  name: string;
  label: string;
  source: FilterOptionSource;
  /** Control que la interfaz debería usar. */
  control: 'select' | 'combobox' | 'boolean' | 'date-range' | 'text' | 'number';
  options: { value: string; label: string }[];
  help?: string;
}

/** Los conjuntos cerrados, leídos del esquema y NO copiados a mano. */
function opcionesDeEnum(campo: 'method' | 'riskLevel'): { value: string; label: string }[] {
  const forma = systemsActionLogQuerySchema.shape[campo];
  // `.optional()` envuelve al enum; se desenvuelve para llegar a sus valores.
  const interno = (forma as { unwrap?: () => unknown }).unwrap?.() ?? forma;
  const valores = (interno as { options?: readonly string[] }).options ?? [];
  return valores.map((value) => ({ value, label: value }));
}

const RIESGO_AYUDA: Record<string, string> = {
  LOW: 'Operación de lectura o de bajo impacto.',
  MEDIUM: 'Modifica datos operativos.',
  HIGH: 'Toca datos sensibles o decisiones de negocio.',
  CRITICAL: 'Afecta seguridad, permisos o dinero.',
};

export interface ActionLogFilterCatalogInput {
  /** Módulos distintos presentes en la bitácora del tenant. */
  modules: string[];
  /** Tipos de actor distintos presentes en la bitácora del tenant. */
  actorTypes: string[];
}

/**
 * El catálogo completo, listo para pintar la barra de filtros.
 *
 * Se devuelve la lista ENTERA de campos —no sólo las opciones— para que la
 * interfaz no tenga que saberse de memoria qué filtros admite el endpoint. Ése
 * era el desajuste real: el backend aceptaba once filtros y la pantalla ofrecía
 * tres, sin que nada delatara los ocho que faltaban.
 */
/** Los que no dependen de los datos: se construyen una sola vez. */
const CAMPOS_FIJOS: ActionLogFilterField[] = [
  { name: 'method', label: 'Método HTTP', source: 'SCHEMA', control: 'select', options: opcionesDeEnum('method') },
  {
    name: 'riskLevel',
    label: 'Riesgo',
    source: 'SCHEMA',
    control: 'select',
    options: opcionesDeEnum('riskLevel').map((opcion) => ({
      ...opcion,
      label: RIESGO_AYUDA[opcion.value] ? `${opcion.value} · ${RIESGO_AYUDA[opcion.value]}` : opcion.value,
    })),
    help: 'Cuánto impacto tiene la operación registrada, no si salió bien.',
  },
  {
    name: 'containsPii',
    label: 'Toca datos personales',
    source: 'SCHEMA',
    control: 'boolean',
    options: [
      { value: 'true', label: 'Sí' },
      { value: 'false', label: 'No' },
    ],
  },
  {
    name: 'statusCode',
    label: 'Código de respuesta',
    source: 'SCHEMA',
    control: 'number',
    options: [],
    help: 'Código HTTP exacto (100–599).',
  },
  { name: 'from', label: 'Desde', source: 'SCHEMA', control: 'date-range', options: [] },
  { name: 'to', label: 'Hasta', source: 'SCHEMA', control: 'date-range', options: [] },
  {
    name: 'requestId',
    label: 'Request ID',
    source: 'SCHEMA',
    control: 'text',
    options: [],
    help: 'Identificador técnico de una petición concreta.',
  },
  {
    name: 'correlationId',
    label: 'Correlation ID',
    source: 'SCHEMA',
    control: 'text',
    options: [],
    help: 'Agrupa varias peticiones de una misma operación de negocio.',
  },
];

export function buildActionLogFilterCatalog(input: ActionLogFilterCatalogInput): { fields: ActionLogFilterField[] } {
  const desdeLosDatos: ActionLogFilterField[] = [
    {
      name: 'module',
      label: 'Módulo',
      source: 'DATA',
      control: 'combobox',
      options: input.modules.map((value) => ({ value, label: value })),
      help: 'Módulos que aparecen en la bitácora de este tenant.',
    },
    {
      name: 'actorType',
      label: 'Tipo de actor',
      source: 'DATA',
      control: 'combobox',
      options: input.actorTypes.map((value) => ({ value, label: value })),
      help: 'Quién ejecutó la acción: persona, servicio, trabajo programado…',
    },
  ];
  // El orden importa: método y riesgo primero porque son los que más se usan, y
  // los de texto al final porque quien los teclea ya sabe lo que busca.
  return { fields: [CAMPOS_FIJOS[0], CAMPOS_FIJOS[1], ...desdeLosDatos, ...CAMPOS_FIJOS.slice(2)] };
}
