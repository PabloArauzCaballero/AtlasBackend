import { describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Un modelo que declara `created_at NOT NULL` y no deja que Sequelize la rellene NO INSERTA NADA.
 *
 * Esto no es una regla de estilo: es el fallo que tumbó el gancho del expediente en el despliegue.
 * Con `timestamps: false` y la columna declarada `allowNull: false`, la validación del ORM rechaza
 * el INSERT **antes de enviarlo** —«createdAtValue cannot be null»—, así que el `DEFAULT NOW()` de
 * la tabla nunca llega a usarse. El alta seguía funcionando porque el gancho tolera fallos, y la
 * carpeta del cliente simplemente no se creaba: ningún error visible, ningún test en rojo.
 *
 * Ninguna prueba unitaria puede reproducirlo sin una base de datos, así que lo que se fija aquí es
 * la CONDICIÓN que lo provoca, leyendo los modelos como texto.
 */
const MODELS_DIR = path.join(__dirname, '../../../src/database/models');

function modelFiles(): string[] {
  return readdirSync(MODELS_DIR).filter((name) => name.endsWith('.model.ts'));
}

/** La columna de marca temporal declarada obligatoria, si la hay. */
function declaraTimestampObligatorio(source: string, field: 'created_at' | 'updated_at'): boolean {
  return new RegExp(`field: '${field}'[^}]*allowNull: true`).test(source)
    ? false
    : new RegExp(`field: '${field}'`).test(source);
}

describe('modelos: marcas de tiempo', () => {
  it('ningún modelo declara created_at obligatoria sin dejar que el ORM la rellene', () => {
    const rotos = modelFiles().filter((name) => {
      const source = readFileSync(path.join(MODELS_DIR, name), 'utf8');
      if (!declaraTimestampObligatorio(source, 'created_at')) return false;
      // Vale cualquiera de las dos salidas: que el ORM ponga la marca (`@CreatedAt`) o que el
      // repositorio la escriba a mano de forma explícita (`timestamps: false` + valor en el insert).
      const ormLaPone = /@CreatedAt/.test(source);
      const timestampsApagados = /timestamps: false/.test(source);
      return !ormLaPone && !timestampsApagados;
    });
    expect(rotos).toEqual([]);
  });

  it('los cinco modelos del expediente dejan la marca al ORM', () => {
    // Se nombran uno a uno porque es donde ocurrió: el gancho del alta los usa sin pasar por
    // ningún repositorio que rellene las marcas.
    for (const name of [
      'expedientes.model.ts',
      'expediente-nodos.model.ts',
      'expediente-concesiones.model.ts',
      'expediente-actividad.model.ts',
      'expediente-tickets-subida.model.ts',
    ]) {
      const source = readFileSync(path.join(MODELS_DIR, name), 'utf8');
      expect(source).toMatch(/@CreatedAt/);
      expect(source).toMatch(/timestamps: true/);
    }
  });

  it('una tabla sin columna updated_at apaga esa marca en lugar de inventarla', () => {
    // `expediente_actividad` es append-only por disparador: un UPDATE del ORM la haría fallar, y
    // las otras dos ni siquiera tienen la columna.
    for (const name of [
      'expediente-concesiones.model.ts',
      'expediente-actividad.model.ts',
      'expediente-tickets-subida.model.ts',
    ]) {
      const source = readFileSync(path.join(MODELS_DIR, name), 'utf8');
      expect(source).not.toMatch(/field: 'updated_at'/);
      expect(source).toMatch(/updatedAt: false/);
    }
  });
});
