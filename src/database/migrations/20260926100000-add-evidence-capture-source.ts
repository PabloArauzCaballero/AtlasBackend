/**
 * @file Migración reversible: evoluciona el esquema PostgreSQL en orden.
 * @business Una imagen del carnet sacada con el escáner del sistema no es una foto: el Motor tiene que saber cuál es cuál para juzgarla.
 * @system añade `capture_source` (camera | system_scanner, con CHECK) a `privacy.evidence_documents`.
 */
import { QueryInterface } from 'sequelize';
import { atlasSchemaFor } from '../domain-schemas.js';

type MigrationContext = { context: QueryInterface };

const EVIDENCE = `${atlasSchemaFor('evidence_documents')}.evidence_documents`;

/**
 * El origen de la captura de cada evidencia (plan del escáner del carnet, 2026-09-26, fase 4).
 *
 * ## Por qué
 *
 * La app pasa a escanear anverso y reverso con el escáner de documentos DEL SISTEMA (VisionKit en
 * iOS, ML Kit en Android). Ese escáner no entrega el original: devuelve un recorte con la perspectiva
 * corregida, recodificado y, en iOS, con el filtro que elija la persona. El forense del Motor se
 * calibró con fotos, así que esas imágenes son una población NO medida y tienen que poder
 * distinguirse, en la base y en el Motor.
 *
 * ## Lo que se añade
 *
 * - `capture_source VARCHAR(20) NULL` con CHECK `IN ('camera','system_scanner')` en la MISMA
 *   migración (regla §3 de atlas/CLAUDE.md): un valor fuera del vocabulario se rechaza aquí y no
 *   llega a nadie que lo lea.
 *
 * Sin `UPDATE` ni valor por omisión: las filas anteriores quedan en NULL, que se lee «cámara» —era
 * lo único que existía—. No se rellenan con `camera` porque eso afirmaría algo que nadie registró.
 * `ADD COLUMN` sin DEFAULT en PostgreSQL es sólo de catálogo: no reescribe la tabla.
 */
export async function up({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${EVIDENCE}
  ADD COLUMN IF NOT EXISTS capture_source VARCHAR(20);
`);

  await queryInterface.sequelize.query(`
ALTER TABLE ${EVIDENCE} DROP CONSTRAINT IF EXISTS ck_evidence_documents_capture_source;
ALTER TABLE ${EVIDENCE} ADD CONSTRAINT ck_evidence_documents_capture_source
  CHECK (capture_source IS NULL OR capture_source IN ('camera','system_scanner'));
`);

  await queryInterface.sequelize.query(
    `COMMENT ON COLUMN ${EVIDENCE}.capture_source IS
     'Con qué se capturó la imagen: camera = cámara de la app (foto entera); system_scanner = escáner de documentos del sistema (VisionKit/ML Kit: recorte con perspectiva corregida y recodificado). NULL = cámara: filas anteriores a la etiqueta o apps que no la envían.'`,
  );
}

export async function down({ context: queryInterface }: MigrationContext): Promise<void> {
  await queryInterface.sequelize.query(`
ALTER TABLE ${EVIDENCE}
  DROP CONSTRAINT IF EXISTS ck_evidence_documents_capture_source,
  DROP COLUMN IF EXISTS capture_source;
`);
}
