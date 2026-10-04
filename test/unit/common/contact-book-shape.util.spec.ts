/**
 * @file Verifica la forma de la agenda: cuántos contactos, cuándo apareció el último y si parece de una persona.
 * @business Una agenda mínima, repetida, uniforme o cargada de golpe es la de un teléfono preparado para un alta falsa.
 * @system Ejercita `calcularFormaDeLaAgenda` (función pura) sobre recuentos y fechas; ninguna ficha se descifra.
 */
import { describe, expect, it } from '@jest/globals';
import { calcularFormaDeLaAgenda, type FichaObservada } from '../../../src/common/utils/contact/contact-book-shape.util.js';

const NOW = new Date('2026-10-04T12:00:00Z');
const dias = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const ficha = (i: number, extra: Partial<FichaObservada> = {}): FichaObservada => ({
  phoneHashes: [`h${i}`],
  emailCount: 0,
  isFavorite: false,
  hasBirthday: false,
  isCompany: false,
  firstSeenAt: dias(40),
  ...extra,
});
const agenda = (n: number, extra: (i: number) => Partial<FichaObservada> = () => ({})) =>
  Array.from({ length: n }, (_, i) => ficha(i, extra(i)));

describe('calcularFormaDeLaAgenda', () => {
  it('una agenda normal: desigual, con crecimiento, sin señales', () => {
    const fichas = [
      ...agenda(120, (i) => ({
        emailCount: i % 4 === 0 ? 1 : 0,
        isFavorite: i % 15 === 0,
        hasBirthday: i % 9 === 0,
        isCompany: i % 20 === 0,
      })),
      ficha(900, { firstSeenAt: dias(12) }),
      ficha(901, { firstSeenAt: dias(3) }),
    ];
    const forma = calcularFormaDeLaAgenda(fichas, NOW);
    expect(forma.total).toBe(122);
    expect(forma.firstSyncAgeDays).toBe(40);
    expect(forma.addedAfterFirstSync).toBe(2);
    expect(forma.addedLast7d).toBe(1);
    expect(forma.addedLast30d).toBe(2);
    expect(forma.daysSinceLastNewContact).toBe(3);
    expect(forma.senales).toEqual([]);
  });

  it('el día de la primera sincronización NO hay antigüedad del último contacto: todas las fichas llegan juntas', () => {
    const forma = calcularFormaDeLaAgenda(
      agenda(80, (i) => ({ firstSeenAt: dias(0), emailCount: i % 3 })),
      NOW,
    );
    expect(forma.daysSinceLastNewContact).toBeNull();
    expect(forma.addedAfterFirstSync).toBe(0);
  });

  it('agenda mínima', () => {
    expect(calcularFormaDeLaAgenda(agenda(4), NOW).senales).toEqual(['AGENDA_MINIMA']);
  });

  it('agenda hecha de repeticiones', () => {
    const forma = calcularFormaDeLaAgenda(
      agenda(40, (i) => ({ phoneHashes: [`h${i % 5}`], emailCount: 1 })),
      NOW,
    );
    expect(forma.uniquePhoneRatio).toBe(0.125);
    expect(forma.senales).toEqual(['AGENDA_REPETIDA']);
  });

  it('agenda uniforme: muchas fichas y ninguna con correo, cumpleaños, favorito ni empresa', () => {
    expect(calcularFormaDeLaAgenda(agenda(60), NOW).senales).toEqual(['AGENDA_UNIFORME']);
    expect(
      calcularFormaDeLaAgenda(
        agenda(60, (i) => ({ isFavorite: i === 0 })),
        NOW,
      ).senales,
    ).toEqual([]);
  });

  it('agenda cargada de golpe: la mayoría de las fichas aparecieron esta semana', () => {
    const fichas = [
      ...agenda(30, () => ({ emailCount: 1 })),
      ...Array.from({ length: 70 }, (_, i) => ficha(500 + i, { firstSeenAt: dias(2), emailCount: 1 })),
    ];
    expect(calcularFormaDeLaAgenda(fichas, NOW).senales).toEqual(['AGENDA_CARGADA_DE_GOLPE']);
  });

  it('sin fichas todo es «no se sabe»', () => {
    const forma = calcularFormaDeLaAgenda([], NOW);
    expect(forma).toMatchObject({ total: 0, uniquePhoneRatio: null, firstSyncAgeDays: null, daysSinceLastNewContact: null });
  });
});
