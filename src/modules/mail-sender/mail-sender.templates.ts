/**
 * Plantillas transaccionales de ATLAS en MailSender. El conector las auto-provisiona por nombre
 * (`MailSenderClient.ensureTemplateId`): si la plantilla no existe en la instancia de MailSender
 * configurada, se crea con esta definición usando el JWT administrativo. Editar una plantilla ya
 * creada se hace en MailSender (fuente de verdad en runtime); esta definición es solo el estado
 * inicial.
 *
 * El HTML lo compone `mail-layout.ts`, que pone el membrete, la tipografía y el color de ATLAS.
 * Aquí queda sólo lo que cambia entre un correo y otro: qué se dice y en qué orden. Ese reparto es
 * lo que evita cinco copias del mismo membrete separándose a la primera vez que alguien retoca una.
 */
import { atlasMailShell, mailCode, mailField, mailNotice, mailParagraph } from './mail-layout.js';

export type MailTemplateName =
  'atlas-password-reset' | 'atlas-password-change' | 'atlas-login-pin' | 'atlas-credenciales-iniciales' | 'atlas-verificacion-contacto';

export type MailTemplateDefinition = {
  nombre: MailTemplateName;
  descripcion: string;
  emailAsunto: string;
  emailHtmlBody: string;
  emailTextBody: string;
  variablesRequeridas: readonly string[];
};

/** Vigencia del código, escrita igual en los cinco correos. */
const VIGENCIA = 'El código vence en {{minutos}} minutos y solo puede usarse una vez.';

export const MAIL_TEMPLATE_DEFINITIONS: Record<MailTemplateName, MailTemplateDefinition> = {
  'atlas-password-reset': {
    nombre: 'atlas-password-reset',
    descripcion: 'Código de un solo uso para restablecer la contraseña de un usuario ATLAS.',
    emailAsunto: 'ATLAS — Código para restablecer tu contraseña',
    emailHtmlBody: atlasMailShell({
      preheader: 'Tu código de un solo uso para restablecer la contraseña.',
      eyebrow: 'Seguridad de la cuenta',
      title: 'Restablece tu contraseña',
      blocks: [
        mailParagraph('Hola {{nombre}},'),
        mailParagraph('Recibimos una solicitud para restablecer tu contraseña en ATLAS. Usa este código para continuar:'),
        mailCode('{{codigo}}'),
        mailParagraph(VIGENCIA),
        mailNotice('Si no solicitaste este cambio, ignora este correo: tu contraseña actual sigue vigente.'),
      ],
    }),
    emailTextBody:
      'Hola {{nombre}},\n\n' +
      'Recibimos una solicitud para restablecer tu contraseña en ATLAS. Usa este código para continuar: {{codigo}}\n\n' +
      'El código vence en {{minutos}} minutos y solo puede usarse una vez.\n' +
      'Si no solicitaste este cambio, ignora este correo: tu contraseña actual sigue vigente.',
    variablesRequeridas: ['nombre', 'codigo', 'minutos'],
  },
  // Plantilla propia y no la de reset: quien pide este código YA está dentro de su sesión, así que
  // el aviso que importa es el contrario. En el reset, "si no fuiste tú, ignora este correo" basta
  // porque sin el código no pasa nada; aquí, que llegue sin haberlo pedido significa que alguien
  // tiene la sesión Y la contraseña actual, y el consejo correcto es cerrar sesión en todos los
  // dispositivos y avisar. Reusar la plantilla de reset habría dado el consejo equivocado.
  'atlas-password-change': {
    nombre: 'atlas-password-change',
    descripcion: 'Código de un solo uso para confirmar el cambio de contraseña de un usuario ATLAS ya autenticado.',
    emailAsunto: 'ATLAS — Código para confirmar tu nueva contraseña',
    emailHtmlBody: atlasMailShell({
      preheader: 'Confirma el cambio de contraseña que pediste desde tu sesión.',
      eyebrow: 'Seguridad de la cuenta',
      title: 'Confirma tu nueva contraseña',
      blocks: [
        mailParagraph('Hola {{nombre}},'),
        mailParagraph('Pediste cambiar tu contraseña de ATLAS desde una sesión activa. Ingresa este código para confirmarlo:'),
        mailCode('{{codigo}}'),
        mailParagraph(VIGENCIA),
        mailNotice(
          'Si no fuiste tú, alguien tiene acceso a tu sesión y a tu contraseña actual: cierra sesión en ' +
            'todos los dispositivos y avisa al equipo de seguridad de inmediato.',
        ),
      ],
    }),
    emailTextBody:
      'Hola {{nombre}},\n\n' +
      'Pediste cambiar tu contraseña de ATLAS desde una sesión activa. Ingresa este código para confirmarlo: {{codigo}}\n\n' +
      'El código vence en {{minutos}} minutos y solo puede usarse una vez.\n' +
      'Si no fuiste tú, alguien tiene acceso a tu sesión y a tu contraseña actual: cierra sesión en todos los ' +
      'dispositivos y avisa al equipo de seguridad de inmediato.',
    variablesRequeridas: ['nombre', 'codigo', 'minutos'],
  },
  'atlas-login-pin': {
    nombre: 'atlas-login-pin',
    descripcion: 'PIN de verificación adicional para el login de administradores ATLAS.',
    emailAsunto: 'ATLAS — Tu PIN de acceso',
    emailHtmlBody: atlasMailShell({
      preheader: 'Tu PIN de un solo uso para completar el inicio de sesión.',
      eyebrow: 'Verificación en dos pasos',
      title: 'Completa tu inicio de sesión',
      blocks: [
        mailParagraph('Hola {{nombre}},'),
        mailParagraph('Detectamos un inicio de sesión de administrador en ATLAS. Ingresa este PIN para completar el acceso:'),
        mailCode('{{pin}}'),
        mailParagraph('El PIN vence en {{minutos}} minutos y solo puede usarse una vez.'),
        mailNotice('Si no fuiste tú, cambia tu contraseña de inmediato.'),
      ],
    }),
    emailTextBody:
      'Hola {{nombre}},\n\n' +
      'Detectamos un inicio de sesión de administrador en ATLAS. Ingresa este PIN para completar el acceso: {{pin}}\n\n' +
      'El PIN vence en {{minutos}} minutos y solo puede usarse una vez.\n' +
      'Si no fuiste tú, cambia tu contraseña de inmediato.',
    variablesRequeridas: ['nombre', 'pin', 'minutos'],
  },
  'atlas-verificacion-contacto': {
    nombre: 'atlas-verificacion-contacto',
    descripcion: 'Código de un solo uso para verificar el correo declarado por un cliente en onboarding.',
    emailAsunto: 'ATLAS — Verifica tu correo',
    emailHtmlBody: atlasMailShell({
      preheader: 'Confirma que este correo es tuyo para continuar con tu registro.',
      eyebrow: 'Registro',
      title: 'Verifica tu correo',
      blocks: [
        mailParagraph('Hola,'),
        mailParagraph('Para continuar con tu registro en ATLAS necesitamos confirmar que este correo es tuyo. Ingresa este código:'),
        mailCode('{{codigo}}'),
        mailParagraph(VIGENCIA),
        mailNotice('Si no estás registrándote en ATLAS, ignora este correo.'),
      ],
    }),
    emailTextBody:
      'Hola,\n\n' +
      'Para continuar con tu registro en ATLAS necesitamos confirmar que este correo es tuyo. Ingresa este código: {{codigo}}\n\n' +
      'El código vence en {{minutos}} minutos y solo puede usarse una vez.\n' +
      'Si no estás registrándote en ATLAS, ignora este correo.',
    variablesRequeridas: ['codigo', 'minutos'],
  },
  'atlas-credenciales-iniciales': {
    nombre: 'atlas-credenciales-iniciales',
    descripcion: 'Contraseña por defecto entregada al crear un usuario interno de ATLAS.',
    emailAsunto: 'ATLAS — Tu cuenta fue creada',
    emailHtmlBody: atlasMailShell({
      preheader: 'Tu acceso al panel interno de ATLAS y su contraseña temporal.',
      eyebrow: 'Bienvenida',
      title: 'Tu cuenta de ATLAS está lista',
      blocks: [
        mailParagraph('Hola {{nombre}},'),
        mailParagraph('Se creó una cuenta para ti en el panel interno de ATLAS.'),
        // Rotulados por separado y no en una línea corrida: es lo que hay que
        // copiar, y una contraseña temporal pegada al correo se copia mal.
        mailField('Usuario', '{{email}}'),
        mailField('Contraseña temporal', '{{password}}'),
        mailParagraph('Por seguridad, deberás cambiar esta contraseña en tu primer inicio de sesión.'),
      ],
    }),
    emailTextBody:
      'Hola {{nombre}},\n\n' +
      'Se creó una cuenta para ti en el panel interno de ATLAS.\n\n' +
      'Usuario: {{email}}\nContraseña temporal: {{password}}\n\n' +
      'Por seguridad, deberás cambiar esta contraseña en tu primer inicio de sesión.',
    variablesRequeridas: ['nombre', 'email', 'password'],
  },
};
