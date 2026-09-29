import { describe, expect, it } from '@jest/globals';
import { containsLikePattern } from '../../../../src/common/utils/strings/like-pattern.util.js';

describe('containsLikePattern', () => {
  it('envuelve el texto en %…% para buscar «contiene»', () => {
    expect(containsLikePattern('suite')).toBe('%suite%');
  });

  it('escapa los comodines del usuario: `_` y `%` se buscan literalmente', () => {
    expect(containsLikePattern('user_id')).toBe('%user\\_id%');
    expect(containsLikePattern('50%')).toBe('%50\\%%');
  });

  it('escapa también la barra invertida, que es el carácter de escape de LIKE', () => {
    expect(containsLikePattern('a\\b')).toBe('%a\\\\b%');
  });
});
