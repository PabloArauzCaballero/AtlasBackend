import { ForbiddenException } from '@nestjs/common';
import { buildAllowedTestUrl, isPrivateOrMetadataAddress } from '../../src/modules/systems-ops/systems-test-url-policy.util.js';

describe('systems test URL policy', () => {
  it.each(['10.0.0.1', '127.0.0.1', '169.254.169.254', '192.168.1.2', '::1', 'fd00::1'])(
    'clasifica %s como destino interno/metadata',
    (address) => expect(isPrivateOrMetadataAddress(address)).toBe(true),
  );

  it('rechaza URL absoluta en pathTemplate aunque baseUrl esté permitida', () => {
    expect(() => buildAllowedTestUrl('https://staging.atlas.example.com', 'http://169.254.169.254/', 'STAGING')).toThrow(
      ForbiddenException,
    );
  });

  it('rechaza path protocol-relative que podría cambiar el host', () => {
    expect(() => buildAllowedTestUrl('https://staging.atlas.example.com', '//evil.example.com/', 'STAGING')).toThrow(ForbiddenException);
  });

  it('acepta ruta relativa contra host explícitamente permitido', () => {
    expect(buildAllowedTestUrl('https://staging.atlas.example.com', '/health', 'STAGING').toString()).toBe(
      'https://staging.atlas.example.com/health',
    );
  });
});
