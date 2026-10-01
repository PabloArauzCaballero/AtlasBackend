import { Op } from 'sequelize';
import type { ExpedienteModel, ExpedienteNodoModel } from '../../../database/models/index.js';

export interface ConsultaPorMomento {
  tenantId: string;
  subjectType: string;
  desde: Date;
  hasta: Date;
  limite: number;
}

/**
 * Expedientes que recibieron imágenes del alta dentro de una ventana de tiempo.
 *
 * Es la única unión posible para un caso del Motor anterior a que su `requestId` llevara al
 * cliente: la verificación se ejecuta segundos después de subirse el carnet, y el hash que el
 * Motor guarda es un HMAC con secreto, no comparable con el `sha256` del archivo. El resultado son
 * CANDIDATOS por coincidencia de hora, no una identificación.
 */
export async function buscarPorMomento(
  nodos: typeof ExpedienteNodoModel,
  expedientes: typeof ExpedienteModel,
  input: ConsultaPorMomento,
): Promise<Array<{ expediente: ExpedienteModel; imagenes: ExpedienteNodoModel[] }>> {
  const encontrados = await nodos.findAll({
    where: {
      tenantId: input.tenantId,
      tipo: 'archivo',
      origen: 'onboarding',
      borradoEn: null,
      mimeType: { [Op.like]: 'image/%' },
      createdAtValue: { [Op.between]: [input.desde, input.hasta] },
    },
    order: [['created_at', 'ASC']],
    limit: 200,
  });
  const porExpediente = new Map<string, ExpedienteNodoModel[]>();
  for (const nodo of encontrados) {
    porExpediente.set(nodo.expedienteId, [...(porExpediente.get(nodo.expedienteId) ?? []), nodo]);
  }
  if (!porExpediente.size) return [];
  const filas = await expedientes.findAll({
    where: {
      tenantId: input.tenantId,
      subjectType: input.subjectType,
      id: { [Op.in]: [...porExpediente.keys()] },
    },
    limit: input.limite,
  });
  return filas.map((expediente) => ({ expediente, imagenes: porExpediente.get(expediente.id) ?? [] }));
}
