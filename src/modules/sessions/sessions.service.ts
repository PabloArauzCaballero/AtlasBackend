/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza mantiene continuidad, seguridad y señales de uso durante la interacción del cliente.
 * @system orquesta inicio, heartbeat, cierre, ubicación, dispositivo y auditoría del ciclo de sesión.
 */
import { Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { EndSessionResponseDto, HeartbeatResponseDto } from './sessions.dtos.js';
import { SessionEndService } from './application/session-end.service.js';
import { SessionHeartbeatService } from './application/session-heartbeat.service.js';
import { SessionQueryService } from './application/session-query.service.js';
import { SessionStartService } from './application/session-start.service.js';
import { RequestContext } from './application/sessions.shared.js';
import { EndSessionDto, SessionHeartbeatDto, StartSessionDto } from './sessions.schemas.js';

@Injectable()
export class SessionsService {
  constructor(
    private readonly startService: SessionStartService,
    private readonly heartbeatService: SessionHeartbeatService,
    private readonly endService: SessionEndService,
    private readonly queryService: SessionQueryService,
  ) {}

  startSession(input: { customerId: string; body: StartSessionDto; currentUser: AuthenticatedUser; context: RequestContext }) {
    return this.startService.startSession(input);
  }

  heartbeat(input: {
    customerId: string;
    sessionId: string;
    body: SessionHeartbeatDto;
    currentUser: AuthenticatedUser;
    context: RequestContext;
  }): Promise<HeartbeatResponseDto> {
    return this.heartbeatService.heartbeat(input);
  }

  endSession(input: {
    customerId: string;
    sessionId: string;
    body: EndSessionDto;
    currentUser: AuthenticatedUser;
    context: RequestContext;
  }): Promise<EndSessionResponseDto> {
    return this.endService.endSession(input);
  }

  getSessionState(input: { tenantId: string; customerId: string; currentUser: AuthenticatedUser }) {
    return this.queryService.getSessionState(input);
  }

  getOperationsSessionSummary(input: { tenantId: string; sessionId: string; currentUser: AuthenticatedUser }) {
    return this.queryService.getOperationsSessionSummary(input);
  }
}
