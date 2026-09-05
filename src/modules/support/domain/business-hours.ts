/**
 * @file Regla de dominio pura: calcular vencimientos de SLA en horario hábil y zona horaria.
 * @business Un compromiso de «4 horas hábiles» no vence a las tres de la mañana de un domingo.
 * @system aritmética de calendario con `Intl` (sin dependencias) sobre la zona de la política.
 */

/** Calendario laboral versionado que acompaña a la política de SLA. */
export interface BusinessCalendar {
  readonly timezone: string;
  /** Días hábiles, 0 = domingo … 6 = sábado. */
  readonly weekdays: readonly number[];
  /** Minuto del día en que abre y en que cierra la atención (480 = 08:00). */
  readonly startMinute: number;
  readonly endMinute: number;
  /** Feriados en `YYYY-MM-DD`, interpretados en la zona del calendario. */
  readonly holidays: readonly string[];
}

export const DEFAULT_BUSINESS_CALENDAR: BusinessCalendar = {
  timezone: 'America/La_Paz',
  weekdays: [1, 2, 3, 4, 5],
  startMinute: 8 * 60 + 30,
  endMinute: 18 * 60,
  holidays: [],
};

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const WEEKDAY_INDEX: Readonly<Record<string, number>> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Descompone un instante en la hora de pared de una zona.
 *
 * Se usa `Intl` y no una librería porque el cálculo que necesitamos —qué hora es allí y si ese día
 * es hábil— es exactamente lo que `Intl` ya sabe hacer con la base de datos de zonas del sistema.
 * Añadir una dependencia para esto traería su propio calendario que envejece aparte.
 */
function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // `Intl` devuelve 24 para la medianoche en algunos entornos; 24:00 es 00:00 del mismo día.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAY_INDEX[String(parts.weekday)] ?? 0,
  };
}

/**
 * Convierte una hora de pared de la zona al instante UTC correspondiente.
 *
 * Se itera dos veces porque el desfase depende del instante y el instante es lo que buscamos: la
 * primera pasada usa un desfase aproximado y la segunda lo corrige. Es el mismo procedimiento que
 * usan las librerías de fechas, y sin él un cambio de horario de verano desplazaría el vencimiento
 * una hora justo el día que más se mira el SLA.
 */
function fromZonedWallClock(wall: { year: number; month: number; day: number; minuteOfDay: number }, timeZone: string): Date {
  const naiveUtc = Date.UTC(wall.year, wall.month - 1, wall.day, Math.floor(wall.minuteOfDay / 60), wall.minuteOfDay % 60, 0);
  let instant = new Date(naiveUtc);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = zonedParts(instant, timeZone);
    const observed = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const offset = observed - instant.getTime();
    instant = new Date(naiveUtc - offset);
  }
  return instant;
}

function isoDate(parts: ZonedParts): string {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function isWorkingDay(parts: ZonedParts, calendar: BusinessCalendar): boolean {
  if (!calendar.weekdays.includes(parts.weekday)) return false;
  return !calendar.holidays.includes(isoDate(parts));
}

function addDays(parts: ZonedParts, days: number, timeZone: string): ZonedParts {
  const base = Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0) + days * 86_400_000;
  const moved = new Date(base);
  return zonedParts(fromZonedWallClock(
    { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate(), minuteOfDay: 12 * 60 },
    timeZone,
  ), timeZone);
}

/**
 * Suma minutos HÁBILES a un instante y devuelve el vencimiento.
 *
 * Si el calendario es 24x7 se reduce a una suma directa. Si no, se avanza día a día consumiendo la
 * ventana laboral de cada uno: eso es lo que hace que «4 horas hábiles» pedidas un viernes a las
 * cinco de la tarde venzan el lunes por la mañana y no el sábado de madrugada, que es cuando nadie
 * va a responder y el indicador diría que se incumplió.
 *
 * El tope de 400 iteraciones existe para que un calendario mal configurado —sin ningún día hábil—
 * falle rápido y de forma visible en vez de colgar el proceso que calcula relojes.
 */
export function addBusinessMinutes(start: Date, minutes: number, calendar: BusinessCalendar | null): Date {
  if (!calendar) return new Date(start.getTime() + minutes * 60_000);

  const { timezone } = calendar;
  let remaining = minutes;
  let cursor = zonedParts(start, timezone);
  let cursorMinute = cursor.hour * 60 + cursor.minute;

  for (let iteration = 0; iteration < 400; iteration += 1) {
    if (!isWorkingDay(cursor, calendar)) {
      cursor = addDays(cursor, 1, timezone);
      cursorMinute = calendar.startMinute;
      continue;
    }
    if (cursorMinute < calendar.startMinute) cursorMinute = calendar.startMinute;
    if (cursorMinute >= calendar.endMinute) {
      cursor = addDays(cursor, 1, timezone);
      cursorMinute = calendar.startMinute;
      continue;
    }

    const available = calendar.endMinute - cursorMinute;
    if (remaining <= available) {
      return fromZonedWallClock(
        { year: cursor.year, month: cursor.month, day: cursor.day, minuteOfDay: cursorMinute + remaining },
        timezone,
      );
    }

    remaining -= available;
    cursor = addDays(cursor, 1, timezone);
    cursorMinute = calendar.startMinute;
  }

  throw new Error('SUPPORT_SLA_CALENDAR_UNRESOLVABLE: el calendario laboral no tiene días hábiles utilizables.');
}

/** Lee el calendario guardado en la política; devuelve `null` cuando el compromiso es 24x7. */
export function calendarFromPolicy(input: {
  calendarKind: string;
  timezone: string;
  businessHoursJson: Record<string, unknown> | null;
}): BusinessCalendar | null {
  if (input.calendarKind === '24x7') return null;
  const raw = input.businessHoursJson ?? {};
  return {
    timezone: input.timezone || DEFAULT_BUSINESS_CALENDAR.timezone,
    weekdays: Array.isArray(raw.weekdays) ? (raw.weekdays as number[]) : DEFAULT_BUSINESS_CALENDAR.weekdays,
    startMinute: typeof raw.startMinute === 'number' ? raw.startMinute : DEFAULT_BUSINESS_CALENDAR.startMinute,
    endMinute: typeof raw.endMinute === 'number' ? raw.endMinute : DEFAULT_BUSINESS_CALENDAR.endMinute,
    holidays: Array.isArray(raw.holidays) ? (raw.holidays as string[]) : DEFAULT_BUSINESS_CALENDAR.holidays,
  };
}
