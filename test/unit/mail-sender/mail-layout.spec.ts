import { mailCode } from '../../../src/modules/mail-sender/mail-layout.js';
import { renderMailTemplate } from '../../../src/modules/mail-sender/mail-template-render.js';
import { MAIL_TEMPLATE_DEFINITIONS, type MailTemplateName } from '../../../src/modules/mail-sender/mail-sender.templates.js';

/**
 * El armazón de marca de los correos transaccionales.
 *
 * Se prueba porque su defecto es SILENCIOSO en las dos direcciones: un correo
 * con el HTML roto se envía igual —el transporte no lo mira— y una plantilla que
 * pierda su `{{codigo}}` entrega un mensaje que se lee bien y no sirve para
 * nada. Nadie se entera hasta que alguien no puede entrar.
 */

const NOMBRES = Object.keys(MAIL_TEMPLATE_DEFINITIONS) as MailTemplateName[];

describe('armazón de marca de los correos', () => {
  it.each(NOMBRES)('%s es un documento HTML completo', (nombre) => {
    const html = MAIL_TEMPLATE_DEFINITIONS[nombre].emailHtmlBody;

    /*
     * Documento y no fragmento: el HTML viaja tal cual dentro del MIME, así que
     * nadie más le pone `<head>`. Sin `charset` los acentos llegan rotos y sin
     * `viewport` el móvil encoge la tarjeta de 600 px hasta hacerla ilegible.
     */
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('name="viewport"');
    expect(html).toContain('</html>');
  });

  it.each(NOMBRES)('%s lleva el membrete y la tipografía de ATLAS', (nombre) => {
    const html = MAIL_TEMPLATE_DEFINITIONS[nombre].emailHtmlBody;

    expect(html).toContain('>ATLAS<');
    expect(html).toContain("'Inter'");
    // El color de la marca. Sin él, el correo es de cualquiera.
    expect(html).toContain('#006a61');
  });

  /*
   * La maquetación con tablas y el estilo en línea no son una preferencia: son
   * lo único que Outlook y el Gmail web renderizan igual que el resto. Esta
   * comprobación existe para que nadie «modernice» el armazón con flex y lo
   * descubra cuando un cliente reciba una columna de bloques apilados.
   */
  it.each(NOMBRES)('%s no usa maquetación que Outlook no entiende', (nombre) => {
    const html = MAIL_TEMPLATE_DEFINITIONS[nombre].emailHtmlBody;

    expect(html).not.toContain('display:flex');
    expect(html).not.toContain('display:grid');
    // Sin imágenes: un membrete que depende de «mostrar imágenes» aparece roto
    // justo en el correo que la persona todavía no reconoce.
    expect(html).not.toContain('<img');
  });

  it.each(NOMBRES)('%s conserva todas sus variables en el HTML', (nombre) => {
    const definition = MAIL_TEMPLATE_DEFINITIONS[nombre];
    for (const variable of definition.variablesRequeridas) {
      expect(definition.emailHtmlBody).toContain(`{{${variable}}}`);
    }
  });

  /*
   * El caso que de verdad importa: rendida con valores, la plantilla enseña el
   * código y no deja ni un marcador sin sustituir. Un `{{pin}}` literal es un
   * correo entregado que el sistema cuenta como éxito y la persona no puede usar.
   */
  it('rinde el PIN dentro del bloque de código, sin marcadores sueltos', () => {
    const { html, text, subject } = renderMailTemplate('atlas-login-pin', {
      producto: 'ERP corporativo',
      nombre: 'Pablo',
      pin: '800067',
      minutos: '10',
    });

    expect(html).toContain('800067');
    expect(html).not.toMatch(/\{\{[a-zA-Z0-9_]+\}\}/);
    // El cuerpo en texto plano sigue existiendo: es lo que ve quien lee el
    // correo sin HTML, y perderlo dejaría el mensaje vacío para esa persona.
    expect(text).toContain('800067');
    expect(subject).toContain('ATLAS');
  });

  it('escapa el HTML de los valores en el cuerpo HTML y deja el texto plano tal cual', () => {
    const empresa = 'ACME</p><a href="https://phish">Confirma</a> & Cía';
    const { html, text } = renderMailTemplate('atlas-qr-cobro-cambiado', {
      empresa,
      entidad: 'Banco',
      cuenta: '123',
      fecha: '2026-10-05',
      producto: 'ATLAS',
    });

    expect(html).not.toContain('<a href="https://phish">');
    expect(html).toContain('ACME&lt;/p&gt;&lt;a href=&quot;https://phish&quot;&gt;Confirma&lt;/a&gt; &amp; Cía');
    expect(text).toContain(empresa);
  });

  it('el preheader distingue un correo de otro en la bandeja', () => {
    /*
     * Sin preheader el cliente resume con las primeras palabras del cuerpo
     * —«Hola {{nombre}},»— y las cinco entradas de la bandeja quedan idénticas.
     * Que sean distintos entre sí es justamente lo que se está comprobando.
     */
    const resumenes = NOMBRES.map((nombre) => {
      const html = MAIL_TEMPLATE_DEFINITIONS[nombre].emailHtmlBody;
      return /mso-hide:all">([^&<]+)/.exec(html)?.[1] ?? '';
    });

    expect(resumenes.every((resumen) => resumen.length > 10)).toBe(true);
    expect(new Set(resumenes).size).toBe(NOMBRES.length);
  });
});

/**
 * El bloque del código. Lo que se fija no es el estilo por el estilo: es que el código se pueda
 * seleccionar entero de un gesto, que es lo más parecido a un botón de copiar que admite un correo
 * —copiar al portapapeles necesita JavaScript, y ningún cliente de correo lo ejecuta—.
 */
describe('mailCode', () => {
  it('declara user-select:all con prefijo y sin él, para que un gesto seleccione los seis dígitos', () => {
    const html = mailCode('482913');
    expect(html).toContain('user-select:all');
    // Apple Mail —el de la mayoría de quienes reciben esto en un iPhone— atiende al prefijado.
    expect(html).toContain('-webkit-user-select:all');
    expect(html).toContain('482913');
  });

  it('el estilo va EN LÍNEA: Gmail descarta el <style> del head y el bloque tiene que verse igual', () => {
    expect(mailCode('482913')).toMatch(/<div style="[^"]*font-family/u);
  });
});
