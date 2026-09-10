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
    const porCliente: Record<string, { total: number; verified: number; unverified: number }> = {};
    const sinCatalogar: string[] = [];
    let conTrafico = 0;

    for (const clientCode of await this.repository.screenClients()) {
      const pantallas = await this.repository.screensOfClient(clientCode);
      // Sólo lo que ESE cliente declaró: `/` existe en los cinco portales y `/login` en tres, así
      // que cruzar el tráfico de todos contra las plantillas de cada uno marcaría verificadas las
      // cinco de golpe y copiaría en todas las llamadas del único que se usó.
      const suyo = observado.get(clientCode) ?? new Map();
      const { porPlantilla, sinCatalogar: suyasSinCatalogar } = matchScreenRuns(
        suyo,
        pantallas.map((pantalla) => pantalla.route),
      );
      sinCatalogar.push(...suyasSinCatalogar.map((ruta) => `${clientCode} ${ruta}`));
      conTrafico += porPlantilla.size;
      porCliente[clientCode] = { total: pantallas.length, verified: 0, unverified: 0 };

      for (const pantalla of pantallas) {
        const outcome = screenVerificationFrom(porPlantilla.get(pantalla.route) ?? null);
        // Una pantalla que dejó de usarse VUELVE a UNVERIFIED. Sin esto, el eje sólo sabía avanzar:
        // el catálogo acumulaba «verificadas» para siempre mientras la respuesta de la corrida decía
        // otra cosa, y nadie podía notar que una pantalla lleva medio año sin abrirse.
        await this.repository.applyScreenVerification(
          clientCode,
          pantalla.route,
          outcome ?? { verification: 'UNVERIFIED', lastSeenAt: null, observed: {} },
          tx,
        );
        porCliente[clientCode][outcome ? 'verified' : 'unverified'] += 1;
      }
    }

    // Un tráfico sin cliente declarado no se atribuye a nadie: se cuenta aparte para que se vea.
    const anonimo = observado.get('(sin cliente)')?.size ?? 0;
    return {
      // Pantallas DEL CATÁLOGO con tráfico en la ventana. Contar las rutas concretas observadas
      // daría un número mayor que el catálogo entero en cuanto una pantalla lleve identificador.
      screensWithRuns: conTrafico,
      screensWithoutClient: anonimo,
      byClient: porCliente,
      uncatalogued: sinCatalogar.slice(0, 20),
    };
  }
}
