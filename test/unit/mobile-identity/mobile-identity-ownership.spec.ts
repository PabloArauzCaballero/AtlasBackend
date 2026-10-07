import { esAjeno } from '../../../src/modules/mobile-identity/mobile-identity-ownership';

describe('esAjeno', () => {
  const cliente = { role: 'customer', customerId: '7' } as never;

  it('un cliente no es dueño del intento de otro ni de uno sin dueño', () => {
    expect(esAjeno('8', cliente)).toBe(true);
    expect(esAjeno(null, cliente)).toBe(true);
  });

  it('el dueño y los roles internos o sin usuario pasan', () => {
    expect(esAjeno(7, cliente)).toBe(false);
    expect(esAjeno('8', { role: 'admin' } as never)).toBe(false);
    expect(esAjeno('8')).toBe(false);
  });
});
