import { describe, expect, it } from '@jest/globals';
import { isLeafStage, stagesInTreeOrder } from '../../../src/modules/workflow-catalog/workflow-stage-order.util.js';
import { buildStage } from './workflow-bundle.fixtures.js';

/**
 * `display_order` es relativo a los hermanos. Estas etapas reproducen la trampa real del catálogo:
 * una subetapa con orden 10 y una etapa raíz con orden 10 no son comparables entre sí.
 */
const STAGES = [
  buildStage({ id: '3', stageCode: 'raiz_c', displayOrder: 30 }),
  buildStage({ id: '2', stageCode: 'hijo_a2', displayOrder: 20, parentStageId: '1' }),
  buildStage({ id: '1', stageCode: 'raiz_a', displayOrder: 10 }),
  buildStage({ id: '4', stageCode: 'hijo_a1', displayOrder: 10, parentStageId: '1' }),
  buildStage({ id: '5', stageCode: 'raiz_b', displayOrder: 20 }),
  buildStage({ id: '6', stageCode: 'nieto_a1', displayOrder: 10, parentStageId: '4' }),
];

describe('stagesInTreeOrder', () => {
  it('recorre el árbol en profundidad: padre, sus descendientes, y recién después el siguiente hermano', () => {
    expect(stagesInTreeOrder(STAGES).map((stage) => stage.stageCode)).toEqual([
      'raiz_a',
      'hijo_a1',
      'nieto_a1',
      'hijo_a2',
      'raiz_b',
      'raiz_c',
    ]);
  });

  it('no intercala una subetapa con etapas raíz que comparten su display_order', () => {
    const codes = stagesInTreeOrder(STAGES).map((stage) => stage.stageCode);
    // `hijo_a1` tiene display_order 10 igual que `raiz_a`; un sort plano lo pondría junto a las
    // raíces y el recorrido mostraría una subetapa antes que la etapa que la contiene.
    expect(codes.indexOf('hijo_a1')).toBeGreaterThan(codes.indexOf('raiz_a'));
    expect(codes.indexOf('hijo_a1')).toBeLessThan(codes.indexOf('raiz_b'));
  });

  it('trata como raíz una etapa cuyo padre no está en el conjunto (bundle filtrado)', () => {
    const huerfana = [buildStage({ id: '9', stageCode: 'huerfana', displayOrder: 5, parentStageId: '999' })];
    expect(stagesInTreeOrder(huerfana).map((stage) => stage.stageCode)).toEqual(['huerfana']);
  });

  it('no cuelga ante una referencia circular de padres', () => {
    const ciclo = [
      buildStage({ id: '1', stageCode: 'a', displayOrder: 10, parentStageId: '2' }),
      buildStage({ id: '2', stageCode: 'b', displayOrder: 20, parentStageId: '1' }),
    ];
    expect(stagesInTreeOrder(ciclo)).toHaveLength(2);
  });

  it('no muta el arreglo recibido', () => {
    const original = STAGES.map((stage) => stage.stageCode);
    stagesInTreeOrder(STAGES);
    expect(STAGES.map((stage) => stage.stageCode)).toEqual(original);
  });
});

describe('isLeafStage', () => {
  it('una etapa con subetapas no es hoja', () => {
    expect(
      isLeafStage(
        STAGES.find((stage) => stage.stageCode === 'raiz_a')!,
        STAGES,
      ),
    ).toBe(false);
  });

  it('una etapa sin subetapas es hoja', () => {
    expect(
      isLeafStage(
        STAGES.find((stage) => stage.stageCode === 'nieto_a1')!,
        STAGES,
      ),
    ).toBe(true);
    expect(
      isLeafStage(
        STAGES.find((stage) => stage.stageCode === 'raiz_b')!,
        STAGES,
      ),
    ).toBe(true);
  });
});
