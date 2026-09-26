/**
 * @file Servicio de aplicación: las consultas de lectura sobre comercios y sus cajas.
 * @business Deja que una pantalla de gastos diga dónde se compró, y que una solicitud recuerde en qué caja nació.
 * @system lecturas y cruces en memoria sobre el expediente; no toca su ciclo de vida.
 */
import { Injectable } from '@nestjs/common';
import { PartnerCommercialNetworkRepository } from '../partner-commercial-network.repository.js';
import { PartnerOnboardingRepository } from '../partner-onboarding.repository.js';

/**
 * Lo que se PREGUNTA sobre un comercio, separado de lo que le PASA.
 *
 * Vivía dentro de `PartnerProfileService`, que además abre el expediente, guarda su evidencia y
 * decide si es editable. Son dos cosas distintas: aquí no se escribe nada, y quien llama —los
 * créditos, el calendario, el informe de gastos— sólo quiere resolver nombres y cajas. Juntas
 * pasaban de las 300 líneas del gate y obligaban a leer el ciclo de vida entero para encontrar
 * un `Map`.
 *
 * `listOwnedBy` NO se movió aquí a propósito: la llama el controlador del autoservicio, que otra
 * sesión estaba editando al mismo tiempo. Mover una línea suya habría producido un conflicto por
 * una ganancia de catorce.
 */
@Injectable()
export class PartnerDirectoryService {
  constructor(
    private readonly repository: PartnerOnboardingRepository,
    private readonly network: PartnerCommercialNetworkRepository,
  ) {}

  /**
   * Cómo se llaman y de qué rubro son varios comercios, en una sola consulta.
   *
   * Lo que se devuelve es lo MÍNIMO que una pantalla del cliente necesita para reconocer dónde
   * compró: el nombre de la fachada y el rubro. Ni el NIT, ni el correo, ni el estado del
   * expediente — el cliente no es parte de la relación entre Atlas y ese comercio, y una pantalla
   * de gastos no es sitio para publicar la ficha de un tercero.
   *
   * Un identificador que no resuelve simplemente no aparece en el mapa: quien lo consulte decide
   * qué hacer con la ausencia, que en la práctica es agrupar esos créditos como «sin comercio».
   */
  /**
   * Los expedientes de este comercio, para que el portal sepa a cual entrar.
   *
   * Devuelve lo minimo con lo que la pantalla puede trabajar —identificador, nombre y estado—: el
   * detalle ya lo sirve `:partnerId/status`, y duplicarlo aqui solo daria dos formas distintas de
   * responder a la misma pregunta.
   */
  async listOwnedBy(
    tenantId: string,
    ownerMerchantUserId: string,
  ): Promise<{ partnerId: string; legalName: string | null; tradeName: string | null; status: string }[]> {
    const profiles = await this.repository.findProfilesByOwner(tenantId, ownerMerchantUserId);
    return profiles.map((profile) => ({
      partnerId: String(profile.id),
      legalName: profile.legalName ?? null,
      tradeName: profile.tradeName ?? null,
      status: profile.onboardingStatus,
    }));
  }

  async describeMany(
    tenantId: string,
    partnerIds: readonly string[],
  ): Promise<Map<string, { displayName: string; businessCategory: string | null }>> {
    const profiles = await this.repository.findProfilesByIds(tenantId, partnerIds);
    return new Map(
      profiles.map((profile) => [
        String(profile.id),
        { displayName: profile.tradeName ?? profile.legalName, businessCategory: profile.businessCategory ?? null },
      ]),
    );
  }

  /**
   * Resuelve un terminal del comercio por su id, comprobando que sea DE ESTE comercio.
   *
   * Lo usa el alta de solicitud: el cliente trae el id del terminal que resolvió al escanear, y hay
   * que atarlo a la compra sin dar por bueno que pertenezca a quien dice. Devuelve `null` si no
   * existe o es de otro comercio —ahí la compra simplemente no recuerda la caja, que es mejor que
   * atribuirla a una equivocada—.
   */
  async findOwnedTerminal(tenantId: string, partnerId: string, terminalId: string) {
    return this.network.findPosById(tenantId, partnerId, terminalId);
  }

  /**
   * Un índice terminalId -> {sucursal, caja} para todos los terminales del comercio.
   *
   * Se hace en dos consultas (terminales y sucursales del comercio) y se cruza en memoria, para no
   * pegarle a la base una vez por cada solicitud del listado. Con él, la pantalla del comercio puede
   * decir en qué local nació cada compra sin exponer nada del cliente.
   */
  async terminalDirectory(tenantId: string, partnerId: string) {
    const [terminales, sucursales] = await Promise.all([
      this.network.listPosTerminals(tenantId, partnerId),
      this.network.listBranches(tenantId, partnerId),
    ]);
    const branchById = new Map(sucursales.map((b) => [String(b.id), b]));
    const map = new Map<
      string,
      { branchId: string; branchName: string; branchCode: string; terminalAlias: string | null; terminalSerial: string }
    >();
    for (const t of terminales) {
      const branch = branchById.get(String(t.branchId));
      map.set(String(t.id), {
        branchId: String(t.branchId),
        branchName: branch?.name ?? '',
        branchCode: branch?.branchCode ?? '',
        terminalAlias: t.terminalAlias,
        terminalSerial: t.terminalSerial,
      });
    }
    return map;
  }
}
