/**
 * @file Caso de uso de dominio: orquesta reglas y persistencia.
 * @business Esta pieza dice qué pantallas del ecosistema se usan de verdad, y contra qué llaman.
 * @system cruza el catálogo de pantallas con el origen declarado en las corridas reales.
 */
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'sequelize';
import { SystemFlowsScreensRepository } from './system-flows.screens.repository.js';
import { VerifyFlowsDto } from './system-flows.schemas.js';
import { matchScreenRuns, screenVerificationFrom } from './system-flows.verification.util.js';

@Injectable()
export class SystemFlowsScreensService {
  constructor(private readonly repository: SystemFlowsScreensRepository) {}

  /**
   * Verifica las PANTALLAS contra lo que de verdad se hizo desde ellas.
   *
   * ## Por qué cuelga de la verificación del Backend y no de la de cada bloque
   *
   * Porque la evidencia vive aquí: `origin_screen` lo escribe el interceptor de ESTE backend con lo
   * que el cliente declara en `x-atlas-flow`. Una pantalla del portal del ERP que sólo llama al ERP
   * no deja rastro en `system_action_logs`, y por eso el resultado se devuelve por cliente: para que
   * «0 verificadas» se lea como «ese cliente aún no declara su origen» y no como «nadie las usa».
   *
   * ## Qué NO se hace aquí
   *
   * No se marca ninguna pantalla como rota. Lo que falla es el endpoint, que ya tiene su eje y su
   * ficha; una pantalla que llama a algo roto hace su trabajo y enseña el error. Duplicar ese
   * hallazgo en dos sitios con dos dueños distintos sería peor que no tenerlo.
   */
  async verify(dto: VerifyFlowsDto, tx: Transaction) {
    if (dto.systemCode !== 'ATLAS_BACKEND') return undefined;
    const observado = await this.repository.screenRuns(dto.windowDays);
    const porCliente: Record<string, { total: number; verified: number }> = {};
    for (const clientCode of await this.repository.screenClients()) {
      const pantallas = await this.repository.screensOfClient(clientCode);
      const { porPlantilla } = matchScreenRuns(
        observado,
        pantallas.map((pantalla) => pantalla.route),
      );
      porCliente[clientCode] = { total: pantallas.length, verified: 0 };
      for (const pantalla of pantallas) {
        const outcome = screenVerificationFrom(porPlantilla.get(pantalla.route) ?? null);
        if (!outcome) continue;
        await this.repository.applyScreenVerification(clientCode, pantalla.route, outcome, tx);
        porCliente[clientCode].verified += 1;
      }
    }
    // Lo que no encajó en NINGÚN cliente: alguien usó una ruta que el catálogo no conoce. Se cruza
    // contra todas las plantillas juntas para no llamar «desconocida» a una pantalla de otro portal.
    const todas = (await Promise.all(Object.keys(porCliente).map((code) => this.repository.screensOfClient(code)))).flat();
    const { sinCatalogar } = matchScreenRuns(
      observado,
      todas.map((pantalla) => pantalla.route),
    );
    return { screensWithRuns: observado.size, byClient: porCliente, uncatalogued: sinCatalogar.slice(0, 20) };
  }
}
