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
