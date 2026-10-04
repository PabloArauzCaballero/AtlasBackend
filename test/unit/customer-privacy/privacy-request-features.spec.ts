import { describe, expect, it } from '@jest/globals';
import {
  CAMPO_DEL_MOTOR,
  esDecidiblePorElMotor,
  type HechosDeLaCuenta,
  variablesDeLaSolicitud,
} from '../../../src/modules/customer-privacy/application/privacy-request-features.js';
import { RECTIFICATION_FIELDS } from '../../../src/modules/customer-privacy/data-subject-request.content.js';

/**
 * Las 17 entradas de `PRIVACIDAD_SOLICITUD_TITULAR` (AtlasDecisionEngineBackend,
 * `scripts/lib/privacidad-solicitud-titular.definicion.json`). Si el artefacto cambia una, esta lista y el Motor tienen
 * que cambiar a la vez: una variable de más el Motor la ignora y una de menos hace fallar cada ejecución.
 */
const ENTRADAS_DEL_ARTEFACTO = [
  'dsr_tipo',
  'dsr_cuenta_operativa',
  'dsr_identidad_verificada',
  'dsr_pin_confirmado',
  'dsr_contacto_cambiado_7d',
  'dsr_dispositivo_nuevo_7d',
  'dsr_fraude_abierto',
  'dsr_caso_abierto',
  'dsr_solicitudes_iguales_abiertas',
  'dsr_saldo_pendiente',
  'dsr_prestamos_activos',
  'dsr_cuotas_en_mora',
  'dsr_pagos_en_conciliacion',
  'dsr_tuvo_credito',
  'dsr_extracto_en_revision',
  'dsr_campo',
  'dsr_cambios_del_campo_365d',
];

const hechos = (cambios: Partial<HechosDeLaCuenta> = {}): HechosDeLaCuenta => ({
  lifecycleStatus: 'active',
  identidadVerificada: true,
  contactoCambiado7d: false,
  dispositivoNuevo7d: false,
  fraudeAbierto: false,
  casoAbierto: false,
  solicitudesIgualesAbiertas: 0,
  saldoPendiente: 0,
  prestamosActivos: 0,
  cuotasEnMora: 0,
  pagosEnConciliacion: 0,
  tuvoCredito: false,
  extractoEnRevision: false,
  cambiosDelCampo365d: 0,
  ...cambios,
});

const pin = new Date('2026-10-04T12:00:00Z');

describe('variablesDeLaSolicitud', () => {
  it('manda exactamente las 17 entradas del artefacto, ni una más', () => {
    const variables = variablesDeLaSolicitud({ requestType: 'deletion', rectificationField: null, pinVerifiedAt: pin }, hechos());
    expect(Object.keys(variables).sort()).toEqual([...ENTRADAS_DEL_ARTEFACTO].sort());
  });

  it('ninguna variable es texto libre: booleanos, números o códigos', () => {
    const variables = variablesDeLaSolicitud({ requestType: 'rectification', rectificationField: 'zone', pinVerifiedAt: pin }, hechos());
    for (const [codigo, valor] of Object.entries(variables)) {
      if (typeof valor === 'string') expect({ codigo, valor }).toEqual({ codigo, valor: expect.stringMatching(/^[A-Z_]+$/) });
    }
  });

  it('cada dato corregible de Atlas tiene su código en el Motor', () => {
    for (const campo of RECTIFICATION_FIELDS) expect(CAMPO_DEL_MOTOR[campo]).toBeDefined();
  });

  it('un borrado viaja con NINGUNO y sin contar correcciones', () => {
    const variables = variablesDeLaSolicitud(
      { requestType: 'deletion', rectificationField: null, pinVerifiedAt: pin },
      hechos({ cambiosDelCampo365d: 4 }),
    );
    expect(variables).toMatchObject({ dsr_tipo: 'BORRADO', dsr_campo: 'NINGUNO', dsr_cambios_del_campo_365d: 0 });
  });

  it('una corrección traduce el campo al vocabulario del Motor', () => {
    const variables = variablesDeLaSolicitud(
      { requestType: 'rectification', rectificationField: 'declared_income', pinVerifiedAt: pin },
      hechos({ cambiosDelCampo365d: 2 }),
    );
    expect(variables).toMatchObject({ dsr_tipo: 'RECTIFICACION', dsr_campo: 'INGRESO_DECLARADO', dsr_cambios_del_campo_365d: 2 });
  });

  it('una corrección sin campo (app vieja, sólo texto) viaja como OTRO: la mira una persona', () => {
    const variables = variablesDeLaSolicitud({ requestType: 'rectification', rectificationField: null, pinVerifiedAt: pin }, hechos());
    expect(variables.dsr_campo).toBe('OTRO');
  });

  it('sin constancia de PIN, dsr_pin_confirmado es falso', () => {
    const variables = variablesDeLaSolicitud({ requestType: 'deletion', rectificationField: null, pinVerifiedAt: null }, hechos());
    expect(variables.dsr_pin_confirmado).toBe(false);
  });

  it.each([
    ['active', true],
    ['onboarding_in_progress', true],
    ['registered', true],
    ['under_review', true],
    ['observed', false],
    ['suspended', false],
    ['blocked', false],
    ['closed', false],
    [null, false],
  ])('cuenta en estado %s → operativa %s', (estado, operativa) => {
    const variables = variablesDeLaSolicitud(
      { requestType: 'deletion', rectificationField: null, pinVerifiedAt: pin },
      hechos({ lifecycleStatus: estado }),
    );
    expect(variables.dsr_cuenta_operativa).toBe(operativa);
  });

  it('el saldo va en céntimos y nunca negativo', () => {
    const suma = variablesDeLaSolicitud(
      { requestType: 'deletion', rectificationField: null, pinVerifiedAt: pin },
      hechos({ saldoPendiente: 0.1 + 0.2 }),
    );
    expect(suma.dsr_saldo_pendiente).toBe(0.3);
    const negativo = variablesDeLaSolicitud(
      { requestType: 'deletion', rectificationField: null, pinVerifiedAt: pin },
      hechos({ saldoPendiente: -5 }),
    );
    expect(negativo.dsr_saldo_pendiente).toBe(0);
  });

  it('las solicitudes históricas (acceso, portabilidad…) no las decide el Motor', () => {
    expect(esDecidiblePorElMotor('rectification')).toBe(true);
    expect(esDecidiblePorElMotor('deletion')).toBe(true);
    for (const tipo of ['access', 'portability', 'restriction', 'revocation', null]) expect(esDecidiblePorElMotor(tipo)).toBe(false);
    expect(() => variablesDeLaSolicitud({ requestType: 'access', rectificationField: null, pinVerifiedAt: pin }, hechos())).toThrow(
      'access',
    );
  });
});
