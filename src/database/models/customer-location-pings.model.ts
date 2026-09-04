/**
 * @file Modelo ORM: mapea una tabla y su contrato tipado.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system define models para evolucionar, mapear, sembrar o consultar PostgreSQL de forma controlada.
 */
import { Column, DataType, Model, Table } from 'sequelize-typescript';
import { atlasSchemaFor } from '../domain-schemas.js';

@Table({
  tableName: 'customer_location_pings',
  schema: atlasSchemaFor('customer_location_pings'),
  timestamps: false,
})
export class CustomerLocationPingModel extends Model {
  @Column({ field: '_id', type: DataType.BIGINT, primaryKey: true, autoIncrement: true, allowNull: false })
  declare id: string;

  @Column({ field: '_tenant_id', type: DataType.BIGINT, allowNull: false })
  declare tenantId: string;

  @Column({ field: 'customer_id', type: DataType.BIGINT, allowNull: false })
  declare customerId: string;

  @Column({ field: 'device_id', type: DataType.BIGINT })
  declare deviceId: string | null;

  @Column({ field: 'session_id', type: DataType.BIGINT })
  declare sessionId: string | null;

  @Column({ field: 'consent_id', type: DataType.BIGINT })
  declare consentId: string | null;

  @Column({ field: 'gps_lat', type: DataType.DECIMAL(10, 7), allowNull: false })
  declare gpsLat: string;

  @Column({ field: 'gps_lng', type: DataType.DECIMAL(10, 7), allowNull: false })
  declare gpsLng: string;

  @Column({ field: 'gps_accuracy_meters', type: DataType.DECIMAL(8, 2) })
  declare gpsAccuracyMeters: string | null;

  @Column({ field: 'altitude_meters', type: DataType.DECIMAL(9, 2) })
  declare altitudeMeters: string | null;

  @Column({ field: 'speed_mps', type: DataType.DECIMAL(7, 2) })
  declare speedMps: string | null;

  @Column({ field: 'heading_degrees', type: DataType.DECIMAL(6, 2) })
  declare headingDegrees: string | null;

  @Column({ field: 'capture_mode', type: DataType.STRING(20) })
  declare captureMode: string;

  @Column({ field: 'is_mocked', type: DataType.BOOLEAN })
  declare isMocked: boolean;

  @Column({ field: 'battery_level', type: DataType.DECIMAL(5, 2) })
  declare batteryLevel: string | null;

  @Column({ field: 'distance_to_declared_meters', type: DataType.DECIMAL(12, 2) })
  declare distanceToDeclaredMeters: string | null;

  @Column({ field: 'captured_at', type: DataType.DATE, allowNull: false })
  declare capturedAt: Date;

  @Column({ field: 'received_at', type: DataType.DATE, allowNull: false })
  declare receivedAt: Date;

  @Column({ field: '_created_at', type: DataType.DATE, allowNull: false })
  declare createdAtValue: Date;
}
