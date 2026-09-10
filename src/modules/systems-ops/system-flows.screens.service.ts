/**
 * @file Caso de uso de dominio: orquesta reglas y persistencia.
 * @business Esta pieza dice qué pantallas del ecosistema se usan de verdad, y contra qué llaman.
 * @system cruza el catálogo de pantallas con el origen declarado en las corridas reales.
 */
import { Injectable } from '@nestjs/common';
import type { Transaction } from 'sequelize';
import { SystemFlowsScreensRepository } from './system-flows.screens.repository.js';
import { VerifyFlowsDto } from './system-flows.schemas.js';
import { SIN_CLIENTE } from './system-flows.screens.repository.js';
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
    const { porCliente: observado, truncado } = await this.repository.screenRuns(dto.windowDays);
    const clientes = await this.repository.screenClients();
    const resumen: Record<string, { total: number; verified: number }> = {};
    const sinCatalogar: string[] = [];
    let conTrafico = 0;

    for (const clientCode of clientes) {
      const pantallas = await this.repository.screensOfClient(clientCode);
      // Sólo lo que ESE cliente declaró: `/` existe en los cinco portales y `/login` en tres, así
      // que cruzar el tráfico de todos contra las plantillas de cada uno marcaría verificadas las
      // cinco de golpe y copiaría en todas las llamadas del único que se usó.
      const { porPlantilla, sinCatalogar: suyas } = matchScreenRuns(
        observado.get(clientCode) ?? new Map(),
        pantallas.map((pantalla) => pantalla.route),
      );
      sinCatalogar.push(...suyas.map((ruta) => `${clientCode} ${ruta}`));
      conTrafico += porPlantilla.size;
      resumen[clientCode] = { total: pantallas.length, verified: porPlantilla.size };

      for (const [route, runs] of porPlantilla) {
        const outcome = screenVerificationFrom(runs);
        if (outcome) await this.repository.applyScreenVerification(clientCode, route, outcome, tx);
      }
      // Y las que NO aparecieron vuelven a UNVERIFIED —salvo que la consulta viniera cortada, en cuyo
      // caso no se sabe si faltan por no usarse o por el tope, y degradar sería inventarse un dato—.
      if (!truncado) await this.repository.resetScreensNotSeen(clientCode, [...porPlantilla.keys()], tx);
    }

    // Clientes que declararon origen y NO están en el catálogo de pantallas. Es el desajuste que más
    // fácil pasa desapercibido: `x-atlas-product` la mandan también backends («erp», «flows-loader»)
    // con otro vocabulario, y su tráfico se quedaba sin atribuir sin que nada lo dijera.
    const desconocidos = [...observado.keys()].filter((code) => code !== SIN_CLIENTE && !clientes.includes(code));

    return {
      // Pantallas DEL CATÁLOGO con tráfico. Contar rutas concretas daba un número mayor que el
      // catálogo entero en cuanto una pantalla lleva identificador.
      screensWithRuns: conTrafico,
      screensWithoutClient: observado.get(SIN_CLIENTE)?.size ?? 0,
      unknownClients: desconocidos.slice(0, 10),
      truncated: truncado,
      byClient: resumen,
      uncatalogued: sinCatalogar.slice(0, 20),
    };
  }
}
