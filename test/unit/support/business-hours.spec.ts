import { describe, expect, it } from '@jest/globals';
import { addBusinessMinutes, calendarFromPolicy, DEFAULT_BUSINESS_CALENDAR } from '../../../src/modules/support/domain/business-hours.js';

/**
 * El cálculo del vencimiento de SLA. Es donde se decide si «4 horas hábiles» pedidas un viernes por
 * la tarde vencen el sábado de madrugada —cuando nadie va a responder— o el lunes por la mañana.
 */
describe('vencimiento en horario hábil', () => {
  const calendar = DEFAULT_BUSINESS_CALENDAR; // lun-vie 08:30-18:00, America/La_Paz

  it('sin calendario (24x7) es una suma directa', () => {
    const start = new Date('2026-08-29T03:00:00.000Z'); // sábado
    expect(addBusinessMinutes(start, 60, null).toISOString()).toBe('2026-08-29T04:00:00.000Z');
  });

  it('dentro de la jornada suma los minutos tal cual', () => {
    // Lunes 31/08/2026, 10:00 en La Paz (UTC-4) = 14:00Z.
    const target = addBusinessMinutes(new Date('2026-08-31T14:00:00.000Z'), 120, calendar);
    expect(target.toISOString()).toBe('2026-08-31T16:00:00.000Z'); // 12:00 local
  });

  it('un viernes por la tarde vence el lunes por la mañana, no el sábado', () => {
    // Viernes 28/08/2026, 17:00 local = 21:00Z. Quedan 60 minutos hábiles ese día.
    const target = addBusinessMinutes(new Date('2026-08-28T21:00:00.000Z'), 240, calendar);
    const local = new Intl.DateTimeFormat('en-CA', {
      timeZone: calendar.timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(target);
    expect(local).toContain('Mon');
    // 60 minutos el viernes + 180 el lunes desde las 08:30 => 11:30 local.
    expect(local).toContain('11:30');
  });

  it('lo pedido fuera de horario empieza a contar en la apertura siguiente', () => {
    // Martes 01/09/2026 a las 03:00 local (07:00Z): la jornada abre a las 08:30.
    const target = addBusinessMinutes(new Date('2026-09-01T07:00:00.000Z'), 30, calendar);
    expect(target.toISOString()).toBe('2026-09-01T13:00:00.000Z'); // 09:00 local
  });

  it('salta los feriados declarados en la política', () => {
    const conFeriado = { ...calendar, holidays: ['2026-09-01'] };
    // Lunes 31/08 a las 17:30 local quedan 30 minutos; el martes es feriado, sigue el miércoles.
    const target = addBusinessMinutes(new Date('2026-08-31T21:30:00.000Z'), 60, conFeriado);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: calendar.timezone, weekday: 'short' }).format(target);
    expect(day).toBe('Wed');
  });

  it('falla de forma explícita si el calendario no tiene ningún día hábil', () => {
    expect(() => addBusinessMinutes(new Date(), 60, { ...calendar, weekdays: [] })).toThrow(/SUPPORT_SLA_CALENDAR_UNRESOLVABLE/);
  });
});

describe('lectura del calendario desde la política', () => {
  it('24x7 devuelve null: no hay ventana que respetar', () => {
    expect(calendarFromPolicy({ calendarKind: '24x7', timezone: 'America/La_Paz', businessHoursJson: null })).toBeNull();
  });

  it('usa los valores de la política y cae al defecto sólo en lo que falte', () => {
    const result = calendarFromPolicy({
      calendarKind: 'business_hours',
      timezone: 'America/La_Paz',
      businessHoursJson: { weekdays: [1, 2, 3], startMinute: 600 },
    });
    expect(result?.weekdays).toEqual([1, 2, 3]);
    expect(result?.startMinute).toBe(600);
    expect(result?.endMinute).toBe(DEFAULT_BUSINESS_CALENDAR.endMinute);
  });
});
