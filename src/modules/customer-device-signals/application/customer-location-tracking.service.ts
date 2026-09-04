/**
 * @file Servicio de aplicación: recibe el lote de posiciones y lo persiste como serie temporal.
 * @business Esta pieza contrasta dónde está la persona con el domicilio que declaró y detecta ubicaciones simuladas.
 * @system inserta el lote de forma idempotente y calcula la distancia al domicilio en el servidor.
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../../common/types/auth.types.js';
import { CustomerLocationPingsRepository, type PingRow } from '../repositories/customer-location-pings.repository.js';
import { DeviceSignalsJournalRepository } from '../repositories/device-signals-journal.repository.js';
import { type LocationPingBatchDto, type LocationPingBatchView, type LocationPingDto } from '../customer-device-signals.schemas.js';
import { DeviceSignalsAccessService, type DeviceSignalContext } from './device-signals-access.service.js';

/** La finalidad que ampara este tratamiento. Es el `document_code` del consentimiento sembrado. */
export const LOCATION_TRACKING_PURPOSE = 'location_tracking';

/** Radio medio de la Tierra, en metros. */
const RADIO_TERRESTRE_M = 6_371_008.8;

/**
 * Distancia entre dos coordenadas, por la fórmula del haversine.
 *
 * Se calcula en el SERVIDOR y no en el teléfono por dos razones. La primera es que el teléfono
 * tendría que conocer la coordenada del domicilio declarado, y devolvérsela sería decirle a quien
 * quiera falsear su ubicación exactamente dónde tiene que decir que está. La segunda es que un
 * número calculado por el cliente es un número que el cliente elige.
 *
 * Haversine y no una proyección plana: a las distancias que importan aquí —de metros a decenas de
 * kilómetros— el error del haversine es despreciable y no depende de la latitud, mientras que la
 * aproximación plana se degrada al alejarse del ecuador.
 */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const radianes = (grados: number): number => (grados * Math.PI) / 180;
  const dLat = radianes(b.lat - a.lat);
  const dLng = radianes(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(radianes(a.lat)) * Math.cos(radianes(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * RADIO_TERRESTRE_M * Math.asin(Math.min(1, Math.sqrt(h)));
}


/** Un decimal fijo, o nulo. PostgreSQL guarda NUMERIC como texto y Sequelize lo devuelve así. */
function decimal(valor: number | null | undefined, digitos: number): string | null {
  return valor === null || valor === undefined ? null : valor.toFixed(digitos);
}

/**
 * De la posición que manda el teléfono a la fila que se guarda.
 *
 * Función de módulo y no método: no toca nada del servicio, y así se puede probar la conversión
 * —sobre todo la distancia y la escala de la batería— sin levantar el contenedor de Nest.
 */
function toRow(
  ping: LocationPingDto,
  contexto: {
    input: { tenantId: string; customerId: string; body: LocationPingBatchDto };
    contexto: DeviceSignalContext;
    referencia: { lat: number; lng: number } | null;
    now: Date;
  },
): PingRow {
  const { input, referencia, now } = contexto;
  return {
    tenantId: input.tenantId,
    customerId: input.customerId,
    deviceId: contexto.contexto.deviceId,
    sessionId: input.body.sessionId ?? null,
    consentId: contexto.contexto.consentId,
    gpsLat: ping.lat.toFixed(7),
    gpsLng: ping.lng.toFixed(7),
    gpsAccuracyMeters: decimal(ping.accuracyMeters, 2),
    altitudeMeters: decimal(ping.altitudeMeters, 2),
    speedMps: decimal(ping.speedMps, 2),
    headingDegrees: decimal(ping.headingDegrees, 2),
    captureMode: ping.captureMode,
    isMocked: ping.isMocked,
    // El sistema lo entrega de 0 a 1; se guarda como porcentaje para que la columna se lea sin
    // tener que recordar la escala.
    batteryLevel: decimal(
      ping.batteryLevel === null || ping.batteryLevel === undefined ? null : ping.batteryLevel * 100,
      2,
    ),
    distanceToDeclaredMeters: referencia
      ? haversineMeters(referencia, { lat: ping.lat, lng: ping.lng }).toFixed(2)
      : null,
    capturedAt: new Date(ping.capturedAt),
    receivedAt: now,
  };
}

/**
 * El rastro de posiciones del dispositivo.
 *
 * ## Por qué es un lote y no una posición
 *
 * Porque el teléfono no siempre tiene red cuando tiene posición. La app acumula y envía; mandar una
 * petición por punto gastaría batería y datos para el mismo resultado, y perdería todo lo capturado
 * en un sótano.
 *
 * ## Por qué un reenvío no duplica
 *
 * El índice único `(tenant, cliente, captured_at, modo)` lo impide, y la inserción va con
 * `ON CONFLICT DO NOTHING`. Un lote reenviado tras un timeout aporta cero filas nuevas y responde
 * `duplicated`, que es información útil —dice que el cliente reintenta— y no un error.
 *
 * ## Lo que NO se hace aquí
 *
 * Decidir. Este servicio guarda y mide la distancia; quién es sospechoso lo decide el motor con sus
 * artefactos. Meter un umbral aquí lo escondería en un servicio de ingesta, donde nadie lo versiona
 * ni lo revisa.
 */
@Injectable()
export class CustomerLocationTrackingService {
  private readonly logger = new Logger(CustomerLocationTrackingService.name);

  constructor(
    private readonly access: DeviceSignalsAccessService,
    private readonly pings: CustomerLocationPingsRepository,
    private readonly journal: DeviceSignalsJournalRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async ingest(input: {
    tenantId: string;
    customerId: string;
    body: LocationPingBatchDto;
    currentUser: AuthenticatedUser;
    ipAddress: string | null;
  }): Promise<LocationPingBatchView> {
    const contexto = await this.access.resolve({
      tenantId: input.tenantId,
      customerId: input.customerId,
      deviceId: input.body.deviceId,
      sessionId: input.body.sessionId,
      purposeCode: LOCATION_TRACKING_PURPOSE,
      currentUser: input.currentUser,
    });

    const declarado = await this.pings.findLatestDeclaredCoordinate(input.tenantId, input.customerId);
    const referencia =
      declarado && declarado.gpsLat !== null && declarado.gpsLng !== null
        ? { lat: Number(declarado.gpsLat), lng: Number(declarado.gpsLng) }
        : null;

    const now = new Date();
    const filas = input.body.pings.map((ping) => toRow(ping, { input, contexto, referencia, now }));

    const almacenados = await this.sequelize.transaction(async (transaction) => {
      const insertadas = await this.pings.bulkInsertIgnoringDuplicates(filas, { transaction });

      /*
       * La traza se escribe SÓLO si entró algo.
       *
       * Un reenvío completo no es una entrega: anotarlo llenaría la auditoría de filas que dicen que
       * se recibieron cero posiciones, y enterraría las que sí cuentan algo.
       */
      if (insertadas > 0) {
        const simuladas = filas.filter((fila) => fila.isMocked).length;
        await this.journal.createAuditLog(
          {
            tenantId: input.tenantId,
            actorType: input.currentUser.role,
            actorInternalUserId: input.currentUser.internalUserId ?? null,
            actionCode: 'customer_device_signals.location_ping_batch',
            targetType: 'customer',
            targetId: input.customerId,
            ipAddress: input.ipAddress,
            payloadJson: {
              consentId: contexto.consentId,
              received: filas.length,
              stored: insertadas,
              mockedCount: simuladas,
              backgroundCount: filas.filter((fila) => fila.captureMode === 'background').length,
            },
            occurredAt: now,
          },
          { transaction },
        );
      }

      return insertadas;
    });

    this.logger.log(
      `Ubicaciones del cliente ${input.customerId}: recibidas=${String(filas.length)} ` +
        `nuevas=${String(almacenados)} simuladas=${String(filas.filter((fila) => fila.isMocked).length)}.`,
    );

    return {
      customerId: input.customerId,
      received: filas.length,
      stored: almacenados,
      duplicated: filas.length - almacenados,
      receivedAt: now.toISOString(),
    };
  }
}
