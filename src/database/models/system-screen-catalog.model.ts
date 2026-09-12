/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

/** Una pantalla de un cliente (portal, ERP, app) con los permisos que el menú le exige. Caché del artefacto de Flujos. */
@Table({ tableName: 'system_screen_catalog', schema: atlasSchemaFor('system_screen_catalog'), timestamps: false })
export class SystemScreenCatalogModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: 'client_code', type: DataType.STRING(40), allowNull: false })
  declare clientCode: string;

  @Column({ type: DataType.STRING(300), allowNull: false })
  declare route: string;

  @Column({ field: 'source_file', type: DataType.STRING(300) })
  declare sourceFile: string | null;

  @Column({ field: 'nav_label', type: DataType.STRING(160) })
  declare navLabel: string | null;

  @Column({ field: 'nav_permissions', type: DataType.JSONB, allowNull: false })
  declare navPermissions: string[];

  @Column({ field: 'nav_roles', type: DataType.JSONB, allowNull: false })
  declare navRoles: string[];

  @Column({ field: 'analyzed_commit', type: DataType.STRING(64) })
  declare analyzedCommit: string | null;

  /**
   * Eje de verificación de la pantalla, en paralelo al de los endpoints: UNVERIFIED hasta que
   * alguien la abre de verdad. No hay BROKEN aquí —una pantalla no «falla», fallan las llamadas que
   * hace— y por eso el estado que importa es si se ha ejercitado o no.
   */
  @Column({ field: 'verification', type: DataType.STRING(20) })
  declare verification: string;

  @Column({ field: 'verified_at', type: DataType.DATE })
  declare verifiedAt: Date | null;

  @Column({ field: 'last_seen_at', type: DataType.DATE })
  declare lastSeenAt: Date | null;

  /** Qué se observó desde ella: cuántas peticiones, a qué rutas y cómo acabaron. */
  @Column({ field: 'observed_json', type: DataType.JSONB })
  declare observed: Record<string, unknown>;

  @Column({ field: 'import_id', type: DataType.BIGINT })
  declare importId: string | null;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;

  @Column({ field: '_updated_at', type: DataType.DATE, allowNull: false })
  declare updatedAtValue: Date;
}
