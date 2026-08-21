/**
 * @file Servicio de aplicación o dominio: ejecuta reglas y coordina dependencias.
 * @business Esta pieza convierte un comercio declarado en un partner verificable, con locales, cobro y terminales trazables.
 * @system registra los locales del partner y los terminales de cobro que operan en cada uno.
 */
import { ConflictException, Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { MetricsService } from '../../../common/observability/metrics.service.js';
import { PartnerBranchModel, PartnerPosTerminalModel } from '../../../database/models/index.js';
import { PartnerOnboardingRepository } from '../partner-onboarding.repository.js';
import { PosTerminalStatusDto, RegisterBranchDto, RegisterPosTerminalDto } from '../partner-onboarding.schemas.js';
import { PartnerProfileService } from './partner-profile.service.js';

/**
 * Los locales del comercio y los terminales que cobran en ellos.
 *
 * El POS cuelga de la SUCURSAL y no del comercio, y esa es la decisión que sostiene todo lo demás:
 * un terminal está físicamente en un sitio, y colgarlo del comercio haría imposible responder «¿en
 * qué local se hizo este cobro?», que es la primera pregunta de cualquier investigación de fraude
 * presencial.
 */
@Injectable()
export class PartnerCommerceService {
  private readonly logger = new Logger(PartnerCommerceService.name);

  constructor(
    private readonly repository: PartnerOnboardingRepository,
    private readonly profiles: PartnerProfileService,
    private readonly metrics: MetricsService,
  ) {}

  async registerBranch(tenantId: string, partnerId: string, dto: RegisterBranchDto): Promise<PartnerBranchModel> {
    const profile = await this.profiles.requireProfile(tenantId, partnerId);
    this.profiles.assertEditable(profile);

    const existing = await this.repository.listBranches(tenantId, partnerId);
    if (existing.some((branch) => branch.branchCode === dto.branchCode)) {
      this.metrics.recordPartnerOnboardingStep({ step: 'branch', outcome: 'rejected' });
      throw new ConflictException('BRANCH_CODE_ALREADY_REGISTERED');
    }

    const branch = await this.repository.createBranch({
      tenantId,
      partnerProfileId: partnerId,
      branchCode: dto.branchCode,
      name: dto.name,
      addressLine: dto.addressLine ?? null,
      city: dto.city ?? null,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      erpBranchId: dto.erpBranchId ?? null,
    });

    this.metrics.recordPartnerOnboardingStep({ step: 'branch', outcome: 'ok' });
    this.logger.log(`Sucursal de partner registrada: partnerId=${partnerId} sucursal=${branch.branchCode}`);
    return branch;
  }

  listBranches(tenantId: string, partnerId: string): Promise<PartnerBranchModel[]> {
    return this.repository.listBranches(tenantId, partnerId);
  }

  /**
   * Da de alta un terminal en una sucursal.
   *
   * El serial se comprueba contra TODO el tenant y no sólo contra esta sucursal: mover un POS de
   * local es normal, pero que el mismo serial esté vivo en dos sitios a la vez no lo es —sería la
   * forma más simple de duplicar cobros sin que nada lo delate—. La base lo impide con un índice
   * único parcial; aquí se comprueba antes para poder explicar el choque en vez de devolver un
   * error de restricción que nadie sabe leer.
   */
  async registerPosTerminal(
    tenantId: string,
    partnerId: string,
    branchId: string,
    dto: RegisterPosTerminalDto,
  ): Promise<PartnerPosTerminalModel> {
    const profile = await this.profiles.requireProfile(tenantId, partnerId);
    this.profiles.assertEditable(profile);

    const branch = await this.repository.findBranchById(tenantId, partnerId, branchId);
    if (!branch) throw new NotFoundException('La sucursal no pertenece a este partner.');

    const duplicate = await this.repository.findPosBySerial(tenantId, dto.terminalSerial);
    if (duplicate) {
      this.metrics.recordPartnerOnboardingStep({ step: 'pos_terminal', outcome: 'rejected' });
      // En el mensaje: el filtro global publica sólo `{ code genérico, message }`, así que la
      // sucursal donde ya está ese serial se perdería si viajara en un campo aparte — y es el dato
      // que convierte el rechazo en algo accionable.
      throw new ConflictException(`POS_SERIAL_ALREADY_REGISTERED: el serial ya está activo en la sucursal ${duplicate.branchId}.`);
    }

    const terminal = await this.repository.createPosTerminal({
      tenantId,
      partnerProfileId: partnerId,
      branchId: branch.id,
      terminalSerial: dto.terminalSerial,
      terminalAlias: dto.terminalAlias ?? null,
      provider: dto.provider ?? null,
      model: dto.model ?? null,
    });

    this.metrics.recordPartnerOnboardingStep({ step: 'pos_terminal', outcome: 'ok' });
    this.logger.log(`Terminal de partner registrado: partnerId=${partnerId} sucursal=${branch.branchCode} terminal=${terminal.id}`);
    return terminal;
  }

  listPosTerminals(tenantId: string, partnerId: string): Promise<PartnerPosTerminalModel[]> {
    return this.repository.listPosTerminals(tenantId, partnerId);
  }

  /**
   * Cambia el estado de un terminal.
   *
   * No exige que el expediente sea editable, y es deliberado: **suspender un terminal es una
   * medida de contención**. Si sólo se pudiera hacer sobre expedientes en borrador, un comercio ya
   * aprobado —que es justamente el que puede cobrar— no podría frenar un equipo perdido.
   */
  async changePosStatus(
    tenantId: string,
    partnerId: string,
    terminalId: string,
    dto: PosTerminalStatusDto,
  ): Promise<PartnerPosTerminalModel> {
    await this.profiles.requireProfile(tenantId, partnerId);
    const terminal = await this.repository.findPosById(tenantId, partnerId, terminalId);
    if (!terminal) throw new NotFoundException('Terminal no encontrado para este partner.');

    // El estado ANTERIOR se captura antes de escribir: `update()` de Sequelize muta la instancia,
    // así que leerlo después registraría «de=active a=active» y la traza perdería justo el dato
    // por el que existe.
    const previousStatus = terminal.status;
    const updated = await this.repository.updatePosStatus(terminal, dto.status);
    this.logger.log(
      `Terminal de partner cambió de estado: partnerId=${partnerId} terminal=${terminalId} ` + `de=${previousStatus} a=${dto.status}`,
    );
    return updated;
  }

  /**
   * Resuelve el QR de Atlas que el cliente escanea en la caja.
   *
   * Es la contraparte servidor de una pantalla que hasta ahora resolvía sola: la app leía el token y
   * decidía en el teléfono de qué comercio era. Un identificador de comercio que decide el
   * dispositivo no identifica a nadie —basta editar la respuesta local para comprar «en» cualquier
   * comercio—, y además es el dato del que después cuelga la categoría del gasto.
   *
   * ## Los códigos de rechazo son los que la app ya sabe explicar
   *
   * `QR_NOT_RECOGNIZED`, `QR_REVOKED` y `QR_EXPIRED` son los tres que la pantalla de escaneo ya
   * traduce a un mensaje con salida —«pide al comercio el código vigente»—. Inventar aquí un código
   * nuevo dejaría al cliente ante un error sin texto, así que el servidor se ajusta al vocabulario
   * que la app ya tiene, no al revés.
   *
   * Un terminal RETIRADO se da de baja para siempre —«revocado»—. Los demás estados que no cobran
   * caen en «vencido»: el SUSPENDIDO, que puede volver, y el REGISTRADO, que es el estado inicial y
   * todavía no se activó. Para el cliente parado en la caja los tres se resuelven igual —pedir el
   * código vigente— y detallar cuál es contaría el estado interno del comercio a un desconocido.
   *
   * Que un terminal recién dado de alta NO sirva es deliberado: `registered` es el estado por
   * defecto y activarlo es un acto explícito del comercio. Cobrar con un equipo que nadie activó es
   * exactamente lo que pasa con un terminal robado antes de que se note.
   *
   * ## Por qué el expediente tiene que estar aprobado
   *
   * Un comercio con expediente a medias puede tener terminales registrados —se dan de alta en el
   * borrador—, y dejar comprar ahí sería financiar una operación cuyo destinatario nadie verificó.
   * Se rechaza como «no reconocido»: para el cliente en la caja no hay diferencia entre un QR falso
   * y uno de un comercio que aún no está habilitado, y detallar cuál es revelaría el estado del
   * expediente de un tercero a quien sólo pasaba por ahí.
   */
  async resolveMerchantQr(
    tenantId: string,
    token: string,
  ): Promise<{
    partnerProfileId: string;
    branchId: string;
    posTerminalId: string;
    displayName: string;
    businessCategory: string | null;
    verified: true;
  }> {
    const terminal = await this.repository.findPosBySerial(tenantId, token);
    if (!terminal) throw new NotFoundException('QR_NOT_RECOGNIZED');
    if (terminal.status === 'retired') throw new UnprocessableEntityException('QR_REVOKED');
    if (terminal.status !== 'active') throw new UnprocessableEntityException('QR_EXPIRED');

    const profile = await this.repository.findProfileById(tenantId, terminal.partnerProfileId);
    if (!profile || profile.onboardingStatus !== 'approved') throw new NotFoundException('QR_NOT_RECOGNIZED');

    this.logger.log(`QR de comercio resuelto: partnerId=${profile.id} terminal=${terminal.id}`);

    return {
      partnerProfileId: profile.id,
      branchId: terminal.branchId,
      posTerminalId: terminal.id,
      // El nombre comercial es el que está en la fachada; el legal sólo aparece si no hay otro.
      displayName: profile.tradeName ?? profile.legalName,
      businessCategory: profile.businessCategory ?? null,
      verified: true,
    };
  }
}
