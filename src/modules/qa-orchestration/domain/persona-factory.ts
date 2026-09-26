/**
 * @file Utilidad pura del dominio: personas sintéticas deterministas.
 * @business Esta pieza da a cada persona de una corrida QA una identidad coherente y reproducible.
 * @system extraída de `scripts/qa` para que CLI, API y worker usen el mismo generador.
 *
 * Personas sintéticas deterministas y COHERENTES.
 *
 * No es un generador de ruido. Dos propiedades que un motor de QA necesita y que un `faker` suelto
 * no da:
 *
 * 1. **Determinismo por semilla.** La misma `(masterSeed, ordinal)` produce siempre la misma
 *    persona. Sin eso, una corrida que falla en la persona 17 no se puede reproducir, y el
 *    diagnóstico se vuelve arqueología. El RNG se deriva por `(semilla, ordinal, dominio)` y NO se
 *    consume de un flujo global: repartir el trabajo entre más workers no puede cambiar la
 *    identidad de nadie.
 * 2. **Coherencia interna.** La fecha de nacimiento concuerda con la edad, la ciudad con su
 *    departamento y su prefijo telefónico, y el ingreso con el perfil declarado. Una fixture
 *    incoherente hace fallar al motor de riesgo por el motivo equivocado, y se pierde una tarde
 *    buscando un defecto que no existe.
 *
 * Seguridad de los datos: correos en `example.test` (reservado por RFC 2606, no resuelve), teléfonos
 * del rango de pruebas, y documentos por encima del rango emitido. Nada de esto puede coincidir con
 * una persona real, que es la única garantía aceptable cuando el tráfico sale por la red.
 *
 * ## Semilla y namespace son cosas distintas
 *
 * La semilla fija QUIÉN es la persona: su nombre, su fecha de nacimiento, su ciudad, su ingreso.
 * Repetir una corrida con la misma semilla tiene que producir la misma persona — es lo que hace
 * reproducible un fallo.
 *
 * El `runNamespace` fija los identificadores OPERACIONALES —correo, teléfono, documento— que el
 * backend guarda como únicos. Sin separarlos, repetir una corrida choca contra los clientes que
 * creó la anterior: pasó de verdad en la segunda corrida de veinte personas, y las diez primeras
 * recibieron `409 CONFLICT`. No era un defecto del backend rechazando duplicados: era el generador
 * pidiéndole que creara dos veces a la misma persona.
 *
 * Por eso el mismo dataset semántico puede vivir en namespaces distintos, y por eso el namespace NO
 * entra en el flujo que genera nombre, edad o ciudad.
 */
import { createHash } from 'node:crypto';

/**
 * Versión del generador. Entra en el snapshot de la corrida: si cambia la forma de derivar una
 * persona, la misma semilla deja de reproducir la misma persona y eso tiene que verse.
 *
 * Los rangos de documento y teléfono reducen la probabilidad de coincidir con alguien real, pero
 * NO la garantizan: la garantía operacional es el aislamiento de red y los sinks QA del entorno.
 */
export const PERSONA_GENERATOR_VERSION = 'persona-factory@1';

export type Persona = {
  ordinal: number;
  personaKey: string;
  synthetic: true;
  firstName: string;
  lastName: string;
  birthDate: string;
  age: number;
  documentNumber: string;
  email: string;
  phone: string;
  city: string;
  department: string;
  timezone: 'America/La_Paz';
  currency: 'BOB';
  monthlyIncome: number;
  /** PIN de 4 dígitos: es lo que el contrato real de alta exige, no una contraseña. */
  pin: string;
  deviceFingerprintHash: string;
  archetype: Archetype;
  /** VALID / BOUNDARY / ERROR: la clasificación QA, independiente del recorrido y del proveedor. */
  caseCategory: CaseCategory;
};

export type CaseCategory = 'VALID' | 'BOUNDARY' | 'ERROR';
export type Archetype = 'nuevo_completo' | 'recurrente' | 'credito_elegible' | 'revision_manual' | 'rechazo_esperado';

/** Ciudades con su departamento y su prefijo real: el par no se sortea por separado. */
const CIUDADES = [
  { city: 'La Paz', department: 'La Paz', prefix: '7' },
  { city: 'Santa Cruz de la Sierra', department: 'Santa Cruz', prefix: '7' },
  { city: 'Cochabamba', department: 'Cochabamba', prefix: '7' },
  { city: 'Sucre', department: 'Chuquisaca', prefix: '6' },
  { city: 'Oruro', department: 'Oruro', prefix: '6' },
  { city: 'Tarija', department: 'Tarija', prefix: '7' },
  { city: 'Potosí', department: 'Potosí', prefix: '6' },
  { city: 'Trinidad', department: 'Beni', prefix: '7' },
] as const;

const NOMBRES = ['Ana', 'Luis', 'Carla', 'Jorge', 'Mariela', 'Ramiro', 'Fabiola', 'Diego', 'Rosa', 'Iván', 'Noelia', 'Marco'];
const APELLIDOS = ['Quispe', 'Mamani', 'Chávez', 'Rojas', 'Vargas', 'Condori', 'Salazar', 'Terceros', 'Flores', 'Arce'];

const ARCHETYPES: Archetype[] = ['nuevo_completo', 'recurrente', 'credito_elegible', 'revision_manual', 'rechazo_esperado'];

/**
 * Flujo determinista por `(semilla, ordinal, dominio)`.
 *
 * El dominio importa: sin él, agregar un campo nuevo a la persona corre todos los valores
 * siguientes, y una corrida que ayer usaba el documento X hoy usa el Y con la misma semilla. Con
 * dominio, cada campo tiene su propio flujo y agregar uno no mueve a los demás.
 */
function stream(masterSeed: string, ordinal: number, domain: string): () => number {
  let counter = 0;
  return () => {
    const digest = createHash('sha256').update(`${masterSeed}|${ordinal}|${domain}|${counter++}`).digest();
    return digest.readUInt32BE(0) / 0xffffffff;
  };
}

function pick<T>(next: () => number, options: readonly T[]): T {
  return options[Math.floor(next() * options.length) % options.length];
}

function intBetween(next: () => number, min: number, max: number): number {
  return min + Math.floor(next() * (max - min + 1));
}

/**
 * La categoría QA se reparte de forma estable por ordinal, no al azar: una corrida de veinte
 * personas tiene que cubrir las tres categorías siempre, no "casi siempre".
 */
function categoryFor(ordinal: number, mix: { valid: number; boundary: number; error: number }): CaseCategory {
  const total = mix.valid + mix.boundary + mix.error;
  const slot = ordinal % total;
  if (slot < mix.valid) return 'VALID';
  if (slot < mix.valid + mix.boundary) return 'BOUNDARY';
  return 'ERROR';
}

/** PIN de 4 dígitos que pasa la lista de prohibidos del backend (secuencias y repeticiones). */
function pinFor(next: () => number): string {
  const prohibidos = new Set([
    '0000',
    '1111',
    '2222',
    '3333',
    '4444',
    '5555',
    '6666',
    '7777',
    '8888',
    '9999',
    '1234',
    '4321',
    '1212',
    '2580',
  ]);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = String(intBetween(next, 1000, 9999));
    if (!prohibidos.has(candidate) && new Set(candidate).size >= 3) return candidate;
  }
  return '7391';
}

export function buildPersona(input: {
  masterSeed: string;
  ordinal: number;
  refDate: Date;
  /** Unicidad operacional al repetir la corrida. No toca la identidad semántica de la persona. */
  runNamespace: string;
  mix?: { valid: number; boundary: number; error: number };
}): Persona {
  const { masterSeed, ordinal, refDate, runNamespace } = input;
  // Sufijo corto y estable del namespace. 8 hex bastan para que dos corridas del mismo día no
  // colisionen, y caben en los 180 caracteres que el contrato admite para el correo.
  const nonce = createHash('sha256').update(runNamespace).digest('hex').slice(0, 8);
  const mix = input.mix ?? { valid: 3, boundary: 1, error: 1 };

  const identity = stream(masterSeed, ordinal, 'identity');
  const contact = stream(masterSeed, ordinal, 'contact');
  const finance = stream(masterSeed, ordinal, 'finance');
  const device = stream(masterSeed, ordinal, 'device');

  const lugar = pick(identity, CIUDADES);
  const firstName = pick(identity, NOMBRES);
  const lastName = pick(identity, APELLIDOS);

  // La edad manda y la fecha se deriva de ella contra `refDate`, no al revés: así no hay forma de
  // producir un mayor de edad con fecha de nacimiento de hace diez años.
  const age = intBetween(identity, 21, 58);
  const birth = new Date(Date.UTC(refDate.getUTCFullYear() - age, intBetween(identity, 0, 11), intBetween(identity, 1, 28)));

  // Documento por encima del rango emitido: no puede coincidir con una cédula real. El namespace
  // entra aquí —y no en el nombre o la fecha— porque es un identificador ÚNICO en la base.
  const documentNumber = String(90_000_000 + (parseInt(nonce.slice(0, 4), 16) % 9_000_000) + ordinal);
  const personaKey = `p-${String(ordinal).padStart(4, '0')}`;

  return {
    ordinal,
    personaKey,
    synthetic: true,
    firstName,
    lastName,
    birthDate: birth.toISOString().slice(0, 10),
    age,
    documentNumber,
    // `example.test` está reservado por RFC 2606 y no resuelve: un correo de aquí no puede salir a
    // la bandeja de nadie aunque el entorno tuviera un canal mal configurado.
    email: `qa.${personaKey}.${nonce}@example.test`,
    // El teléfono también es único en la base: lleva el namespace, no el sorteo de la semilla.
    phone: `${lugar.prefix}${String((parseInt(nonce.slice(4, 8), 16) % 900) + 100)}${String(10_000 + ordinal).slice(-4)}`,
    city: lugar.city,
    department: lugar.department,
    timezone: 'America/La_Paz',
    currency: 'BOB',
    monthlyIncome: intBetween(finance, 2_500, 18_000),
    pin: pinFor(contact),
    // 64 hex: el contrato exige entre 32 y 128 caracteres.
    deviceFingerprintHash: createHash('sha256').update(`${masterSeed}|${ordinal}|${device()}`).digest('hex'),
    archetype: ARCHETYPES[ordinal % ARCHETYPES.length],
    caseCategory: categoryFor(ordinal, mix),
  };
}

export function buildPersonas(input: { masterSeed: string; count: number; refDate: Date; runNamespace: string }): Persona[] {
  return Array.from({ length: input.count }, (_, index) =>
    buildPersona({ masterSeed: input.masterSeed, ordinal: index + 1, refDate: input.refDate, runNamespace: input.runNamespace }),
  );
}
