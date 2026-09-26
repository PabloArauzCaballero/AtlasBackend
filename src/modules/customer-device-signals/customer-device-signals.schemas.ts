/**
 * @file Contratos Zod de las dos señales que el dispositivo entrega con permiso explícito.
 * @business Esta pieza delimita exactamente qué de la agenda y del rastro de ubicación entra al sistema.
 * @system valida en el borde la ficha de cada contacto y cada posición, y rechaza lotes incoherentes.
 */
import { z } from 'zod';

/**
 * La regla que gobierna este archivo, dicha antes que nada.
 *
 * Aquí SÍ entra PII de terceros: nombres, teléfonos y correos de personas que no son clientes de
 * Atlas. Eso es lo que el producto decidió pedir, con consentimiento explícito de quien entrega la
 * agenda, y lo que estas dos tablas guardan cifrado.
 *
 * Lo que este archivo hace es acotar QUÉ entra. Todo campo que no esté declarado aquí se descarta en
 * el borde: si mañana `expo-contacts` empieza a devolver notas, relaciones o la foto del contacto,
 * no llegan a la base de datos por el hecho de no estar en este esquema. Una lista blanca es la
 * única forma de que el alcance del tratamiento no crezca por accidente al actualizar una librería.
 */

/** Tope por lote. La app trocea agendas grandes; sin tope esto sería un canal de subida. */
const MAX_CONTACTS_POR_LOTE = 500;
const MAX_PINGS_POR_LOTE = 200;

const textoCorto = z.string().trim().min(1).max(200);

const telefonoDeContacto = z.object({
  /** «casa», «móvil», «trabajo». Lo etiqueta el sistema operativo; se guarda tal cual. */
  label: z.string().trim().max(60).nullish(),
  number: z.string().trim().min(3).max(40),
});

const correoDeContacto = z.object({
  label: z.string().trim().max(60).nullish(),
  email: z.string().trim().max(200),
});

const direccionDeContacto = z.object({
  label: z.string().trim().max(60).nullish(),
  street: z.string().trim().max(300).nullish(),
  city: z.string().trim().max(120).nullish(),
  region: z.string().trim().max(120).nullish(),
  country: z.string().trim().max(120).nullish(),
});

export const deviceContactSchema = z.object({
  /**
   * El identificador que el sistema operativo le da al contacto.
   *
   * Obligatorio, y es lo que convierte la segunda sincronización en una actualización en vez de en
   * una copia. El servidor lo hashea antes de guardarlo; en claro no se persiste.
   */
  externalId: z.string().trim().min(1).max(200),
  displayName: textoCorto.nullish(),
  givenName: z.string().trim().max(120).nullish(),
  familyName: z.string().trim().max(120).nullish(),
  company: z.string().trim().max(200).nullish(),
  jobTitle: z.string().trim().max(200).nullish(),
  /** `YYYY-MM-DD`. Muchas agendas guardan el cumpleaños sin año; la app manda el año o nada. */
  birthday: z.iso.date().nullish(),
  contactType: z.enum(['person', 'company', 'unknown']).default('person'),
  isFavorite: z.boolean().default(false),
  phones: z.array(telefonoDeContacto).max(20).default([]),
  emails: z.array(correoDeContacto).max(20).default([]),
  addresses: z.array(direccionDeContacto).max(10).default([]),
});

export type DeviceContactDto = z.infer<typeof deviceContactSchema>;

export const addressBookSyncSchema = z
  .object({
    /** El dispositivo desde el que se leyó. El servidor comprueba que sea de este cliente. */
    deviceId: z.string().trim().min(1).max(40),
    sessionId: z.string().trim().min(1).max(40).nullish(),
    algorithmVersion: z.string().trim().min(1).max(80),
    capturedAt: z.iso.datetime({ offset: true }),
    /**
     * Si este lote cierra la sincronización.
     *
     * La app trocea la agenda; sólo el último lote lleva `true`, y es el que hace que el servidor
     * marque la ejecución como completa. Sin esta marca, una sincronización interrumpida a mitad
     * quedaría indistinguible de una agenda de 500 contactos.
     */
    isFinalBatch: z.boolean().default(true),
    /** Cuántos contactos tiene la agenda ENTERA, no este lote. Sirve para saber si llegó todo. */
    totalContactsInDevice: z.coerce.number().int().min(0).max(100_000),
    /**
     * Si el sistema dejó ver la agenda entera o sólo los contactos elegidos.
     *
     * Desde iOS 18 la persona puede conceder acceso a contactos SUELTOS: el permiso sale concedido y
     * la lectura devuelve un subconjunto. Sin este campo, «esta agenda tiene 6 contactos» sería
     * indistinguible de «esta persona tiene 6 contactos», y el motor leería como señal sobre la
     * persona lo que en realidad es una decisión sobre el permiso.
     *
     * Por defecto `all`, que es lo que hacen Android y cualquier versión de la app anterior a este
     * campo: el valor por defecto tiene que ser el comportamiento antiguo, o publicar el campo
     * reetiquetaría retroactivamente todas las capturas ya recibidas.
     */
    accessScope: z.enum(['all', 'limited']).default('all'),
    contacts: z.array(deviceContactSchema).min(1).max(MAX_CONTACTS_POR_LOTE),
  })
  .superRefine((valor, ctx) => {
    if (valor.contacts.length > valor.totalContactsInDevice) {
      ctx.addIssue({
        code: 'custom',
        path: ['contacts'],
        message: 'El lote no puede traer más contactos de los que dice tener la agenda.',
      });
    }
  });

export type AddressBookSyncDto = z.infer<typeof addressBookSyncSchema>;

export interface AddressBookSyncView {
  readonly customerId: string;
  readonly computationRunId: string;
  readonly received: number;
  readonly created: number;
  readonly updated: number;
  readonly totalStored: number;
  readonly receivedAt: string;
}

/**
 * Una posición del dispositivo.
 *
 * `capturedAt` es del reloj DEL TELÉFONO y no del servidor: un lote acumulado sin red se envía
 * horas después, y fecharlo con la hora de llegada convertiría un rastro en una línea recta hasta el
 * momento en que volvió la cobertura.
 */
export const locationPingSchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  accuracyMeters: z.coerce.number().min(0).max(100_000).nullish(),
  altitudeMeters: z.coerce.number().min(-1_000).max(20_000).nullish(),
  speedMps: z.coerce.number().min(0).max(1_000).nullish(),
  headingDegrees: z.coerce.number().min(0).max(360).nullish(),
  captureMode: z.enum(['foreground', 'background', 'session_start', 'manual']).default('foreground'),
  /** Lo declara el sistema operativo. Es señal de fraude y por eso viaja aunque sea `false`. */
  isMocked: z.boolean().default(false),
  batteryLevel: z.coerce.number().min(0).max(1).nullish(),
  capturedAt: z.iso.datetime({ offset: true }),
});

export const locationPingBatchSchema = z.object({
  deviceId: z.string().trim().min(1).max(40),
  sessionId: z.string().trim().min(1).max(40).nullish(),
  pings: z.array(locationPingSchema).min(1).max(MAX_PINGS_POR_LOTE),
});

export type LocationPingDto = z.infer<typeof locationPingSchema>;
export type LocationPingBatchDto = z.infer<typeof locationPingBatchSchema>;

export interface LocationPingBatchView {
  readonly customerId: string;
  readonly received: number;
  readonly stored: number;
  /** Cuántos venían repetidos de un reintento. No son un error: son la idempotencia funcionando. */
  readonly duplicated: number;
  readonly receivedAt: string;
}

export const deviceSignalsCustomerParamsSchema = z.object({
  customerId: z.string().trim().regex(/^\d+$/u, 'customerId debe ser numérico.'),
});

export type DeviceSignalsCustomerParamsDto = z.infer<typeof deviceSignalsCustomerParamsSchema>;
