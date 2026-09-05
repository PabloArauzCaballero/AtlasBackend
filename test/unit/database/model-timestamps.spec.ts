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

/**
 * El alcance es la familia `created_at` SIN prefijo, no todos los modelos.
 *
 * Las ~180 tablas históricas usan `_created_at` y sus repositorios escriben la marca a mano en
 * cada insert; esa convención funciona y no se toca aquí. Lo que se vigila es la familia nueva,
 * donde la marca la gestiona el ORM: mezclar las dos —columna obligatoria en el modelo y relleno
 * en el `save()`— es exactamente lo que impide que la fila salga del proceso.
 */
function modelosConMarcaGestionada(): string[] {
  return readdirSync(MODELS_DIR)
    .filter((name) => name.endsWith('.model.ts'))
    .filter((name) => /field: 'created_at'/.test(readFileSync(path.join(MODELS_DIR, name), 'utf8')));
}

describe('modelos: marcas de tiempo', () => {
  it('nadie declara created_at obligatoria y a la vez deja que la ponga el ORM', () => {
    // Las dos cosas juntas se anulan: la validación corre ANTES del `save()` que rellena la marca.
    const rotos = modelosConMarcaGestionada().filter((name) => {
      const source = readFileSync(path.join(MODELS_DIR, name), 'utf8');
      const obligatoria = /@Column\(\{ field: 'created_at'[^}]*allowNull: false/.test(source);
      return obligatoria && /@CreatedAt/.test(source);
    });
    expect(rotos).toEqual([]);
  });

  it('o la pone el ORM, o la escribe el repositorio: nunca ninguna de las dos', () => {
    const rotos = modelosConMarcaGestionada().filter((name) => {
      const source = readFileSync(path.join(MODELS_DIR, name), 'utf8');
      const ormLaPone = /@CreatedAt/.test(source);
      const obligatoria = /@Column\(\{ field: 'created_at'[^}]*allowNull: false/.test(source);
      // Si no la pone el ORM, la columna debe ser obligatoria para que se note al olvidarla.
      return !ormLaPone && !obligatoria;
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
