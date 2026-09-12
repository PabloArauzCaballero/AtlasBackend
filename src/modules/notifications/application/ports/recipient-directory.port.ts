/**
 * @file Puerto de directorio de destinatarios (AT-020): reexporta el contrato de plataforma.
 * @business Mensajería pregunta si un cliente tiene contacto vigente para un canal; Clientes responde.
 * @system El contrato vive en `src/platform/contracts/recipient-directory.ts` para no crear dependencia
 *   entre los dos módulos; aquí sólo se le da el nombre con el que Mensajería lo consume.
 */
export {
  RECIPIENT_DIRECTORY_PORT,
  type RecipientDirectoryPort,
  type RecipientLookup,
  type RecipientResolution,
} from '../../../../platform/contracts/recipient-directory.js';
