import { describe, expect, it, jest } from '@jest/globals';
import { DataTypes } from 'sequelize';
import {
  addChecks,
  addForeignKeys,
  buildColumns,
  createIndexes,
  indexColumns,
  indexName,
  quoteIdentifier,
  resolveColumnType,
  shortenName,
  type IndexSpec,
  type TableSpec,
} from '../../../src/database/migration-support/atlas-schema-builder.util.js';

/**
 * Las utilidades con las que las migraciones construyen el esquema.
 *
 * Lo que se fija aquí no es «que genere SQL», sino las tres cosas que fallan en silencio y sólo se
 * notan en producción: un nombre de índice que PostgreSQL trunca a 63 caracteres —y entonces dos
 * índices distintos pasan a llamarse igual—, un identificador con comillas que rompe la sentencia,
 * y una restricción que se vuelve a añadir sobre una base que ya la tiene.
 */

const columna = (over: Partial<TableSpec['columns'][number]['spec']> = {}) => ({
  kind: 'STRING' as const,
  allowNull: true,
  ...over,
});

describe('resolveColumnType', () => {
  it('lleva la longitud a STRING y la precisión a DECIMAL', () => {
    expect(resolveColumnType(columna({ kind: 'STRING', length: 60 }))).toEqual(DataTypes.STRING(60));
    expect(resolveColumnType(columna({ kind: 'DECIMAL', precision: 12, scale: 2 }))).toEqual(DataTypes.DECIMAL(12, 2));
  });

  /* Un DECIMAL sin precisión declarada es válido: PostgreSQL lo trata como numérico sin límite. */
  it('acepta DECIMAL sin precisión', () => {
    expect(resolveColumnType(columna({ kind: 'DECIMAL' }))).toBe(DataTypes.DECIMAL);
  });
});

describe('buildColumns', () => {
  it('traslada nulabilidad, clave primaria, autoincremento y comentario', () => {
    const tabla: TableSpec = {
      className: 'Cosa',
      tableName: 'cosas',
      stereotypes: [],
      columns: [
        { name: '_id', spec: columna({ kind: 'BIGINT', allowNull: false, primaryKey: true, autoIncrement: true }) },
        { name: 'nombre', spec: columna({ length: 80, comment: 'Como lo escribió el titular.' }) },
      ],
    };

    const columnas = buildColumns(tabla) as unknown as Record<string, Record<string, unknown>>;

    expect(columnas._id.primaryKey).toBe(true);
    expect(columnas._id.autoIncrement).toBe(true);
    expect(columnas._id.allowNull).toBe(false);
    expect(columnas.nombre.comment).toBe('Como lo escribió el titular.');
    // Lo que NO se declara no aparece: una clave primaria implícita sería un cambio de esquema.
    expect(columnas.nombre.primaryKey).toBeUndefined();
  });
});

describe('shortenName', () => {
  /*
   * PostgreSQL trunca los identificadores a 63 caracteres SIN AVISAR. Dos índices cuyos nombres
   * sólo difieren después del carácter 63 acaban siendo el mismo, y el segundo `CREATE INDEX IF NOT
   * EXISTS` no crea nada: el índice que falta no se nota hasta que una consulta se vuelve lenta.
   */
  it('deja intacto lo que cabe', () => {
    expect(shortenName('idx_cosas_nombre')).toBe('idx_cosas_nombre');
  });

  it('acorta lo que no cabe y conserva la diferencia en el hash', () => {
    const largo = 'idx_una_tabla_con_nombre_larguisimo_de_verdad_sobre_la_columna';
    const otro = `${largo}_distinta`;

    expect(shortenName(largo).length).toBeLessThanOrEqual(56);
    expect(shortenName(largo)).not.toBe(shortenName(otro));
  });

  it('es determinista: el mismo nombre da siempre el mismo acortado', () => {
    const largo = 'idx_'.padEnd(80, 'x');
    expect(shortenName(largo)).toBe(shortenName(largo));
  });
});

describe('quoteIdentifier', () => {
  it('duplica la comilla interior en vez de dejarla cerrar el identificador', () => {
    expect(quoteIdentifier('tabla')).toBe('"tabla"');
    expect(quoteIdentifier('ra"ro')).toBe('"ra""ro"');
  });
});

describe('indexColumns e indexName', () => {
  it('cita cada campo, y respeta la expresión cruda cuando la hay', () => {
    expect(indexColumns({ table: 't', fields: ['a', 'b'] } as IndexSpec)).toBe('"a", "b"');
    expect(indexColumns({ table: 't', rawColumns: 'lower(email)' } as IndexSpec)).toBe('lower(email)');
  });

  it('el prefijo dice si es único, y el método va al final', () => {
    expect(indexName({ table: 'cosas', fields: ['nombre'] } as IndexSpec)).toBe('idx_cosas_nombre');
    expect(indexName({ table: 'cosas', fields: ['nombre'], unique: true } as IndexSpec)).toBe('ux_cosas_nombre');
    expect(indexName({ table: 'cosas', fields: ['datos'], using: 'gin' } as IndexSpec)).toBe('idx_cosas_datos_gin');
  });

  /* Una expresión cruda lleva paréntesis y puntos: sin normalizar no es un identificador válido. */
  it('normaliza la expresión cruda a algo nombrable', () => {
    expect(indexName({ table: 'cosas', rawColumns: 'lower(email)' } as IndexSpec)).toBe('idx_cosas_lower_email_');
  });
});

describe('createIndexes', () => {
  function queryInterfaceFalso(existe = false) {
    const consultas: string[] = [];
    return {
      consultas,
      qi: {
        sequelize: {
          query: jest.fn(async (sql: string) => {
            consultas.push(sql);
            return [[{ exists: existe }], undefined];
          }),
        },
        addConstraint: jest.fn(async (..._a: unknown[]) => undefined),
      },
    };
  }

  it('crea con IF NOT EXISTS, y arrastra unicidad, método y filtro', async () => {
    const { qi, consultas } = queryInterfaceFalso();

    await createIndexes(qi as never, [
      { table: 'cosas', fields: ['nombre'], unique: true, where: 'deleted = false' } as IndexSpec,
      { table: 'cosas', fields: ['datos'], using: 'gin' } as IndexSpec,
    ]);

    expect(consultas[0]).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "ux_cosas_nombre"');
    expect(consultas[0]).toContain('WHERE deleted = false');
    expect(consultas[1]).toContain('USING GIN');
  });

  it('no vuelve a añadir una restricción que la base ya tiene', async () => {
    const { qi } = queryInterfaceFalso(true);

    await addForeignKeys(qi as never, [{ table: 'cosas', column: 'tenant_id', targetTable: 'tenants', targetColumn: '_id' } as never]);
    await addChecks(qi as never, [{ table: 'cosas', name: 'ck_cosas_algo', expression: 'algo > 0' } as never]);

    expect(qi.addConstraint).not.toHaveBeenCalled();
    // La comprobación sí se hizo; lo que no se hizo es el ALTER TABLE.
    expect(qi.sequelize.query.mock.calls.every(([sql]) => String(sql).includes('information_schema'))).toBe(true);
  });

  /*
   * Una foránea que admite nulos se borra con SET NULL y una que no, con RESTRICT: al revés, borrar
   * un tenant dejaría filas apuntando a nada, o no se podría borrar nunca.
   */
  it('elige el ON DELETE según si la columna admite nulos', async () => {
    const { qi } = queryInterfaceFalso(false);

    await addForeignKeys(qi as never, [
      { table: 'a', column: 'x', targetTable: 'b', targetColumn: '_id', allowNull: true } as never,
      { table: 'a', column: 'y', targetTable: 'b', targetColumn: '_id', allowNull: false } as never,
    ]);

    const opciones = qi.addConstraint.mock.calls.map(([, o]) => o as { onDelete: string });
    expect(opciones[0].onDelete).toBe('SET NULL');
    expect(opciones[1].onDelete).toBe('RESTRICT');
  });
});
