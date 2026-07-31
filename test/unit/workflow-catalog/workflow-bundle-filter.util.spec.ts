import { describe, expect, it } from '@jest/globals';
import { filterWorkflowBundle } from '../../../src/modules/workflow-catalog/workflow-bundle-filter.util.js';
import { buildBundle, buildStage, buildStep } from './workflow-bundle.fixtures.js';

describe('filterWorkflowBundle', () => {
  it('devuelve el bundle intacto (misma referencia) cuando no hay filtros', () => {
    const bundle = buildBundle();
    expect(filterWorkflowBundle(bundle, {})).toBe(bundle);
  });

  it('conserva la cadena de ancestros de una subetapa que sobrevive al filtro de módulo', () => {
    const bundle = buildBundle();

    const filtered = filterWorkflowBundle(bundle, { moduleCode: 'customer_onboarding' });

    const codes = filtered.stages.map((stage) => stage.stageCode);
    // `stage_a` es de módulo `auth` y no matchea, pero es el padre de `stage_a_child`: sin él la
    // subetapa quedaría colgando de la raíz y el árbol mentiría sobre la jerarquía.
    expect(codes).toEqual(expect.arrayContaining(['stage_a', 'stage_a_child']));
    expect(codes).not.toContain('stage_b');
  });

  it('descarta los pasos de las etapas que el filtro eliminó', () => {
    const bundle = buildBundle();

    const filtered = filterWorkflowBundle(bundle, { moduleCode: 'operations' });

    expect(filtered.stages.map((stage) => stage.stageCode)).toEqual(['stage_b']);
    expect(filtered.steps.map((step) => step.stepCode)).toEqual(['step.three']);
  });

  it('elimina transiciones y dependencias que apuntarían a un paso descartado', () => {
    const bundle = buildBundle();

    const filtered = filterWorkflowBundle(bundle, { moduleCode: 'operations' });

    // Solo sobrevive `step.three`; las aristas hacia `step.one`/`step.two` desaparecen porque una
    // flecha hacia un nodo inexistente es peor que la ausencia de la flecha.
    expect(filtered.dependencies).toHaveLength(0);
    expect(filtered.transitions.map((transition) => transition.transitionCode)).toEqual(['exit']);
  });

  it('filtra pasos por rol y trata la lista vacía como "cualquier actor autenticado"', () => {
    const bundle = buildBundle();

    const filtered = filterWorkflowBundle(bundle, { role: 'internal_operator' });

    // `step.one` no declara roles -> visible para cualquiera. `step.two` es solo de `customer`.
    expect(filtered.steps.map((step) => step.stepCode).sort()).toEqual(['step.one', 'step.three']);
  });

  it('conserva una etapa padre sin pasos propios si alguna subetapa sí conserva pasos', () => {
    const bundle = buildBundle();
    bundle.stages.push(buildStage({ id: '13', stageCode: 'stage_c', displayOrder: 40, moduleCode: 'credit' }));
    bundle.stages.push(buildStage({ id: '14', stageCode: 'stage_c_child', displayOrder: 50, parentStageId: '13', moduleCode: 'credit' }));
    bundle.steps.push(
      buildStep({ id: '103', stepCode: 'step.four', workflowStageId: '14', allowedRoles: ['customer'], executionOrder: 40 }),
    );

    const filtered = filterWorkflowBundle(bundle, { role: 'customer' });

    expect(filtered.stages.map((stage) => stage.stageCode)).toEqual(expect.arrayContaining(['stage_c', 'stage_c_child']));
  });

  it('filtra por estado del ciclo de vida y por tipo de actor', () => {
    const bundle = buildBundle();

    expect(filterWorkflowBundle(bundle, { lifecycleStatus: 'under_review' }).stages.map((s) => s.stageCode)).toEqual(
      expect.arrayContaining(['stage_a', 'stage_a_child', 'stage_b']),
    );
    // `stage_b` exige `under_review`; con `registered` queda fuera y solo quedan las sin restricción.
    expect(filterWorkflowBundle(bundle, { lifecycleStatus: 'registered' }).stages.map((s) => s.stageCode)).not.toContain('stage_b');
    expect(filterWorkflowBundle(bundle, { actorType: 'internal_user' }).stages.map((s) => s.stageCode)).toEqual(['stage_b']);
  });

  it('devuelve un bundle vacío de etapas cuando ningún módulo coincide', () => {
    const filtered = filterWorkflowBundle(buildBundle(), { moduleCode: 'inexistente' });

    expect(filtered.stages).toHaveLength(0);
    expect(filtered.steps).toHaveLength(0);
    expect(filtered.transitions).toHaveLength(0);
  });
});
