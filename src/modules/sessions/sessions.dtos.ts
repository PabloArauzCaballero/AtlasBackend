/**
 * @file DTOs: contrato estable de salida sin filtrar modelos de persistencia.
 * @business Esta pieza mantiene continuidad, seguridad y señales de uso durante la interacción del cliente.
 * @system orquesta inicio, heartbeat, cierre, ubicación, dispositivo y auditoría del ciclo de sesión.
 */
export type SessionGpsResult = {
  gpsObservationId: string | null;
  gpsObservationCreated: boolean;
  gpsObservationSkippedReason: string | null;
};

export type StartSessionResponseDto = {
  customerId: string;
  sessionId: string;
  deviceId: string;
  sessionStatus: string;
  gpsObservationId: string | null;
  gpsObservationCreated: boolean;
  gpsObservationSkippedReason: string | null;
  deviceTrustLevel: string | null;
  nextStep: string;
};

export type HeartbeatResponseDto = {
  sessionId: string;
  status: 'accepted';
  gpsObservationCreated: boolean;
  gpsObservationId: string | null;
  gpsObservationSkippedReason: string | null;
  riskSignalsCreated: number;
};

export type EndSessionResponseDto = {
  sessionId: string;
  sessionStatus: string;
  endedAt: string;
};
