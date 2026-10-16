/**
 * @file Servicio de aplicación: lee el nombre legal del cliente para exigirlo como titular del extracto.
 * @business El extracto tiene que ser de una cuenta del cliente que lo sube (Pablo, 2026-10-16).
 * @system lee la versión vigente del perfil (nombres y apellidos) o, sin ella, el nombre que leyó el OCR del carnet.
 */
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { FindOptions, Op } from 'sequelize';
import { CustomerIdentityDocumentModel, CustomerProfileVersionModel } from '../../../database/models/index.js';
import type { ExpectedHolder } from '../../decision-engine/bank-statement-engine.client.js';

/**
 * El titular que se exige, y SÓLO eso: es el único dato del cliente que viaja al motor con el extracto.
 *
 * Primero el perfil vigente, porque separa nombres de apellidos y con eso la regla del motor («un nombre y un
 * apellido en algún titular») no confunde un apellido con un segundo nombre. Sin perfil, el nombre del carnet
 * tal como lo leyó el OCR. Sin ninguno, `null`: no se exige titular —mejor que exigir uno inventado—.
 */
@Injectable()
export class StatementExpectedHolderService {
  constructor(
    @InjectModel(CustomerProfileVersionModel) private readonly profiles: typeof CustomerProfileVersionModel,
    @InjectModel(CustomerIdentityDocumentModel) private readonly documents: typeof CustomerIdentityDocumentModel,
  ) {}

  async expectedFor(tenantId: string, customerId: string): Promise<ExpectedHolder | null> {
    const profile = await this.profiles.findOne({
      where: { tenantId, customerId, validUntil: null },
      order: [['_created_at', 'DESC']],
    } as FindOptions);
    const holder = expectedHolderFrom(profile?.firstName ?? null, profile?.lastName ?? null);
    if (holder) return holder;

    const document = await this.documents.findOne({
      where: { tenantId, customerId, ocrFullName: { [Op.ne]: null } },
      order: [['_created_at', 'DESC']],
    } as FindOptions);
    return expectedHolderFrom(null, null, document?.ocrFullName ?? null);
  }
}

/** Del registro al titular exigido. Pura para poder probarla. */
export function expectedHolderFrom(
  givenNames: string | null,
  surnames: string | null,
  fullName: string | null = null,
): ExpectedHolder | null {
  const given = givenNames?.trim() || null;
  const last = surnames?.trim() || null;
  if (given && last) return { name: `${given} ${last}`, givenNames: given, surnames: last };
  const whole = fullName?.trim() || [given, last].filter(Boolean).join(' ').trim();
  return whole ? { name: whole, givenNames: null, surnames: null } : null;
}
