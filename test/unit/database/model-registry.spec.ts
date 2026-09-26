import { describe, expect, it } from '@jest/globals';
import * as modelos from '../../../src/database/models/index.js';
import { databaseModels } from '../../../src/database/database-models.js';

/**
 * Un modelo exportado y NO registrado arranca, compila y pasa las pruebas unitarias —los
 * repositorios se doblan— y en el servidor contesta 500 en cuanto alguien lo consulta:
 * «Model not initialized: "CustomerConsumerSurveyAnswerModel" needs to be added to a Sequelize
 * instance». Pasó el 2026-09-18 en DEV: la encuesta de hábitos tumbó `/status` y `/customers/me`
 * de TODOS los clientes, porque la evaluación de elegibilidad la lee. Aquí se fija la condición.
 */
describe('registro de modelos', () => {
  it('todo modelo exportado por models/index.ts está en databaseModels', () => {
    const registrados = new Set(databaseModels.map((modelo) => modelo.name));
    const exportados = Object.entries(modelos)
      .filter(([nombre, valor]) => nombre.endsWith('Model') && typeof valor === 'function')
      .map(([nombre]) => nombre);
    expect(exportados.length).toBeGreaterThan(100);
    const huerfanos = exportados.filter((nombre) => !registrados.has(nombre));
    expect(huerfanos).toEqual([]);
  });

  it('ningún modelo se registra dos veces', () => {
    const nombres = databaseModels.map((modelo) => modelo.name);
    const repetidos = nombres.filter((nombre, i) => nombres.indexOf(nombre) !== i);
    expect([...new Set(repetidos)]).toEqual([]);
  });
});
