import { describe, expect, it } from '@jest/globals';
import {
  calcularResumen,
  VERSION_DEL_CALCULO,
  type CampoObservado,
  type EntradasDelResumen,
  type PasoObservado,
  type ToqueObservado,
} from '../../../src/modules/customer-telemetry/application/onboarding-behavior-summary.calculo.js';

/**
 * El cálculo del resumen de comportamiento, con flujos sintéticos de tabla.
 *
 * Lo que fija cada caso es un VALOR, no que «pase»: un humano típico da un puntaje bajo con las
 * cifras que se ven; un guion da alto y con las señales nombradas; un alta interrumpida por segundo
 * plano descuenta ese tiempo; y un flujo sin eventos produce `null`, nunca cero.
 */
const T0 = Date.UTC(2026, 8, 18, 3, 0, 0);
const en = (ms: number) => new Date(T0 + ms);

function paso(stepCode: string, eventType: string, ms: number, payload: Record<string, unknown> | null = null): PasoObservado {
  return { stepCode, eventType, payload, occurredAt: en(ms) };
}
function campo(fieldCode: string, interactionType: string, ms: number, extra: Partial<CampoObservado> = {}): CampoObservado {
  return { fieldCode, interactionType, usedCopyPaste: null, correctionCount: null, focusDurationMs: null, occurredAt: en(ms), ...extra };
}
function toque(control: string, rx: number, ry: number, ms: number): ToqueObservado {
  return { control, screenName: 'registro', rx, ry, occurredAt: en(ms) };
}

/** Un alta humana: cuatro minutos, correcciones, toques que varían. */
function humano(): EntradasDelResumen {
  return {
    pasos: [
      paso('flujo', 'inicio', 0),
      paso('registro', 'enter', 1_000),
      paso('registro', 'submit_ok', 60_000, { latencyMs: 300 }),
      paso('registro', 'leave', 61_000, { sinceEnterMs: 60_000 }),
      paso('identidad', 'enter', 62_000),
      paso('captura_carnet_frente', 'abre', 70_000),
      paso('captura_carnet_frente', 'toma', 80_000),
      paso('identidad', 'submit_ok', 150_000, { latencyMs: 900 }),
      paso('identidad', 'leave', 151_000, { sinceEnterMs: 89_000 }),
      paso('perfil', 'enter', 152_000),
      paso('perfil', 'leave', 240_000, { sinceEnterMs: 88_000 }),
    ],
    campos: [
      campo('telefono', 'foco', 2_000),
      campo('telefono', 'desenfoque', 12_000, { correctionCount: 1, focusDurationMs: 10_000 }),
      campo('correo', 'foco', 13_000),
      campo('correo', 'correccion', 20_000),
      campo('correo', 'desenfoque', 25_000, { correctionCount: 2, focusDurationMs: 12_000 }),
      campo('pin', 'foco', 26_000),
      campo('pin', 'completo', 30_000),
      campo('pin', 'desenfoque', 31_000, { correctionCount: 0, focusDurationMs: 5_000 }),
      campo('documento_numero', 'foco', 100_000),
      campo('documento_numero', 'desenfoque', 110_000, { correctionCount: 1, focusDurationMs: 10_000 }),
      campo('ocr_nombres', 'foco', 160_000),
      campo('ocr_nombres', 'correccion', 165_000),
      campo('ocr_nombres', 'desenfoque', 170_000, { correctionCount: 1, focusDurationMs: 10_000 }),
    ],
    toques: [
      toque('continuar', 0.41, 0.52, 59_000),
      toque('continuar', 0.55, 0.47, 149_000),
      toque('continuar', 0.38, 0.61, 239_000),
      toque('continuar', 0.62, 0.44, 300_000),
    ],
    permisos: [{ granted: true }, { granted: false }],
    abandonosPrevios: 0,
  };
}

describe('calcularResumen', () => {
  it('un alta humana: tiempo real, fases, correcciones y puntaje bajo', () => {
    const r = calcularResumen(humano());
    expect(r.disponible).toBe(true);
    expect(r.completionTimeSeconds).toBe(300);
    expect(r.computationVersion).toBe(VERSION_DEL_CALCULO);
    expect(r.interScreenTimingJson.pantallas['registro']).toEqual({ entradas: 1, totalMs: 60_000, medianaMs: 60_000, atras: 0 });
    expect(r.interScreenTimingJson.detalle.porFaseMs).toEqual({
      contacto: 60_000,
      identidad: 177_000,
      situacion: 0,
      habitos: 0,
      cierre: 0,
    });
    expect(r.interScreenTimingJson.detalle.faseIdentidadMs).toBe(177_000);
    expect(r.interScreenTimingJson.detalle.correccionesTotales).toBe(5);
    expect(r.interScreenTimingJson.detalle.correccionesSobreOcr).toBe(1);
    expect(r.interScreenTimingJson.detalle.camposConFoco).toBe(5);
    expect(r.ciCopyPasteDetected).toBe(false);
    expect(r.formErrorRate).toBe(0);
    expect(r.permissionGrantScore).toBe(0.5);
    expect(r.botLikelihoodScore).toBe(0);
    expect(r.interScreenTimingJson.detalle.senales).toEqual([]);
  });

  it('un guion: pegado en carnet, cero correcciones, toques clavados y 40 segundos → puntaje alto con las señales nombradas', () => {
    const campos: CampoObservado[] = [];
    const nombres = ['telefono', 'correo', 'documento_numero', 'nombres', 'apellidos', 'nacimiento', 'ingreso', 'gastos', 'direccion'];
    nombres.forEach((f, i) => {
      campos.push(campo(f, 'foco', i * 3_000));
      campos.push(campo(f, 'pegado', i * 3_000 + 500, { usedCopyPaste: true }));
      campos.push(campo(f, 'desenfoque', i * 3_000 + 1_000, { correctionCount: 0, focusDurationMs: 1_000 }));
    });
    const r = calcularResumen({
      pasos: [
        paso('flujo', 'inicio', 0),
        paso('registro', 'enter', 100),
        paso('registro', 'submit_ok', 39_000),
        paso('registro', 'leave', 40_000, { sinceEnterMs: 39_900 }),
      ],
      campos,
      toques: [
        toque('continuar', 0.5, 0.5, 1_000),
        toque('continuar', 0.5, 0.5, 2_000),
        toque('continuar', 0.51, 0.5, 3_000),
        toque('continuar', 0.5, 0.49, 4_000),
      ],
      permisos: [],
      abandonosPrevios: 3,
    });
    expect(r.completionTimeSeconds).toBe(40);
    expect(r.ciCopyPasteDetected).toBe(true);
    expect(r.abandonmentCountPrior).toBe(3);
    expect(r.permissionGrantScore).toBeNull();
    expect(r.botLikelihoodScore).toBe(1);
    expect(r.interScreenTimingJson.detalle.senales).toEqual([
      'SIN_CORRECCIONES',
      'TOQUES_SIN_VARIACION',
      'ALTA_RELAMPAGO',
      'PEGADO_EN_IDENTIDAD',
    ]);
    expect(r.interScreenTimingJson.detalle.pegadosEnIdentidad).toBe(4);
  });

  it('el segundo plano se descuenta del tiempo total y la captura interrumpida queda señalada', () => {
    const r = calcularResumen({
      pasos: [
        paso('flujo', 'inicio', 0),
        paso('identidad', 'enter', 1_000),
        paso('captura_selfie', 'abre', 5_000),
        paso('captura_selfie', 'segundo_plano', 6_000),
        paso('flujo', 'segundo_plano', 6_000),
        paso('flujo', 'primer_plano', 126_000),
        paso('captura_selfie', 'toma', 130_000),
        paso('captura_selfie', 'abre', 131_000),
        paso('captura_selfie', 'repite', 140_000),
        paso('identidad', 'submit_error', 150_000, { code: 'IDENTITY_IMAGE_TOO_LARGE' }),
        paso('identidad', 'validation_error', 151_000, { code: 'vencido' }),
        paso('identidad', 'submit_ok', 160_000),
      ],
      campos: [campo('documento_numero', 'foco', 2_000), campo('documento_numero', 'desenfoque', 4_000, { correctionCount: 0 })],
      toques: [],
      permisos: [{ granted: null }],
      abandonosPrevios: 1,
    });
    // 160 s de reloj − 120 s en segundo plano.
    expect(r.completionTimeSeconds).toBe(40);
    expect(r.interScreenTimingJson.detalle.segundosEnSegundoPlano).toBe(120);
    expect(r.interScreenTimingJson.detalle.segundoPlanoDuranteCaptura).toBe(true);
    expect(r.interScreenTimingJson.detalle.capturasRepetidas).toBe(1);
    // (1 error de envío + 1 de validación) / (1 ok + 1 error)
    expect(r.formErrorRate).toBe(1);
    expect(r.permissionGrantScore).toBeNull();
    expect(r.interScreenTimingJson.detalle.senales).toContain('CAPTURA_INTERRUMPIDA');
    // Un solo campo con foco: la regla de «sin correcciones» exige ocho, así que no suma.
    expect(r.interScreenTimingJson.detalle.senales).not.toContain('SIN_CORRECCIONES');
    expect(r.botLikelihoodScore).toBe(0.25);
  });

  it('la pantalla abierta (sin leave) cuenta hasta el último reloj: la fase de identidad no llega en 0 al Motor', () => {
    // Lo que ve el servidor al calcular el resumen DENTRO del envío del carnet: el `leave` de
    // «identidad» todavía no ha salido de la app.
    const r = calcularResumen({
      pasos: [
        paso('flujo', 'inicio', 0, { elapsedMs: 0 }),
        paso('registro', 'enter', 500, { elapsedMs: 500 }),
        paso('registro', 'leave', 3_000, { elapsedMs: 3_000, sinceEnterMs: 2_500 }),
        paso('identidad', 'enter', 14_000, { elapsedMs: 14_000 }),
        paso('captura_carnet_frente', 'toma', 16_000, { elapsedMs: 16_000 }),
        paso('identidad', 'submit_ok', 27_800, { elapsedMs: 27_800, latencyMs: 600 }),
      ],
      campos: [],
      toques: [],
      permisos: [],
      abandonosPrevios: 0,
    });
    expect(r.interScreenTimingJson.detalle.porFaseMs.contacto).toBe(2_500);
    expect(r.interScreenTimingJson.detalle.porFaseMs.identidad).toBe(13_800);
    expect(r.interScreenTimingJson.detalle.faseIdentidadMs).toBe(13_800);
    expect(r.interScreenTimingJson.pantallas['identidad']?.totalMs).toBe(13_800);
  });

  it('sin eventos de la app todo es null, no cero, y `disponible` es false', () => {
    const r = calcularResumen({ pasos: [], campos: [], toques: [], permisos: [{ granted: true }], abandonosPrevios: 2 });
    expect(r.disponible).toBe(false);
    expect(r.completionTimeSeconds).toBeNull();
    expect(r.botLikelihoodScore).toBeNull();
    expect(r.ciCopyPasteDetected).toBeNull();
    expect(r.formErrorRate).toBeNull();
    expect(r.abandonmentCountPrior).toBe(2);
    // Los permisos sí se miden: los escribe la sesión, no la bitácora.
    expect(r.permissionGrantScore).toBe(1);
  });

  it('los pasos que escribe el propio servidor (sin fase) no cuentan como pantallas', () => {
    const r = calcularResumen({
      pasos: [
        paso('contact_verification_requested', 'telemetry', 0),
        paso('onboarding_submitted', 'completed', 5_000, { completionPercentage: 100 }),
      ],
      campos: [],
      toques: [],
      permisos: [],
      abandonosPrevios: 0,
    });
    expect(r.disponible).toBe(true);
    expect(r.interScreenTimingJson.pantallas).toEqual({});
    expect(r.completionTimeSeconds).toBe(5);
  });

  it('los pegados en el codigo de verificacion o en campos que no son de identidad no marcan `ciCopyPasteDetected`', () => {
    const r = calcularResumen({
      pasos: [paso('flujo', 'inicio', 0)],
      campos: [
        campo('codigo_verificacion', 'pegado', 1_000, { usedCopyPaste: true }),
        campo('direccion', 'pegado', 2_000, { usedCopyPaste: true }),
      ],
      toques: [],
      permisos: [],
      abandonosPrevios: 0,
    });
    expect(r.ciCopyPasteDetected).toBe(false);
    expect(r.interScreenTimingJson.detalle.pegadosEnIdentidad).toBe(0);
  });
});
