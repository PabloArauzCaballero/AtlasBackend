import { contentSurfaceSchema, upsertContentSchema } from '../../../src/modules/app-content/app-content.schemas.js';

describe('superficies del contenido de la app', () => {
  it.each(['onboarding', 'home', 'faq', 'help', 'legal', 'profile', 'credit', 'tour', 'privacy', 'signup', 'payments', 'copy'])(
    'acepta %s',
    (surface) => {
      expect(contentSurfaceSchema.safeParse(surface).success).toBe(true);
    },
  );

  it('rechaza una superficie que la app no sabe pintar', () => {
    expect(contentSurfaceSchema.safeParse('inventada').success).toBe(false);
  });

  it('una pieza de las superficies nuevas se puede guardar con puntos e icono', () => {
    const parsed = upsertContentSchema.safeParse({
      surface: 'signup',
      contentKey: 'registro.1',
      title: 'Tu nombre y tu apellido',
      bodyMd: 'El crédito se abre a tu nombre.',
      bullets: [{ text: 'Solo Atlas', icon: 'ojo' }],
      metadata: { icon: 'perfil' },
    });
    expect(parsed.success).toBe(true);
  });
});
