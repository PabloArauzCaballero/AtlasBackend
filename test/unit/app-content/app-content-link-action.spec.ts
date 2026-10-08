import { upsertContentSchema } from '../../../src/modules/app-content/app-content.schemas.js';

describe('acción link del contenido de la app', () => {
  const base = { surface: 'help', contentKey: 'ayuda.1', actionKind: 'link', actionLabel: 'Ver' };

  it('acepta una URL https', () => {
    expect(upsertContentSchema.safeParse({ ...base, actionValue: 'https://atlas.example/ayuda' }).success).toBe(true);
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'http://atlas.example', 'no es url'])('rechaza %s', (actionValue) => {
    expect(upsertContentSchema.safeParse({ ...base, actionValue }).success).toBe(false);
  });

  it('otras acciones no exigen URL', () => {
    expect(upsertContentSchema.safeParse({ ...base, actionKind: 'screen', actionValue: 'home' }).success).toBe(true);
  });
});
