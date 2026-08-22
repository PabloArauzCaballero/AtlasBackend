/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza abre los datos gobernados al análisis sin dejar que nadie los altere ni los extraiga en claro.
 * @system decide qué columna del cuaderno se sirve en claro, enmascarada o no se sirve.
 */

export type NotebookColumnPolicy = 'PLAIN' | 'MASKED' | 'REDACTED';

export type NotebookColumnDescriptor = {
  name: string;
  /** Categoría del dato personal (`EMAIL`, `PHONE`, `IDENTITY_DOCUMENT`…) o `null`. */
  piiType: string | null;
  policy: NotebookColumnPolicy;
  /** Por qué se aplicó esa política, en una línea, para que la pantalla lo explique sin adivinar. */
  reason: string | null;
};

const MASK = '••••';

/**
 * Por qué esta clasificación NO reutiliza `classifyColumn` del catálogo de gobierno.
 *
 * Aquélla existe para marcar campos que una persona revisará después, y es deliberadamente
 * conservadora: «ante la duda marca de más, porque revisar un campo que no era sensible cuesta
 * mucho menos que tratar como inocuo uno que sí lo era». Ese criterio es correcto allí y ruinoso
 * aquí, porque en un cuaderno marcar de más no cuesta una revisión: cuesta el análisis.
 *
 * Medido contra la base real, con esa clasificación un analista de riesgo veía enmascaradas
 * `latest_risk_score`, `latest_risk_band` y `latest_risk_decision` —los tres números por los que
 * abriría la pantalla— porque «lat» casa dentro de «latest» y el patrón de ubicación busca por
 * subcadena. También perdía `customer_id`, con lo que no podía agrupar ni contar por cliente, y
 * `primary_email_domain`, que la vista publica ya desidentificado justamente para que se pueda
 * analizar.
 *
 * Así que aquí se compara por PALABRA y no por subcadena, y se parte de un hecho que allí no
 * aplica: `read_api` YA es la superficie de lectura gobernada de este backend. Sus columnas se
 * llaman como se llaman —`primary_email_domain`, `primary_phone_last_4`— para anunciar el
 * tratamiento que ya recibieron. Volver a taparlas no es defensa en profundidad: es deshacer un
 * trabajo de desidentificación deliberado y dejar la vista sin nada que mirar.
 */

/** Palabras que delatan dato personal EN CRUDO, con su categoría. El orden fija la precedencia. */
const CATEGORIAS: ReadonlyArray<readonly [readonly string[], string]> = [
  [['token', 'password', 'secret', 'credential', 'apikey'], 'CREDENTIAL'],
  [['email', 'correo'], 'EMAIL'],
  [['phone', 'mobile', 'whatsapp', 'telefono'], 'PHONE'],
  [['dni', 'document', 'passport', 'nit', 'ci'], 'IDENTITY_DOCUMENT'],
  [['address', 'gps', 'latitude', 'longitude', 'geolocation'], 'LOCATION'],
  [['name', 'fullname', 'surname', 'birth', 'birthdate'], 'PERSON'],
];

/**
 * Sufijos con los que una columna DECLARA que ya viene tratada.
 *
 * `primary_email_domain` no es un correo: es el dominio, que es exactamente el agregado que hace
 * posible la pregunta «¿cuántos clientes usan un correo corporativo?». `primary_phone_last_4` no
 * es un teléfono. Enmascararlos no protege a nadie —el dato identificador ya no está— y borra la
 * única forma que tiene la vista de ser analizable.
 */
const YA_TRATADA = ['domain', 'last4', 'masked', 'hash', 'bucket', 'range', 'band', 'count', 'year'];

/** Últimas palabras que hacen de la columna una CLAVE y no un dato personal. */
const CLAVES = ['id', 'uuid', 'code', 'ref', 'key'];

/**
 * Sujetos que NO son personas, y por tanto cuyo «nombre» no es dato personal.
 *
 * `provider_name` es «SEGIP»: una institución, no alguien. Enmascararla es el mismo error que
 * enmascarar `latest_risk_score`, sólo que al revés — se tapa algo público y la tabla de salud de
 * proveedores deja de poder leerse. La distinción se hace por el sujeto que califica la columna,
 * que es precisamente lo que el nombrado de `read_api` deja explícito.
 */
const SUJETOS_NO_PERSONALES = [
  'provider',
  'system',
  'endpoint',
  'template',
  'channel',
  'worker',
  'artifact',
  'rule',
  'policy',
  'tenant',
  'organization',
  'company',
  'product',
  'queue',
  'dataset',
  'view',
  'model',
  'file',
  'event',
];

/** `latest_risk_score` -> ['latest','risk','score']; `primary_phone_last_4` -> [...,'last4']. */
function palabras(nombre: string): string[] {
  return nombre
    .toLowerCase()
    .replace(/([a-z])(\d)/g, '$1_$2')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .reduce<string[]>((acumulado, parte) => {
      // `last` + `4` vuelven a unirse: el sufijo que anuncia el tratamiento es «last4», y separados
      // ninguno de los dos significa nada.
      const previa = acumulado[acumulado.length - 1];
      if (previa === 'last' && /^\d+$/.test(parte)) {
        acumulado[acumulado.length - 1] = `last${parte}`;
        return acumulado;
      }
      acumulado.push(parte);
      return acumulado;
    }, []);
}

function categoriaDe(partes: readonly string[]): string | null {
  for (const [terminos, categoria] of CATEGORIAS) {
    if (partes.some((parte) => terminos.includes(parte))) return categoria;
  }
  return null;
}

/**
 * Decide la política de cada columna del resultado.
 *
 * Tres políticas y no dos. `REDACTED` no es un enmascarado más fuerte: es la negativa a servir el
 * valor bajo ninguna condición, y se reserva a las credenciales. El permiso de «ver en claro»
 * existe para investigar un caso con dato personal; no existe una investigación que requiera leer
 * el hash de una contraseña por pantalla, y dejar ese camino abierto convertiría el rol más alto
 * de la consola en una extracción de credenciales.
 */
export function describeColumns(names: readonly string[], reveal: boolean): NotebookColumnDescriptor[] {
  return names.map((name) => {
    const partes = palabras(name);
    const categoria = categoriaDe(partes);

    if (categoria === 'CREDENTIAL') {
      return { name, piiType: categoria, policy: 'REDACTED', reason: 'Credencial: no se sirve nunca en claro.' };
    }

    if (!categoria) {
      return { name, piiType: null, policy: 'PLAIN', reason: null };
    }

    // Una clave es un identificador SUSTITUTO, no el dato de la persona. Taparla no protege a
    // nadie y deja la tabla sin nada por lo que agrupar, contar ni cruzar — que es todo lo que se
    // hace en un cuaderno.
    if (CLAVES.includes(partes[partes.length - 1])) {
      return {
        name,
        piiType: categoria,
        policy: 'PLAIN',
        reason: 'Identificador sustituto: sirve para agrupar, no identifica por sí solo.',
      };
    }

    // «El nombre de un proveedor» no es el nombre de nadie. Sólo aplica a la categoría PERSON: un
    // `provider_email` SIGUE siendo un correo, y taparlo es correcto.
    if (categoria === 'PERSON' && partes.some((parte) => SUJETOS_NO_PERSONALES.includes(parte))) {
      return {
        name,
        piiType: null,
        policy: 'PLAIN',
        reason: 'Nombre de una entidad, no de una persona.',
      };
    }

    if (partes.some((parte) => YA_TRATADA.includes(parte))) {
      return {
        name,
        piiType: categoria,
        policy: 'PLAIN',
        reason: 'La vista de read_api ya publica este campo desidentificado.',
      };
    }

    if (reveal) {
      return { name, piiType: categoria, policy: 'PLAIN', reason: 'Dato personal servido en claro por permiso explícito.' };
    }

    return { name, piiType: categoria, policy: 'MASKED', reason: `Dato personal (${categoria}) enmascarado.` };
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
      // Nombres y fechas de nacimiento. Se deja la inicial porque distinguir dos filas entre sí es
      // el uso legítimo, y leer el nombre no lo es.
      return keepHead(text, 1);
  }
}

/**
 * `pablo.arauz@atlas.internal` -> `p••••@atlas.internal`.
 *
 * El dominio se conserva: es lo que permite ver de un vistazo si una cuenta es interna o de un
 * proveedor, que es la pregunta de un diagnóstico. La parte local identifica a la persona.
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
