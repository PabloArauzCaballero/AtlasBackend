import { describe, expect, it, jest } from '@jest/globals';
import { Op } from 'sequelize';
import { RiskPolicyRepository } from '../../../src/modules/risk/repositories/risk-policy.repository.js';

/**
 * `RiskPolicyRepository` carga la política de crédito vigente. Lo que fija este spec es el CONTRATO
 * de la consulta, porque cada cláusula existe por una razón que no se ve leyendo el resultado:
 * respetar la ventana de vigencia, admitir rulesets globales (`assessmentType: null`) y desempatar
 * hacia la versión más reciente cuando hay varias activas.
 *
 * Un error aquí no produce una excepción: produce decisiones de crédito tomadas con la política
 * equivocada, que es un fallo silencioso y auditable meses después.
 */
describe('RiskPolicyRepository', () => {
  const now = new Date('2026-07-31T12:00:00Z');

  function build(version: unknown = null, rules: unknown[] = []) {
    const rulesetModel = { findOne: jest.fn(async (..._args: unknown[]) => version) };
    const ruleModel = { findAll: jest.fn(async (..._args: unknown[]) => rules) };
    return { repository: new RiskPolicyRepository(rulesetModel as never, ruleModel as never), rulesetModel, ruleModel };
  }

  it('sin ruleset activo devuelve null y NO consulta reglas', async () => {
    const { repository, ruleModel } = build(null);

    await expect(repository.findActiveRuleset('onboarding', now)).resolves.toBeNull();
    expect(ruleModel.findAll).not.toHaveBeenCalled();
  });

  describe('contrato de la consulta', () => {
    it('exige status active y respeta la ventana de vigencia por ambos extremos', async () => {
      const { repository, rulesetModel } = build(null);

      await repository.findActiveRuleset('onboarding', now);

      const where = (rulesetModel.findOne as jest.Mock).mock.calls[0][0] as {
        where: { status: string } & Record<symbol, unknown[]>;
      };
      expect(where.where.status).toBe('active');
      const conditions = where.where[Op.and] as Array<Record<symbol, unknown[]>>;
      expect(conditions).toHaveLength(3);
    });

    it('admite rulesets globales (assessmentType null) además del específico', async () => {
      const { repository, rulesetModel } = build(null);

      await repository.findActiveRuleset('onboarding', now);

      const where = (rulesetModel.findOne as jest.Mock).mock.calls[0][0] as { where: Record<symbol, unknown[]> };
      const [byType] = where.where[Op.and] as Array<Record<symbol, unknown[]>>;
      expect(byType[Op.or]).toEqual([{ assessmentType: null }, { assessmentType: 'onboarding' }]);
    });

    it('ante varias versiones activas gana la más reciente: la que riesgo aprobó por última vez', async () => {
      const { repository, rulesetModel } = build(null);

      await repository.findActiveRuleset('onboarding', now);

      const options = (rulesetModel.findOne as jest.Mock).mock.calls[0][0] as { order: [string, string][] };
      expect(options.order).toEqual([
        ['effectiveFrom', 'DESC'],
        ['id', 'DESC'],
      ]);
    });

    it('las reglas se piden por versión y en orden estable', async () => {
      const { repository, ruleModel } = build({ id: 7, rulesetCode: 'bnpl', versionCode: 'v2' });

      await repository.findActiveRuleset('onboarding', now);

      const options = (ruleModel.findAll as jest.Mock).mock.calls[0][0] as {
        where: { rulesetVersionId: number };
        order: [string, string][];
      };
      expect(options.where.rulesetVersionId).toBe(7);
      expect(options.order).toEqual([['id', 'ASC']]);
    });
  });

  describe('mapeo del resultado', () => {
    const version = { id: 7, rulesetCode: 'bnpl', versionCode: 'v2' };

    it('traduce cada fila a la forma que espera el evaluador', async () => {
      const { repository } = build(version, [
        {
          ruleCode: 'score_below_threshold',
          ruleName: 'Score insuficiente',
          riskDimension: 'overall',
          severity: 'high',
          actionCode: 'manual_review_required',
          reasonCode: 'score_below_threshold',
          isHardStop: true,
          expressionJson: { all: [{ field: 'totalScore', lt: 65 }] },
        },
      ]);

      const ruleset = await repository.findActiveRuleset('onboarding', now);

      expect(ruleset).toMatchObject({ rulesetVersionId: '7', rulesetCode: 'bnpl', versionCode: 'v2' });
      expect(ruleset?.rules[0]).toMatchObject({
        ruleCode: 'score_below_threshold',
        isHardStop: true,
        expression: { all: [{ field: 'totalScore', lt: 65 }] },
      });
    });

    /** Una regla sin código no es evaluable ni explicable: descartarla es preferible a propagarla. */
    it('descarta las reglas sin ruleCode en vez de propagar una regla anónima', async () => {
      const { repository } = build(version, [{ ruleCode: 'ok', expressionJson: {} }, { ruleCode: null, expressionJson: {} }, {}]);

      const ruleset = await repository.findActiveRuleset('onboarding', now);

      expect(ruleset?.rules.map((rule) => rule.ruleCode)).toEqual(['ok']);
    });

    it('un ruleset sin código o sin versión se reporta como "unknown", nunca como undefined', async () => {
      const { repository } = build({ id: 7, rulesetCode: null, versionCode: null });

      const ruleset = await repository.findActiveRuleset('onboarding', now);

      expect(ruleset).toMatchObject({ rulesetCode: 'unknown', versionCode: 'unknown' });
    });
  });
});
