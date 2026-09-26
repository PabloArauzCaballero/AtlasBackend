import { describe, expect, it } from '@jest/globals';
import { createAgentProfileSchema, listCasesQuerySchema } from '../../../src/modules/support/support-case.schemas.js';

/**
 * El alta de agente es la puerta que faltaba.
 *
 * Sin perfil, TODA la consola responde 403 `SUPPORT_AGENT_PROFILE_REQUIRED`, también a un
 * administrador. Por eso lo que aquí se valida no es cosmética de formulario: `internalUserId` mal
 * formado o una capacidad absurda son las dos formas de crear un agente que después no atiende.
 */
describe('createAgentProfileSchema', () => {
  it('acepta lo mínimo y rellena los valores por defecto de la operación boliviana', () => {
    const parsed = createAgentProfileSchema.parse({ internalUserId: '12' });

    expect(parsed).toEqual({
      internalUserId: '12',
      supportLevel: 'L1',
      maxConcurrentChannels: 3,
      timezone: 'America/La_Paz',
      languageCodes: ['es'],
    });
  });

  it('rechaza un identificador que no es un entero positivo', () => {
    for (const internalUserId of ['0', '-3', 'abc', '1.5', '']) {
      expect(createAgentProfileSchema.safeParse({ internalUserId }).success).toBe(false);
    }
  });

  it('rechaza un nivel fuera del catálogo, porque la base tiene CHECK sobre esa columna', () => {
    expect(createAgentProfileSchema.safeParse({ internalUserId: '1', supportLevel: 'L3' }).success).toBe(false);
    expect(createAgentProfileSchema.safeParse({ internalUserId: '1', supportLevel: 'SPECIALIST' }).success).toBe(true);
  });

  /**
   * La capacidad no es una preferencia: de ella depende el reparto. Un agente con 50 conversaciones
   * simultáneas no atiende ninguna, y con 0 nunca recibiría una — el UPDATE de reserva exige
   * `active_channel_count < max_concurrent_channels`.
   */
  it('acota la capacidad entre 1 y 10', () => {
    expect(createAgentProfileSchema.safeParse({ internalUserId: '1', maxConcurrentChannels: 0 }).success).toBe(false);
    expect(createAgentProfileSchema.safeParse({ internalUserId: '1', maxConcurrentChannels: 11 }).success).toBe(false);
    expect(createAgentProfileSchema.parse({ internalUserId: '1', maxConcurrentChannels: 10 }).maxConcurrentChannels).toBe(10);
  });

  it('convierte la capacidad que llega como texto desde un formulario', () => {
    expect(createAgentProfileSchema.parse({ internalUserId: '1', maxConcurrentChannels: '5' }).maxConcurrentChannels).toBe(5);
  });
});

/**
 * Los filtros de la cola viajan a una subconsulta sobre `support_resolutions`. Que sean enumeraciones
 * cerradas —y no texto libre— es lo que permite construirla sin que un valor de la URL llegue al SQL.
 */
describe('listCasesQuerySchema · filtros por código', () => {
  it('acepta los códigos del catálogo', () => {
    const parsed = listCasesQuerySchema.parse({
      resolutionCode: 'NO_ISSUE_FOUND',
      rootCauseCode: 'UNKNOWN',
      caseType: 'PAYMENT_EVIDENCE',
      categoryCode: 'PAY_EVIDENCE_NOT_APPLIED',
    });

    expect(parsed.resolutionCode).toBe('NO_ISSUE_FOUND');
    expect(parsed.rootCauseCode).toBe('UNKNOWN');
    expect(parsed.caseType).toBe('PAYMENT_EVIDENCE');
    expect(parsed.categoryCode).toBe('PAY_EVIDENCE_NOT_APPLIED');
  });

  it('rechaza un código inventado en vez de pasarlo a la consulta', () => {
    expect(listCasesQuerySchema.safeParse({ resolutionCode: "X' OR '1'='1" }).success).toBe(false);
    expect(listCasesQuerySchema.safeParse({ rootCauseCode: 'DESCONOCIDA' }).success).toBe(false);
    expect(listCasesQuerySchema.safeParse({ caseType: 'CUALQUIERA' }).success).toBe(false);
  });

  it('sigue funcionando sin ningún filtro nuevo: los cuatro son opcionales', () => {
    const parsed = listCasesQuerySchema.parse({});
    expect(parsed.limit).toBe(20);
    expect(parsed.resolutionCode).toBeUndefined();
    expect(parsed.categoryCode).toBeUndefined();
  });
});
