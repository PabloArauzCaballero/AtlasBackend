/**
 * @file Verifica las cifras de ritmo del alta: lo que el cronómetro distingue entre una persona y un guion.
 * @business Un bot puede traer datos correctos; no trae la irregularidad de quien teclea de verdad.
 * @system Ejercita `medirRitmo` (función pura) con bitácoras sintéticas.
 */
import { describe, expect, it } from '@jest/globals';
import {
  coeficienteDeVariacion,
  medirRitmo,
} from '../../../src/modules/customer-telemetry/application/onboarding-behavior-summary.ritmo.js';

// 14:00 UTC = 10:00 en Bolivia: fuera de la madrugada.
const BASE = Date.UTC(2026, 9, 1, 14, 0, 0);
const en = (ms: number) => new Date(BASE + ms);
const campo = (fieldCode: string, focusDurationMs: number, at = 0) => ({
  fieldCode,
  interactionType: 'desenfoque',
  usedCopyPaste: false,
  correctionCount: 0,
  focusDurationMs,
  occurredAt: en(at),
});
const toque = (at: number) => ({ control: 'continuar', screenName: 'registro', rx: 0.5, ry: 0.5, occurredAt: en(at) });
const paso = (stepCode: string, eventType: string, at: number) => ({ stepCode, eventType, payload: null, occurredAt: en(at) });

describe('medirRitmo', () => {
  it('una persona: tiempos desiguales, sin señales', () => {
    const ritmo = medirRitmo({
      pasos: [paso('captura_carnet_frente', 'abre', 0), paso('captura_carnet_frente', 'toma', 6_500)],
      campos: [
        campo('nombres', 4_200),
        campo('apellidos', 6_900),
        campo('nacimiento', 2_100),
        campo('direccion', 11_300),
        campo('ingreso', 3_000),
      ],
      toques: [0, 2_300, 9_100, 11_000, 19_500, 21_200, 33_000, 35_400, 51_000].map(toque),
    });
    expect(ritmo.senales).toEqual([]);
    expect(ritmo.cvCampos).toBeGreaterThan(0.4);
    expect(ritmo.capturaMasRapidaMs).toBe(6_500);
    expect(ritmo.horaLocalDeInicio).toBe(10);
  });

  it('un guion con esperas fijas: ritmo uniforme en campos y en toques', () => {
    const ritmo = medirRitmo({
      pasos: [],
      campos: ['nombres', 'apellidos', 'nacimiento', 'direccion', 'ingreso', 'zona'].map((c, i) => campo(c, 1_000 + (i % 2) * 20)),
      toques: Array.from({ length: 10 }, (_, i) => toque(i * 1_500)),
    });
    expect(ritmo.senales).toEqual(expect.arrayContaining(['RITMO_UNIFORME_EN_CAMPOS', 'RITMO_UNIFORME_EN_TOQUES']));
  });

  it('campos escritos más rápido de lo que se teclea, sin contar el código ni el PIN', () => {
    const ritmo = medirRitmo({
      pasos: [],
      campos: [
        campo('nombres', 40),
        campo('apellidos', 60),
        campo('documento_numero', 90),
        campo('codigo_verificacion', 10),
        campo('pin', 10),
      ],
      toques: [],
    });
    expect(ritmo.camposInstantaneos).toBe(3);
    expect(ritmo.camposMedidos).toBe(3);
    expect(ritmo.senales).toContain('CAMPOS_INSTANTANEOS');
  });

  it('dos campos instantáneos no bastan: puede ser el autocompletado del teclado', () => {
    expect(
      medirRitmo({ pasos: [], campos: [campo('nombres', 40), campo('apellidos', 60), campo('direccion', 8_000)], toques: [] }).senales,
    ).toEqual([]);
  });

  it('toques más rápidos de lo que da un dedo', () => {
    const ritmo = medirRitmo({ pasos: [], campos: [], toques: [0, 50, 100, 150, 4_000].map(toque) });
    expect(ritmo.toquesSobrehumanos).toBe(3);
    expect(ritmo.senales).toContain('TOQUES_SOBREHUMANOS');
  });

  it('cámara abierta y foto tomada sin tiempo de encuadrar; el escáner del sistema no cuenta', () => {
    expect(
      medirRitmo({ pasos: [paso('captura_selfie', 'abre', 0), paso('captura_selfie', 'toma', 400)], campos: [], toques: [] }).senales,
    ).toContain('CAPTURA_INSTANTANEA');
    const conEscaner = medirRitmo({
      pasos: [
        paso('captura_carnet_frente', 'abre', 0),
        paso('captura_carnet_frente', 'escanea', 100),
        paso('captura_carnet_frente', 'toma', 300),
      ],
      campos: [],
      toques: [],
    });
    expect(conEscaner.capturaMasRapidaMs).toBeNull();
    expect(conEscaner.senales).toEqual([]);
  });

  it('la madrugada se mide en hora de Bolivia', () => {
    // 07:00 UTC = 03:00 en Bolivia.
    const madrugada = { ...toque(0), occurredAt: new Date(Date.UTC(2026, 9, 1, 7, 0, 0)) };
    expect(medirRitmo({ pasos: [], campos: [], toques: [madrugada] }).senales).toEqual(['ALTA_DE_MADRUGADA']);
  });

  it('sin eventos no inventa nada', () => {
    const ritmo = medirRitmo({ pasos: [], campos: [], toques: [] });
    expect(ritmo).toMatchObject({
      camposMedidos: 0,
      cvCampos: null,
      cvToques: null,
      capturaMasRapidaMs: null,
      horaLocalDeInicio: null,
      senales: [],
    });
  });

  it('el coeficiente de variación exige muestras y media positiva', () => {
    expect(coeficienteDeVariacion([100, 100], 5)).toBeNull();
    expect(coeficienteDeVariacion([0, 0, 0, 0, 0], 5)).toBeNull();
    expect(coeficienteDeVariacion([100, 100, 100, 100, 100], 5)).toBe(0);
  });
});
