/**
 * Plantillas transaccionales de ATLAS en MailSender. El conector las auto-provisiona por nombre
 * (`MailSenderClient.ensureTemplateId`): si la plantilla no existe en la instancia de MailSender
 * configurada, se crea con esta definición usando el JWT administrativo. Editar una plantilla ya
 * creada se hace en MailSender (fuente de verdad en runtime); esta definición es solo el estado
 * inicial.
 */

export type MailTemplateName = 'atlas-password-reset' | 'atlas-login-pin' | 'atlas-credenciales-iniciales';

export type MailTemplateDefinition = {
  nombre: MailTemplateName;
  descripcion: string;
  emailAsunto: string;
  emailHtmlBody: string;
  emailTextBody: string;
  variablesRequeridas: readonly string[];
};

export const MAIL_TEMPLATE_DEFINITIONS: Record<MailTemplateName, MailTemplateDefinition> = {
  'atlas-password-reset': {
    nombre: 'atlas-password-reset',
    descripcion: 'Código de un solo uso para restablecer la contraseña de un usuario ATLAS.',
    emailAsunto: 'ATLAS — Código para restablecer tu contraseña',
    emailHtmlBody:
      '<p>Hola {{nombre}},</p>' +
      '<p>Recibimos una solicitud para restablecer tu contraseña en ATLAS. Usa este código para continuar:</p>' +
      '<p style="font-size:24px;font-weight:bold;letter-spacing:4px">{{codigo}}</p>' +
      '<p>El código vence en {{minutos}} minutos y solo puede usarse una vez.</p>' +
      '<p>Si no solicitaste este cambio, ignora este correo: tu contraseña actual sigue vigente.</p>',
    emailTextBody:
      'Hola {{nombre}},\n\n' +
      'Recibimos una solicitud para restablecer tu contraseña en ATLAS. Usa este código para continuar: {{codigo}}\n\n' +
      'El código vence en {{minutos}} minutos y solo puede usarse una vez.\n' +
      'Si no solicitaste este cambio, ignora este correo: tu contraseña actual sigue vigente.',
    variablesRequeridas: ['nombre', 'codigo', 'minutos'],
  },
  'atlas-login-pin': {
    nombre: 'atlas-login-pin',
    descripcion: 'PIN de verificación adicional para el login de administradores ATLAS.',
    emailAsunto: 'ATLAS — Tu PIN de acceso',
    emailHtmlBody:
      '<p>Hola {{nombre}},</p>' +
      '<p>Detectamos un inicio de sesión de administrador en ATLAS. Ingresa este PIN para completar el acceso:</p>' +
      '<p style="font-size:24px;font-weight:bold;letter-spacing:4px">{{pin}}</p>' +
      '<p>El PIN vence en {{minutos}} minutos y solo puede usarse una vez.</p>' +
      '<p>Si no fuiste tú, cambia tu contraseña de inmediato.</p>',
    emailTextBody:
      'Hola {{nombre}},\n\n' +
      'Detectamos un inicio de sesión de administrador en ATLAS. Ingresa este PIN para completar el acceso: {{pin}}\n\n' +
      'El PIN vence en {{minutos}} minutos y solo puede usarse una vez.\n' +
      'Si no fuiste tú, cambia tu contraseña de inmediato.',
    variablesRequeridas: ['nombre', 'pin', 'minutos'],
  },
  'atlas-credenciales-iniciales': {
    nombre: 'atlas-credenciales-iniciales',
    descripcion: 'Contraseña por defecto entregada al crear un usuario interno de ATLAS.',
    emailAsunto: 'ATLAS — Tu cuenta fue creada',
    emailHtmlBody:
      '<p>Hola {{nombre}},</p>' +
      '<p>Se creó una cuenta para ti en el panel interno de ATLAS.</p>' +
      '<p>Usuario: <strong>{{email}}</strong><br/>Contraseña temporal: <strong>{{password}}</strong></p>' +
      '<p>Por seguridad, deberás cambiar esta contraseña en tu primer inicio de sesión.</p>',
    emailTextBody:
      'Hola {{nombre}},\n\n' +
      'Se creó una cuenta para ti en el panel interno de ATLAS.\n\n' +
      'Usuario: {{email}}\nContraseña temporal: {{password}}\n\n' +
      'Por seguridad, deberás cambiar esta contraseña en tu primer inicio de sesión.',
    variablesRequeridas: ['nombre', 'email', 'password'],
  },
};
