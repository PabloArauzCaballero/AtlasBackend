import { describe, expect, it } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { parseOptionalPositiveId, parsePositiveId } from '../../../src/common/utils/ids/id.util.js';

/** `parsePositiveId` / `parseOptionalPositiveId`: solo enteros positivos como texto. */
describe('id.util', () => {
  it('parsePositiveId acepta enteros positivos y rechaza el resto', () => {
    expect(parsePositiveId('42', 'x')).toBe('42');
    expect(() => parsePositiveId('0', 'x')).toThrow(BadRequestException);
    expect(() => parsePositiveId('-1', 'x')).toThrow(BadRequestException);
    expect(() => parsePositiveId('abc', 'x')).toThrow(BadRequestException);
    expect(() => parsePositiveId('1.5', 'x')).toThrow(BadRequestException);
  });

  it('parseOptionalPositiveId devuelve undefined para vacío/undefined; si no, valida', () => {
    expect(parseOptionalPositiveId(undefined, 'x')).toBeUndefined();
    expect(parseOptionalPositiveId('  ', 'x')).toBeUndefined();
    expect(parseOptionalPositiveId('7', 'x')).toBe('7');
    expect(() => parseOptionalPositiveId('bad', 'x')).toThrow(BadRequestException);
  });
});
