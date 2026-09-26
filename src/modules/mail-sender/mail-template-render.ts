/**
 * @file Artefacto de soporte específico de esta carpeta.
 * @business Esta pieza evita entregar un correo con el código sin sustituir, que es un correo inservible.
 * @system rinde en local las plantillas transaccionales que MailSender hospeda.
 */
import { MAIL_TEMPLATE_DEFINITIONS, MailTemplateDefinition, MailTemplateName } from './mail-sender.templates.js';

const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export class MailTemplateRenderError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MailTemplateRenderError';
  }
}

export type RenderedMail = { subject: string; text: string; html: string };

/**
 * Rinde una plantilla en el proceso, para los transportes que no la hospedan.
 *
 * MailSender es quien guarda las plantillas y las auto-provisiona por nombre; sin él no hay a quién
 * pedírselas. `MAIL_TEMPLATE_DEFINITIONS` ya era el estado inicial con el que se crean allá, así que
 * los dos caminos mandan el mismo texto y no aparece una segunda copia que se desincronice.
 */
export function renderMailTemplate(template: MailTemplateName, variables: Record<string, string>): RenderedMail {
  const definition = MAIL_TEMPLATE_DEFINITIONS[template];
  assertVariablesPresent(definition, variables);
  return {
    subject: render(definition.emailAsunto, variables),
    text: render(definition.emailTextBody, variables),
    html: render(definition.emailHtmlBody, variables),
  };
}

/**
 * Una variable ausente se rinde como el literal `{{pin}}`, y ese correo llega igual: la persona
 * recibe un PIN que no puede escribir y el sistema cree haber entregado el segundo factor. Vale más
 * fallar aquí, donde el llamante todavía puede tratarlo como canal no disponible.
 */
function assertVariablesPresent(definition: MailTemplateDefinition, variables: Record<string, string>): void {
  const missing = definition.variablesRequeridas.filter((name) => !variables[name]);
  if (missing.length > 0) {
    throw new MailTemplateRenderError(
      'MAIL_TEMPLATE_VARIABLE_MISSING',
      `La plantilla "${definition.nombre}" exige ${missing.length} variable(s) que no se entregaron: ${missing.join(', ')}.`,
    );
  }
}

/** Sustitución de `{{clave}}`. Lo que no esté declarado se deja tal cual, nunca como `undefined`. */
function render(template: string, variables: Record<string, string>): string {
  return template.replace(PLACEHOLDER, (original, name: string) => variables[name] ?? original);
}
