import { describe, expect, it } from '@jest/globals';
import { bandOf, toCreditLineHistoryResponse, toCreditLineResponse } from '../../../src/modules/credit/credit-line.mapper.js';
import type { CreditLineModel } from '../../../src/database/models/index.js';

/**
 * Lo que el cliente lee sobre su propio crédito.
 *
 * Este mapper es donde una decisión de riesgo se convierte en una frase que una persona lee sobre
 * sí misma, y por eso sus errores no son técnicos: le atribuyen algo que no hizo, o le esconden lo
 * único que sí puede hacer.
 *
 * La excepción de `BUREAU_SCORE_TOO_LOW` es el caso central. La frase de la política —«tu puntaje
 * crediticio no alcanza el mínimo»— afirma algo que NO es cierto de quien no tiene buró: no es que
 * su puntaje sea bajo, es que no existe, porque en Bolivia no hay buró conectado. Decirle que su
 * historial es malo cuando lo que pasa es que no hay historial le atribuye una culpa que no tiene.
 * Se sustituye SÓLO en ese cruce —código y ausencia comprobada— y no como criterio general: la
 * regla sigue siendo que manda el texto publicado y auditado de la política.
 *
 * Los pasos siguientes se derivan de lo que el motor marcó como AUSENTE y no de una lista fija:
 * recomendarle «sube tu extracto» a quien ya lo subió es ruido, y peor —le dice que el sistema no
 * mira lo que él hizo—. Y el paso del extracto se decide por la EVIDENCIA de la capacidad y no por
 * un contador que llega a cero con cualquier extracto, incluido uno rechazado: con la comprobación
 * anterior, quien subía un documento inservible dejaba de que se lo pidieran y se quedaba con un
 * límite estimado sobre lo declarado sin que nadie le dijera que faltaba el paso más importante.
 *
 * Un código sin traducir se enseña TAL CUAL y no se oculta: un motivo feo es mejor que un motivo
 * escondido, y la normativa de crédito justo obliga a comunicar los motivos adversos.
 */
function linea(overrides: Record<string, unknown> = {}): CreditLineModel {
  return {
    customerId: 42,
    currencyCode: 'BOB',
    approvedLimit: '2000.00',
    maxAffordableInstallment: '350.00',
    disposableIncome: '900.00',
    scoring: 720,
    riskBand: 'B',
    pricingTier: 'T2',
    annualPercentageRate: '0.24',
    affordabilityScore: 65,
    affordabilityDecision: 'ELIGIBLE',
    probabilityOfDefault: '0.07',
    recommendedLimit: '3500.00',
    relationshipScore: 40,
    relationshipTier: 'EN_CONSTRUCCION',
    capacityBinding: 'RELACION',
    capacityEvidence: 'EXTRACTO',
    decisionOutcome: 'APPROVED',
    decisionExecutionId: 'exe-1',
    artifactCode: 'CREDIT_LINE',
    artifactVersionId: 'v3',
    calculationTrigger: 'bank_statement',
    validFrom: new Date('2026-09-01T10:00:00Z'),
    validUntil: null,
    reasonCodesJson: [],
    provenanceJson: {},
    ...overrides,
  } as unknown as CreditLineModel;
}

describe('credit-line.mapper', () => {
  describe('el tramo del puntaje', () => {
    it('cada corte cae en su tramo, y el borde pertenece al tramo de arriba', () => {
      expect(bandOf(850).code).toBe('excelente');
      expect(bandOf(800).code).toBe('excelente');
      expect(bandOf(799).code).toBe('muy_bueno');
      expect(bandOf(700).code).toBe('muy_bueno');
      expect(bandOf(650).code).toBe('bueno');
      expect(bandOf(500).code).toBe('regular');
      expect(bandOf(100).code).toBe('inicial');
    });

    it('sin puntaje se cae al tramo inicial y no a un tramo vacío', () => {
      expect(bandOf(null)).toEqual({ code: 'inicial', label: 'En construcción', tone: 'danger' });
    });

    it('el tramo lleva tono: un número solo no dice si es bueno', () => {
      expect(bandOf(720).tone).toBe('success');
      expect(bandOf(500).tone).toBe('warning');
    });
  });

  describe('la respuesta al cliente', () => {
    it('el disponible lo calcula el SERVIDOR, redondeado, y nunca es negativo', () => {
      const dto = toCreditLineResponse(linea({ approvedLimit: '2000.00' }), 1999.994);

      expect(dto.used).toBe(1999.99);
      expect(dto.available).toBe(0.01);

      const excedido = toCreditLineResponse(linea({ approvedLimit: '2000.00' }), 2500);
      expect(excedido.available).toBe(0);
    });

    it('sin gasto informado el disponible es el límite entero', () => {
      const dto = toCreditLineResponse(linea());

      expect(dto.used).toBe(0);
      expect(dto.available).toBe(2000);
    });

    it('la escala completa viaja con la respuesta: la app no la lleva escrita dentro', () => {
      const dto = toCreditLineResponse(linea());

      expect(dto.scoringScale.min).toBe(0);
      expect(dto.scoringScale.max).toBe(1000);
      expect(dto.scoringScale.bands.length).toBeGreaterThan(0);
      expect(dto.scoringBand.code).toBe('muy_bueno');
    });

    it('los importes ausentes llegan nulos y no como cero: «no se midió» no es «cero»', () => {
      const dto = toCreditLineResponse(
        linea({
          maxAffordableInstallment: null,
          disposableIncome: null,
          annualPercentageRate: null,
          probabilityOfDefault: null,
          recommendedLimit: null,
        }),
      );

      expect(dto.maxAffordableInstallment).toBeNull();
      expect(dto.disposableIncome).toBeNull();
      expect(dto.annualPercentageRate).toBeNull();
      expect(dto.probabilityOfDefault).toBeNull();
      expect(dto.capacity.recommendedLimit).toBeNull();
    });

    it('la capacidad medida viaja JUNTO al límite aprobado: la diferencia es información del cliente', () => {
      const dto = toCreditLineResponse(linea({ approvedLimit: '2000.00', recommendedLimit: '3500.00' }));

      expect(dto.approvedLimit).toBe(2000);
      expect(dto.capacity.recommendedLimit).toBe(3500);
      expect(dto.capacity.bindingConstraint).toBe('RELACION');
      expect(dto.capacity.explanation).toContain('sube tu tramo');
    });

    it('cada techo tiene su explicación, y una desconocida no inventa texto', () => {
      for (const techo of ['CAPACIDAD', 'RELACION', 'GRADUACION', 'PRODUCTO', 'SIN_CAPACIDAD']) {
        expect(toCreditLineResponse(linea({ capacityBinding: techo })).capacity.explanation).toBeTruthy();
      }

      expect(toCreditLineResponse(linea({ capacityBinding: 'ALGO_NUEVO' })).capacity.explanation).toBeNull();
      expect(toCreditLineResponse(linea({ capacityBinding: null })).capacity.explanation).toBeNull();
    });

    it('la procedencia de cada variable va al cliente: es la diferencia entre «tu buró es malo» y «aquí no hay buró»', () => {
      const dto = toCreditLineResponse(linea({ provenanceJson: { bureau_score: 'ausente', income: 'declarado' } }));

      expect(dto.inputs).toEqual({ bureau_score: 'ausente', income: 'declarado' });
    });

    it('la decisión lleva la ejecución y la versión del artefacto que la autorizó', () => {
      const dto = toCreditLineResponse(linea());

      expect(dto.decision).toMatchObject({ executionId: 'exe-1', artifactVersionId: 'v3', trigger: 'bank_statement' });
    });
  });

  describe('los motivos', () => {
    it('manda el texto de la POLÍTICA: es el que se publicó y se audita', () => {
      const dto = toCreditLineResponse(
        linea({
          reasonCodesJson: [{ code: 'AFF_RATIO', message: 'Texto exacto de la política vigente.', adverseAction: true, category: 'AFF' }],
        }),
      );

      expect(dto.reasons[0]).toEqual({
        code: 'AFF_RATIO',
        message: 'Texto exacto de la política vigente.',
        category: 'AFF',
        adverseAction: true,
      });
    });

    it('sin texto de política se traduce el código con la copia del producto', () => {
      const dto = toCreditLineResponse(linea({ reasonCodesJson: [{ code: 'AFF_NSF' }] }));

      expect(dto.reasons[0].message).toContain('fondos insuficientes');
    });

    it('un código sin traducir se enseña TAL CUAL: un motivo escondido deja al cliente sin saber qué pasó', () => {
      const dto = toCreditLineResponse(linea({ reasonCodesJson: [{ code: 'REGLA_NUEVA_42' }] }));

      expect(dto.reasons[0].message).toBe('REGLA_NUEVA_42');
    });

    it('un motivo sin código no se pierde: se declara desconocido', () => {
      const dto = toCreditLineResponse(linea({ reasonCodesJson: [{ message: 'algo pasó' }] }));

      expect(dto.reasons[0].code).toBe('DESCONOCIDO');
      expect(dto.reasons[0].message).toBe('algo pasó');
    });

    it('`adverseAction` sólo es cierto si viene explícito: no se deduce', () => {
      const dto = toCreditLineResponse(
        linea({ reasonCodesJson: [{ code: 'A' }, { code: 'B', adverseAction: 'sí' }, { code: 'C', adverseAction: true }] }),
      );

      expect(dto.reasons.map((r) => r.adverseAction)).toEqual([false, false, true]);
    });

    it('con el buró AUSENTE se sustituye la frase de la política: no es que su puntaje sea bajo, es que no existe', () => {
      const dto = toCreditLineResponse(
        linea({
          provenanceJson: { bureau_score: 'ausente' },
          reasonCodesJson: [{ code: 'BUREAU_SCORE_TOO_LOW', message: 'Tu puntaje crediticio no alcanza el mínimo requerido.' }],
        }),
      );

      expect(dto.reasons[0].message).toContain('Todavía no tenemos historial');
      expect(dto.reasons[0].message).not.toContain('no alcanza el mínimo');
    });

    it('con el buró PRESENTE manda la política otra vez: la excepción es de ese cruce, no del código', () => {
      const dto = toCreditLineResponse(
        linea({
          provenanceJson: { bureau_score: 'motor' },
          reasonCodesJson: [{ code: 'BUREAU_SCORE_TOO_LOW', message: 'Tu puntaje crediticio no alcanza el mínimo requerido.' }],
        }),
      );

      expect(dto.reasons[0].message).toBe('Tu puntaje crediticio no alcanza el mínimo requerido.');
    });

    it('sin motivos la lista sale vacía y no nula', () => {
      expect(toCreditLineResponse(linea({ reasonCodesJson: null })).reasons).toEqual([]);
    });
  });

  describe('qué puede hacer el cliente', () => {
    it('a quien NO tiene evidencia de extracto se le pide el extracto', () => {
      const dto = toCreditLineResponse(linea({ capacityEvidence: 'DECLARADO', capacityBinding: 'CAPACIDAD' }));

      expect(dto.nextSteps.map((p) => p.code)).toContain('extracto');
    });

    it('a quien YA lo entregó no se le vuelve a pedir: decirlo sería negar lo que hizo', () => {
      const dto = toCreditLineResponse(linea({ capacityEvidence: 'EXTRACTO', capacityBinding: 'CAPACIDAD' }));

      expect(dto.nextSteps.map((p) => p.code)).not.toContain('extracto');
    });

    it('cuando lo que frena es la RELACIÓN se dice que su extracto ya soporta más', () => {
      for (const techo of ['RELACION', 'GRADUACION']) {
        const dto = toCreditLineResponse(linea({ capacityBinding: techo }));
        expect(dto.nextSteps.map((p) => p.code)).toContain('relacion');
      }

      const porCapacidad = toCreditLineResponse(linea({ capacityBinding: 'CAPACIDAD' }));
      expect(porCapacidad.nextSteps.map((p) => p.code)).not.toContain('relacion');
    });

    it('la antigüedad laboral se pide sólo si el motor la marcó ausente', () => {
      const ausente = toCreditLineResponse(linea({ provenanceJson: { income_stability_score: 'ausente' } }));
      expect(ausente.nextSteps.map((p) => p.code)).toContain('antiguedad');

      const presente = toCreditLineResponse(linea({ provenanceJson: { income_stability_score: 'motor' } }));
      expect(presente.nextSteps.map((p) => p.code)).not.toContain('antiguedad');
    });

    it('el paso del historial NO pide subir nada, y su texto lo dice', () => {
      const dto = toCreditLineResponse(linea({ provenanceJson: { bureau_score: 'ausente' } }));
      const paso = dto.nextSteps.find((p) => p.code === 'historial');

      expect(paso?.detail).toContain('No tienes que subir nada');
    });

    it('sin nada ausente y con el extracto entregado no se inventan consejos', () => {
      const dto = toCreditLineResponse(linea({ capacityEvidence: 'EXTRACTO', capacityBinding: 'CAPACIDAD', provenanceJson: {} }));

      expect(dto.nextSteps).toEqual([]);
    });

    it('sin procedencia registrada no se asume ausencia de nada', () => {
      const dto = toCreditLineResponse(linea({ capacityEvidence: 'EXTRACTO', capacityBinding: 'PRODUCTO', provenanceJson: null }));

      expect(dto.nextSteps).toEqual([]);
    });
  });

  describe('el historial de la línea', () => {
    it('cada corte lleva su tramo ya resuelto y qué lo movió', () => {
      const { items } = toCreditLineHistoryResponse([
        linea({ approvedLimit: '1000.00', scoring: 500, calculationTrigger: 'onboarding' }),
        linea({ approvedLimit: '2000.00', scoring: 720, calculationTrigger: 'bank_statement' }),
      ]);

      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ approvedLimit: 1000, trigger: 'onboarding' });
      expect(items[0].scoringBand.code).toBe('regular');
      expect(items[1].scoringBand.code).toBe('muy_bueno');
    });

    it('un historial vacío no falla', () => {
      expect(toCreditLineHistoryResponse([])).toEqual({ items: [] });
    });
  });
});
