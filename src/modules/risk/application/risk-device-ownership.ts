/**
 * @file Comprobación de que el dispositivo y la sesión de una evaluación son del cliente evaluado.
 * @business Quien manda un dispositivo ajeno no puede subir su puntaje de dispositivo ni dejar la corrida apuntando a otra persona.
 * @system consulta la propiedad por el repositorio y falla con 422 sin escribir nada.
 */
import { UnprocessableEntityException } from '@nestjs/common';
import type { RiskRepository } from '../risk.repository.js';
import type { CreateRiskAssessmentDto } from '../risk.schemas.js';

/**
 * El dispositivo y la sesión del cuerpo suben el puntaje de dispositivo y quedan escritos en la
 * corrida: quien los manda no puede apuntar a los de otra persona. Las evaluaciones que dispara
 * el servidor (alta) ya traen un vínculo propio y pasan sin más.
 */
export async function assertOwnDeviceReferences(
  riskRepository: Pick<RiskRepository, 'findOwnedDeviceReferences'>,
  input: { tenantId: string; customerId: string; body: CreateRiskAssessmentDto },
): Promise<void> {
  const { deviceId, sessionId } = input.body;
  if (!deviceId && !sessionId) return;
  const owned = await riskRepository.findOwnedDeviceReferences(input.tenantId, input.customerId, { deviceId, sessionId });
  if (!owned.deviceOwned) throw new UnprocessableEntityException('RISK_DEVICE_NOT_OWNED_BY_CUSTOMER');
  if (!owned.sessionOwned) throw new UnprocessableEntityException('RISK_SESSION_NOT_OWNED_BY_CUSTOMER');
}
