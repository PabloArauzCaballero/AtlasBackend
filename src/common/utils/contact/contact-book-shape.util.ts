/**
 * @file La FORMA de la agenda guardada: cuántos contactos, cuándo apareció el último y si parece de una persona.
 * @business Una agenda real crece poco a poco y es desigual —unos contactos con correo, otros con cumpleaños, favoritos—;
 *   la de un teléfono preparado para un alta falsa es mínima, uniforme o cargada de golpe.
 * @system función pura sobre recuentos y fechas; no descifra ninguna ficha ni lee un solo nombre.
 */

/** Lo que el cálculo necesita de cada ficha guardada: sólo recuentos, banderas y cuándo la vimos por primera vez. */
export type FichaObservada = {
  phoneHashes: readonly string[];
  emailCount: number;
  isFavorite: boolean;
  hasBirthday: boolean;
  isCompany: boolean;
  /** Cuándo el servidor guardó la ficha por PRIMERA vez (`_created_at`). */
  firstSeenAt: Date;
};

/** Por debajo de esto una agenda con acceso completo es la de un teléfono recién estrenado… o preparado. */
export const AGENDA_MINIMA = 10;
/** A partir de cuántas fichas tiene sentido juzgar la uniformidad. */
export const MINIMO_PARA_JUZGAR_FORMA = 20;
/** Proporción de teléfonos distintos por debajo de la cual la agenda está hecha de repeticiones. */
export const RATIO_MINIMO_DE_UNICOS = 0.5;
/** Una ficha cuenta como «añadida después» si se vio al menos esto después de la primera sincronización. */
const MARGEN_DE_PRIMERA_SINCRONIZACION_MS = 60 * 60 * 1000;
/** Fichas añadidas en 7 días que ya no parecen la vida normal de una agenda. */
export const CRECIMIENTO_BRUSCO_MINIMO = 50;
const DIA_MS = 86_400_000;

export type FormaDeLaAgenda = {
  total: number;
  withPhone: number;
  uniquePhoneRatio: number | null;
  withEmailRatio: number | null;
  favoritesRatio: number | null;
  withBirthdayRatio: number | null;
  companyRatio: number | null;
  /** Días desde que se guardó la agenda por primera vez. */
  firstSyncAgeDays: number | null;
  /** Fichas que aparecieron DESPUÉS de la primera sincronización. */
  addedAfterFirstSync: number;
  addedLast7d: number;
  addedLast30d: number;
  /**
   * Días desde que apareció el último contacto nuevo. `null` si todavía no se ha visto aparecer ninguno: en la
   * primera sincronización todas las fichas tienen la misma fecha y eso no dice cuándo se crearon en el teléfono.
   */
  daysSinceLastNewContact: number | null;
  senales: string[];
};

const ratio = (parte: number, total: number): number | null => (total === 0 ? null : Number((parte / total).toFixed(3)));

/**
 * La forma de una agenda, y las señales que dispara.
 *
 * ## «Antigüedad del último contacto»: qué se puede saber y qué no
 *
 * El teléfono NO entrega la fecha en que se creó cada contacto (ni `expo-contacts` ni la API pública de iOS la
 * exponen). Lo que el servidor sí sabe es cuándo VIO cada ficha por primera vez, porque la agenda se resincroniza a
 * diario. De ahí sale `daysSinceLastNewContact`: no aplica el día del alta —todas las fichas llegan juntas— y se
 * vuelve útil desde la segunda sincronización, que es justo cuando se decide el primer crédito.
 *
 * ## Señales (todas de partida, sin cortes medidos: derivan a una persona, no rechazan)
 * - `AGENDA_MINIMA`: menos de `AGENDA_MINIMA` contactos.
 * - `AGENDA_REPETIDA`: menos de la mitad de los teléfonos son distintos.
 * - `AGENDA_UNIFORME`: 20 o más fichas y ninguna con correo, cumpleaños, favorito ni empresa — todas iguales.
 * - `AGENDA_CARGADA_DE_GOLPE`: 50 o más fichas nuevas en 7 días y más de la mitad de la agenda.
 */
export function calcularFormaDeLaAgenda(fichas: readonly FichaObservada[], now: Date): FormaDeLaAgenda {
  const total = fichas.length;
  const telefonos = fichas.flatMap((f) => f.phoneHashes);
  const primera = total === 0 ? null : Math.min(...fichas.map((f) => f.firstSeenAt.getTime()));
  const despues = primera === null ? [] : fichas.filter((f) => f.firstSeenAt.getTime() > primera + MARGEN_DE_PRIMERA_SINCRONIZACION_MS);
  const hace = (dias: number) => now.getTime() - dias * DIA_MS;
  const addedLast7d = despues.filter((f) => f.firstSeenAt.getTime() >= hace(7)).length;
  const ultima = despues.length === 0 ? null : Math.max(...despues.map((f) => f.firstSeenAt.getTime()));

  const conCorreo = fichas.filter((f) => f.emailCount > 0).length;
  const favoritos = fichas.filter((f) => f.isFavorite).length;
  const conCumple = fichas.filter((f) => f.hasBirthday).length;
  const empresas = fichas.filter((f) => f.isCompany).length;
  const uniquePhoneRatio = ratio(new Set(telefonos).size, telefonos.length);

  const senales: string[] = [];
  if (total < AGENDA_MINIMA) senales.push('AGENDA_MINIMA');
  if (uniquePhoneRatio !== null && telefonos.length >= AGENDA_MINIMA && uniquePhoneRatio < RATIO_MINIMO_DE_UNICOS)
    senales.push('AGENDA_REPETIDA');
  if (total >= MINIMO_PARA_JUZGAR_FORMA && conCorreo + favoritos + conCumple + empresas === 0) senales.push('AGENDA_UNIFORME');
  if (addedLast7d >= CRECIMIENTO_BRUSCO_MINIMO && addedLast7d > total / 2) senales.push('AGENDA_CARGADA_DE_GOLPE');

  return {
    total,
    withPhone: fichas.filter((f) => f.phoneHashes.length > 0).length,
    uniquePhoneRatio,
    withEmailRatio: ratio(conCorreo, total),
    favoritesRatio: ratio(favoritos, total),
    withBirthdayRatio: ratio(conCumple, total),
    companyRatio: ratio(empresas, total),
    firstSyncAgeDays: primera === null ? null : Math.floor((now.getTime() - primera) / DIA_MS),
    addedAfterFirstSync: despues.length,
    addedLast7d,
    addedLast30d: despues.filter((f) => f.firstSeenAt.getTime() >= hace(30)).length,
    daysSinceLastNewContact: ultima === null ? null : Math.floor((now.getTime() - ultima) / DIA_MS),
    senales,
  };
}
