/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza preserva la fuente de verdad y la evidencia histórica que soportan decisiones y cumplimiento.
 * @system agrupa los modelos del expediente del partner para registrarlos como un bloque.
 */
import {
  PartnerBranchModel,
  PartnerLegalRepresentativeModel,
  PartnerPosTerminalModel,
  PartnerProfileModel,
  PartnerQrCodeModel,
} from './models/index.js';

/**
 * Los cinco modelos del expediente del comercio (ADR-0009), como un bloque.
 *
 * Mismo motivo que `CREDIT_RATING_MODELS`: `sequelize.module.ts` nombra cada modelo dos veces
 * —import y registro— y cinco tablas más lo empujaban por encima del gate de tamaño. Agrupar dice
 * además algo cierto: el QR y los terminales no significan nada sin el perfil del que cuelgan, y
 * el perfil sin ellos no prueba con qué cobra el comercio. Se registran juntos o no se registra
 * ninguno.
 *
 * **Van en la instancia de Sequelize y no sólo en el `forFeature` del módulo.** Sin esto el código
 * compila y falla en la primera consulta con «Model not initialized», un error que señala al
 * repositorio y no al registro — lo descubrió levantar la API, no el type-check.
 */
export const PARTNER_MODELS = [
  PartnerProfileModel,
  PartnerLegalRepresentativeModel,
  PartnerBranchModel,
  PartnerQrCodeModel,
  PartnerPosTerminalModel,
] as const;
