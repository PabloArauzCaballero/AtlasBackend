/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Un cambio de esquema aprobado tiene que poder rastrearse hasta la migración que lo aplicó; si no, el change log sólo dice que alguien dijo que sí.
 * @system marca en `schema_change_log` qué migración materializó un cambio aprobado y cuándo.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

/**
 * Se llama desde la migración que aplica un cambio aprobado en «Change log» (P-35), con el id del
 * cambio y el nombre del propio archivo:
 *
 * ```ts
 * await linkSchemaChangeToMigration(queryInterface, '42', '20261001120000-create-foo');
 * ```
 *
 * El change log es DATO de cada entorno: el cambio 42 existe donde se propuso y no en una base
 * recién creada ni en las de prueba. Por eso no falla si no encuentra la fila —una migración que
 * falla tumba el API al desplegar (CLAUDE.md §3)—: devuelve cuántas filas enlazó para que la
 * migración pueda registrarlo. Sólo enlaza cambios `approved` y aún sin migración: no reescribe
 * un enlace anterior ni da por aplicado algo que nadie aprobó.
 */
export async function linkSchemaChangeToMigration(
  queryInterface: QueryInterface,
  changeId: string,
  migrationName: string,
): Promise<number> {
  const table = `${atlasSchemaFor('schema_change_log')}.schema_change_log`;
  const [rows] = await queryInterface.sequelize.query(
    `UPDATE ${table}
        SET applied_by_migration = :migrationName, applied_at = NOW()
      WHERE _id = :changeId AND approval_status = 'approved' AND applied_by_migration IS NULL
      RETURNING _id`,
    { replacements: { changeId, migrationName } },
  );
  return (rows as unknown[]).length;
}
