import { describe, expect, it } from '@jest/globals';
import { toWorkflowSummary, toWorkflowTree } from '../../../src/modules/workflow-catalog/workflow-catalog.mapper.js';
import { buildBundle, buildDefinition, buildStage, buildStep } from './workflow-bundle.fixtures.js';

describe('toWorkflowSummary', () => {
  it('serializa fechas a ISO-8601 y normaliza los identificadores a string', () => {
    const summary = toWorkflowSummary(buildDefinition({ id: 7, effectiveFrom: new Date('2026-01-01T00:00:00.000Z') } as never));

    expect(summary.workflowId).toBe('7');
    expect(summary.effectiveFrom).toBe('2026-01-01T00:00:00.000Z');
    expect(summary.effectiveUntil).toBeNull();
    expect(summary.createdAt).toBe('2026-07-28T00:00:00.000Z');
  });
});

describe('toWorkflowTree', () => {
  it('anida las subetapas bajo su padre y deja solo las raíces en el primer nivel', () => {
    const tree = toWorkflowTree(buildBundle());

    expect(tree.stages.map((stage) => stage.stageCode)).toEqual(['stage_a', 'stage_b']);
    expect(tree.stages[0].subStages.map((stage) => stage.stageCode)).toEqual(['stage_a_child']);
    expect(tree.stages[0].subStages[0].parentStageCode).toBe('stage_a');
  });

  it('coloca cada paso en su etapa, ordenado por orden de ejecución', () => {
    const bundle = buildBundle();
    bundle.steps.push(buildStep({ id: '104', stepCode: 'step.zero', workflowStageId: '10', executionOrder: 1 }));

    const tree = toWorkflowTree(bundle);

    expect(tree.stages[0].steps.map((step) => step.stepCode)).toEqual(['step.zero', 'step.one']);
  });

  it('resuelve pasos previos y siguientes a partir de las transiciones', () => {
    const tree = toWorkflowTree(buildBundle());

    const stepTwo = tree.stages[0].subStages[0].steps[0];
    expect(stepTwo.stepCode).toBe('step.two');
    expect(stepTwo.previousStepCodes).toEqual(['step.one']);
    expect(stepTwo.nextStepCodes).toEqual(['step.three']);
  });

  it('no crea aristas de entrada ni de salida como paso previo/siguiente', () => {
    const tree = toWorkflowTree(buildBundle());

    // Las transiciones `entry` y `exit` tienen un extremo nulo: describen el borde del flujo, no
    // una relación entre dos pasos, y confundirlas dejaría `previousStepCodes` con un hueco.
    expect(tree.stages[0].steps[0].previousStepCodes).toEqual([]);
    expect(tree.stages[1].steps[0].nextStepCodes).toEqual([]);
  });

  it('expone las dependencias declaradas de cada paso', () => {
    const tree = toWorkflowTree(buildBundle());

    expect(tree.stages[1].steps[0].dependsOn).toEqual([{ stepCode: 'step.two', dependencyType: 'requires_completion', description: null }]);
  });

  it('mapea las transiciones a códigos de paso, con null en los extremos del flujo', () => {
    const tree = toWorkflowTree(buildBundle());

    expect(tree.transitions.find((transition) => transition.transitionCode === 'entry')).toMatchObject({
      fromStepCode: null,
      toStepCode: 'step.one',
      conditionType: 'always',
    });
    expect(tree.transitions.find((transition) => transition.transitionCode === 'exit')).toMatchObject({
      fromStepCode: 'step.three',
      toStepCode: null,
    });
  });

  it('devuelve totales que cuentan TODAS las etapas, no solo las raíces', () => {
    const tree = toWorkflowTree(buildBundle());

    expect(tree.totals).toEqual({ stages: 3, steps: 3, transitions: 4, dependencies: 1 });
  });

  it('sube a raíz una etapa cuyo padre no está en el bundle en vez de descartarla', () => {
    const bundle = buildBundle();
    bundle.stages = [buildStage({ id: '11', stageCode: 'stage_a_child', parentStageId: '10', displayOrder: 20 })];
    bundle.steps = [];
    bundle.dependencies = [];
    bundle.transitions = [];

    const tree = toWorkflowTree(bundle);

    expect(tree.stages.map((stage) => stage.stageCode)).toEqual(['stage_a_child']);
    expect(tree.stages[0].parentStageCode).toBeNull();
  });
});
