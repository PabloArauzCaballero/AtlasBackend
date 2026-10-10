/**
 * @file Migración de datos: las huellas de teléfono pasan de SHA-256 desnudo a HMAC con la clave del servidor (APP-21).
 * @business Un SHA-256 de un móvil boliviano se revierte en segundos; con HMAC, la base y sus respaldos dejan de llevar teléfonos en claro.
 * @system reescribe por lotes las columnas de `PHONE_HASH_COLUMNS` con `upgradeStoredPhoneHash`; idempotente; el `down` se niega si ya convirtió algo.
 */
import { QueryInterface, QueryTypes } from 'sequelize';
import { countProtectedPhoneHashes, upgradeAllPhoneHashes, type RunQuery } from '../migration-support/phone-hash-columns.js';

type MigrationContext = { context: QueryInterface };

function runner(queryInterface: QueryInterface): RunQuery {
  return async (sql, params) => {
    const isSelect = /^\s*SELECT/iu.test(sql);
    const result = await queryInterface.sequelize.query(sql, {
      bind: params,
      type: isSelect ? QueryTypes.SELECT : QueryTypes.UPDATE,
    });
    return isSelect ? (result as unknown as Array<Record<string, unknown>>) : [];
  };
}

/**
 * No necesita ningún número en claro: el HMAC se aplica SOBRE el SHA-256 guardado, que es justo lo que la app y el
 * servidor calculan antes de buscar. Necesita `PHONE_HASH_HMAC_KEYS` sólo si hay filas que convertir; sin ella, falla
 * antes de escribir la primera. Un corte a mitad se retoma volviendo a correrla.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  const converted = await upgradeAllPhoneHashes(runner(queryInterface), (line) => console.log(`[phone-hash] ${line}`));
  const total = Object.values(converted).reduce((sum, n) => sum + n, 0);
  console.log(`[phone-hash] ${String(total)} filas convertidas a HMAC.`);
}

/**
 * Irreversible en cuanto convirtió algo: el HMAC no se deshace y el SHA-256 de origen no está guardado en ninguna parte
 * (ése es el objetivo). Volver al código anterior con estas filas dejaría el login por teléfono, la deduplicación y los
 * cruces sin encontrar nada, en silencio; por eso se niega en vez de «revertir» a medias. Sobre una base sin huellas
 * protegidas (CI, entorno recién creado) no hay nada que deshacer y termina bien.
 */
export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  const protectedRows = await countProtectedPhoneHashes(runner(queryInterface));
  if (protectedRows > 0) {
    throw new Error(
      `phone-hashes-to-hmac no es reversible: ${String(protectedRows)} filas ya guardan HMAC y el SHA-256 de origen no existe. ` +
        'Para volver atrás, restaura el respaldo previo al despliegue; no hay forma de deshacerlo sin mezclar formatos.',
    );
  }
}
