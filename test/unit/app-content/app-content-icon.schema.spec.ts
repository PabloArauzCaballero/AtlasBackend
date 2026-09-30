import { contentBulletSchema, MAX_CONTENT_ICON_BYTES } from '../../../src/modules/app-content/app-content.schemas.js';

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(20, 1)]);
const uri = (mime: string, bytes: Buffer) => `data:image/${mime};base64,${bytes.toString('base64')}`;
const parse = (iconImage: unknown) => contentBulletSchema.safeParse({ text: 'Punto', iconImage });

describe('icono propio de una viñeta', () => {
  it('acepta un PNG y un WebP reales', () => {
    expect(parse(uri('png', PNG)).success).toBe(true);
    expect(parse(uri('webp', WEBP)).success).toBe(true);
  });

  it('sigue siendo opcional: sin icono propio la viñeta usa el del catálogo', () => {
    expect(contentBulletSchema.safeParse({ text: 'Punto', icon: 'check' }).success).toBe(true);
    expect(parse(null).success).toBe(true);
  });

  it('rechaza un archivo que declara ser PNG y no lo es', () => {
    expect(parse(uri('png', Buffer.from('<svg onload="x()"></svg>'))).success).toBe(false);
  });

  it('rechaza un WebP declarado con la firma de un PNG', () => {
    expect(parse(uri('webp', PNG)).success).toBe(false);
  });

  it('rechaza SVG, GIF y cualquier otra cosa', () => {
    expect(parse('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=').success).toBe(false);
    expect(parse('data:image/gif;base64,R0lGODlh').success).toBe(false);
    expect(parse('https://ejemplo.com/i.png').success).toBe(false);
  });

  it('rechaza lo que pesa más de 32 KB', () => {
    const grande = Buffer.concat([PNG, Buffer.alloc(MAX_CONTENT_ICON_BYTES, 1)]);
    expect(parse(uri('png', grande)).success).toBe(false);
  });
});
