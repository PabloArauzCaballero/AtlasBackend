/**
 * @file Contrato Zod del snapshot de agenda calculado EN EL DISPOSITIVO.
 * @business Esta pieza mide el arraigo social de quien se da de alta sin llevarse su libreta de direcciones.
 * @system valida en el borde una fotografía agregada de la agenda y rechaza cualquier dato personal en ella.
 */
import { z } from 'zod';

/**
 * Lo que el teléfono envía después de mirar su propia agenda.
 *
 * ## La regla que gobierna este archivo entero
 *
 * **Aquí no entra ni un solo dato personal de un tercero.** Ni nombres, ni
 * teléfonos, ni correos, ni identificadores de contacto. Entran CUENTAS y
 * PROPORCIONES, más un conjunto de hashes que el servidor usa una vez y tira.
 *
 * No es una postura: es la única versión de esta señal que se puede defender
 * ante quien la firma. Las personas de la agenda de alguien no consintieron
 * nada, no son clientes, y muchas ni siquiera saben que existimos. Copiar su
 * libreta de direcciones «para analizar el riesgo» es recoger datos de miles de
 * terceros para decidir sobre uno.
 *
 * ## Qué se calcula en el teléfono y por qué
 *
 * Todo lo que se puede. El dispositivo tiene los datos claros, así que es el
 * único sitio donde `referenciasEnAgenda` se puede calcular SIN mandar nada:
 * compara los teléfonos que la persona declaró como referencias con los de su
 * agenda y manda un número entre cero y dos. El servidor nunca ve ninguno de los
 * cuatro teléfonos implicados.
 *
 * ## Los hashes, que son la única excepción y son de un solo uso
 *
 * Hay una señal que el teléfono NO puede calcular solo: si en su agenda hay
 * números que ya conocemos por otros expedientes. Eso exige cruzar contra datos
 * del servidor.
 *
 * Se resuelve mandando SHA-256 de cada teléfono normalizado —la misma convención
 * con la que el resto del sistema guarda un teléfono, `hashSensitiveText`— y el
 * servidor:
 *
 * 1. cruza contra `watchlist_entries` y contra las referencias de OTROS
 *    expedientes,
 * 2. se queda con el NÚMERO de coincidencias,
 * 3. **descarta los hashes**. No se persisten, no se registran y no salen del
 *    proceso que atendió la petición.
 *
 * Un hash de teléfono es reversible por fuerza bruta —el espacio de números es
 * pequeño—, así que guardarlo sería casi tan malo como guardar el número. Por eso
 * el paso 3 no es una optimización: es el control.
 */

/** Un SHA-256 en hexadecimal, que es lo único que se admite en la lista. */
const hashSha256 = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{64}$/u, 'Cada entrada debe ser un SHA-256 en hexadecimal minúscula.');

/**
 * Tope de hashes por captura.
 *
 * Cinco mil cubre con holgura la agenda de cualquier persona —la mediana está en
 * unos doscientos— y acota el cuerpo a unos 320 KiB. Sin tope, un cliente mal
 * hecho o malintencionado convertiría este endpoint en un canal de subida.
 */
const MAX_HASHES = 5_000;

export const contactsSnapshotSchema = z
  .object({
    /**
     * Si la persona concedió el permiso de contactos.
     *
     * `false` es una respuesta LEGÍTIMA y se registra igual: negarse a compartir
     * la agenda no es una señal de fraude, es un derecho. Lo que cambia es que
     * hay menos evidencia, y el artefacto lo pondera como tal. Registrar la
     * negativa —en vez de no mandar nada— es lo que permite distinguir «dijo que
     * no» de «esta versión de la app todavía no lo pedía».
     */
    granted: z.boolean(),
    /** Versión del algoritmo que corrió en el teléfono. Viaja a la fila de la ejecución. */
    algorithmVersion: z.string().trim().min(1).max(80),
    /** Cuándo lo calculó el dispositivo, con SU reloj. El servidor guarda además el suyo. */
    computedAt: z.iso.datetime({ offset: true }),

    totalContacts: z.coerce.number().int().min(0).max(100_000).default(0),
    contactsWithPhone: z.coerce.number().int().min(0).max(100_000).default(0),
    uniquePhoneCount: z.coerce.number().int().min(0).max(100_000).default(0),
    /** Cuántos números llevan prefijo boliviano (+591) o son nacionales de 8 cifras. */
    bolivianPhoneCount: z.coerce.number().int().min(0).max(100_000).default(0),
    /**
     * Cuántas de las referencias declaradas están en la agenda.
     *
     * Lo calcula el TELÉFONO comparando hashes en local. El servidor recibe un
     * número, no los teléfonos, y esa es toda la diferencia entre esta señal y
     * copiarse la libreta.
     */
    referencesFoundInAddressBook: z.coerce.number().int().min(0).max(20).default(0),
    referencesDeclared: z.coerce.number().int().min(0).max(20).default(0),

    /**
     * Hashes de un solo uso para el cruce contra datos del servidor.
     *
     * Opcional: sin ellos el cruce no se hace y su métrica queda en cero con la
     * anotación de que no se pudo calcular. Preferible a inventarla.
     */
    phoneHashes: z.array(hashSha256).max(MAX_HASHES).optional(),
  })
  .superRefine((valor, ctx) => {
    /*
     * Sin permiso no puede haber medidas, y esto NO es puntillismo de validación.
     *
     * Un cliente que mande `granted: false` con doscientos contactos está
     * declarando dos cosas que no pueden ser ciertas a la vez, y la más probable
     * es que leyera la agenda igualmente. Aceptarlo dejaría entrar datos
     * recogidos sin permiso y, peor, los dejaría entrar ETIQUETADOS como
     * recogidos con él.
     */
    if (!valor.granted && (valor.totalContacts > 0 || (valor.phoneHashes?.length ?? 0) > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['granted'],
        message:
          'Un snapshot sin permiso concedido no puede traer medidas de la agenda: revisa el cliente.',
      });
    }
    if (valor.uniquePhoneCount > valor.contactsWithPhone) {
      ctx.addIssue({
        code: 'custom',
        path: ['uniquePhoneCount'],
        message: 'No puede haber más números distintos que contactos con número.',
      });
    }
    if (valor.contactsWithPhone > valor.totalContacts) {
      ctx.addIssue({
        code: 'custom',
        path: ['contactsWithPhone'],
        message: 'No puede haber más contactos con número que contactos.',
      });
    }
    if (valor.referencesFoundInAddressBook > valor.referencesDeclared) {
      ctx.addIssue({
        code: 'custom',
        path: ['referencesFoundInAddressBook'],
        message: 'No pueden encontrarse más referencias de las que se declararon.',
      });
    }
  });

export type ContactsSnapshotDto = z.infer<typeof contactsSnapshotSchema>;

/**
 * Los agregados que salen del snapshot y que consume el artefacto de identidad.
 *
 * Es el contrato ESTABLE entre este módulo y la política de decisión: el
 * artefacto lee estos seis campos y nada más. Cambiar lo que el teléfono manda no
 * puede obligar a versionar el artefacto mientras estos seis se sigan pudiendo
 * calcular.
 */
export interface ContactsSnapshotFeatures {
  readonly available: boolean;
  readonly totalContacts: number;
  /** Números distintos sobre contactos con número. `0` si no hay ninguno. */
  readonly uniqueRatio: number;
  /** Números bolivianos sobre contactos con número. `0` si no hay ninguno. */
  readonly bolivianRatio: number;
  readonly referencesFoundInAddressBook: number;
  /** Coincidencias con teléfonos que ya conocemos por otros expedientes. */
  readonly riskMatches: number;
}

/** Lo que se le contesta al móvil: el hecho de haberlo recibido, sin devolverle análisis. */
export interface ContactsSnapshotView {
  readonly customerId: string;
  readonly computationRunId: string;
  readonly granted: boolean;
  readonly receivedAt: string;
}
