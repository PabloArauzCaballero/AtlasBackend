import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { InternalAuthController } from '../../../src/modules/internal-users/internal-auth.controller.js';
import { InternalAuthService } from '../../../src/modules/internal-users/internal-auth.service.js';
import { InternalUsersService } from '../../../src/modules/internal-users/internal-users.service.js';
import { InternalAuthResponse } from '../../../src/modules/internal-users/internal-users.types.js';

/**
 * Contrato de seguridad de la sesion interna: los tokens viajan en cookies `HttpOnly` y NO en el
 * body. Si una regresion los devolviera al body, el portal volveria a guardarlos en
 * `sessionStorage` y cualquier XSS podria leerlos — que es justo lo que este cambio elimina.
 */
const ACCESS_SECRET = 'access-token-secretisimo';
const REFRESH_SECRET = 'refresh-token-secretisimo';

const authResponse: InternalAuthResponse = {
  accessToken: ACCESS_SECRET,
  refreshToken: REFRESH_SECRET,
  tokenType: 'Bearer',
  expiresIn: '1h',
  user: {
    id: '1',
    tenantId: '1',
    email: 'qa@atlas.internal',
    fullName: 'QA Operator',
    name: 'QA Operator',
    userCode: null,
    status: 'active',
    department: null,
    jobTitle: null,
    mustChangePassword: false,
    mfaEnabled: false,
    roles: ['INTERNAL_ADMIN'],
    legacyRoles: [],
    permissions: ['internal.users.manage'],
  },
};

type RecordedCookie = { name: string; value: string; options: Record<string, unknown> };

function buildResponseSpy() {
  const set: RecordedCookie[] = [];
  const cleared: string[] = [];
  const response = {
    cookie: (name: string, value: string, options: Record<string, unknown>) => {
      set.push({ name, value, options });
    },
    clearCookie: (name: string) => {
      cleared.push(name);
    },
  };
  return { set, cleared, response };
}

function buildController(overrides: Partial<InternalAuthService> = {}) {
  const authService = {
    login: jest.fn(async () => authResponse),
    verifyLoginPin: jest.fn(async () => authResponse),
    refresh: jest.fn(async () => authResponse),
    logout: jest.fn(async () => ({ loggedOut: true })),
    ...overrides,
  } as unknown as InternalAuthService;
  const usersService = {} as unknown as InternalUsersService;
  return { controller: new InternalAuthController(authService, usersService), authService };
}

function requestWith(cookieHeader?: string) {
  return { ip: '127.0.0.1', headers: cookieHeader ? { cookie: cookieHeader } : {} };
}

const loginBody = { tenantId: '1', email: 'qa@atlas.internal', password: 'secreto' };

describe('InternalAuthController · login', () => {
  beforeEach(() => jest.clearAllMocks());

  it('NO devuelve los tokens en el body', async () => {
    const { controller } = buildController();
    const { response } = buildResponseSpy();

    const result = await controller.login(undefined, loginBody, requestWith(), response);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(ACCESS_SECRET);
    expect(serialized).not.toContain(REFRESH_SECRET);
  });

  it('anuncia tokenType Cookie, que es la senal que el portal interpreta', async () => {
    const { controller } = buildController();
    const { response } = buildResponseSpy();

    const result = await controller.login(undefined, loginBody, requestWith(), response);

    expect(result).toMatchObject({ tokenType: 'Cookie' });
  });

  it('sigue devolviendo el perfil: lo que se quita son las credenciales', async () => {
    const { controller } = buildController();
    const { response } = buildResponseSpy();

    const result = await controller.login(undefined, loginBody, requestWith(), response);

    expect(result).toMatchObject({ user: { email: 'qa@atlas.internal' } });
  });

  it('emite ambas cookies como HttpOnly', async () => {
    const { controller } = buildController();
    const { set, response } = buildResponseSpy();

    await controller.login(undefined, loginBody, requestWith(), response);

    const access = set.find((cookie) => cookie.name === 'atlas_internal_access');
    const refresh = set.find((cookie) => cookie.name === 'atlas_internal_refresh');
    expect(access?.value).toBe(ACCESS_SECRET);
    expect(refresh?.value).toBe(REFRESH_SECRET);
    expect(access?.options.httpOnly).toBe(true);
    expect(refresh?.options.httpOnly).toBe(true);
  });

  it('la cookie de access es de sesion y la de refresh persiste', async () => {
    const { controller } = buildController();
    const { set, response } = buildResponseSpy();

    await controller.login(undefined, loginBody, requestWith(), response);

    expect(set.find((c) => c.name === 'atlas_internal_access')?.options.maxAge).toBeUndefined();
    expect(set.find((c) => c.name === 'atlas_internal_refresh')?.options.maxAge).toBeGreaterThan(0);
  });

  it('el challenge de PIN pasa tal cual, sin emitir cookies', async () => {
    // `pinChallengeRequired` es el discriminante real de `isLoginPinChallenge`.
    const challenge = { pinChallengeRequired: true as const, challengeToken: 'challenge-1', expiresInMinutes: 10 };
    const { controller } = buildController({
      login: jest.fn(async () => challenge),
    } as unknown as Partial<InternalAuthService>);
    const { set, response } = buildResponseSpy();

    const result = await controller.login(undefined, loginBody, requestWith(), response);

    expect(result).toBe(challenge);
    expect(set).toHaveLength(0);
  });
});

describe('InternalAuthController · refresh', () => {
  beforeEach(() => jest.clearAllMocks());

  it('toma el refresh token de la cookie cuando el body va vacio', async () => {
    const { controller, authService } = buildController();
    const { response } = buildResponseSpy();

    await controller.refresh({}, requestWith('atlas_internal_refresh=desde-cookie'), response);

    expect(authService.refresh).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'desde-cookie' }));
  });

  it('la cookie tiene prioridad sobre el body', async () => {
    const { controller, authService } = buildController();
    const { response } = buildResponseSpy();

    await controller.refresh(
      { refreshToken: 'desde-body-0123456789' },
      requestWith('atlas_internal_refresh=desde-cookie'),
      response,
    );

    expect(authService.refresh).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'desde-cookie' }));
  });

  it('acepta el body como fallback para clientes no navegador', async () => {
    const { controller, authService } = buildController();
    const { response } = buildResponseSpy();

    await controller.refresh({ refreshToken: 'desde-body-0123456789' }, requestWith(), response);

    expect(authService.refresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'desde-body-0123456789' }),
    );
  });

  it('rechaza si no hay ni cookie ni body', async () => {
    const { controller } = buildController();
    const { response } = buildResponseSpy();

    await expect(controller.refresh({}, requestWith(), response)).rejects.toThrow(UnauthorizedException);
  });

  it('rota las cookies con los tokens nuevos y no filtra tokens al body', async () => {
    const { controller } = buildController();
    const { set, response } = buildResponseSpy();

    const result = await controller.refresh({}, requestWith('atlas_internal_refresh=viejo'), response);

    expect(set.map((cookie) => cookie.name)).toEqual(['atlas_internal_access', 'atlas_internal_refresh']);
    expect(JSON.stringify(result)).not.toContain(REFRESH_SECRET);
  });
});

describe('InternalAuthController · logout', () => {
  beforeEach(() => jest.clearAllMocks());

  it('revoca el token de la cookie y limpia ambas cookies', async () => {
    const { controller, authService } = buildController();
    const { cleared, response } = buildResponseSpy();

    await controller.logout({ allDevices: false }, requestWith('atlas_internal_refresh=a-revocar'), response);

    expect(authService.logout).toHaveBeenCalledWith({ refreshToken: 'a-revocar', allDevices: false });
    expect(cleared).toEqual(['atlas_internal_access', 'atlas_internal_refresh']);
  });

  it('limpia las cookies aunque no haya token que revocar', async () => {
    const { controller, authService } = buildController();
    const { cleared, response } = buildResponseSpy();

    const result = await controller.logout({ allDevices: false }, requestWith(), response);

    expect(result).toEqual({ loggedOut: true });
    expect(authService.logout).not.toHaveBeenCalled();
    expect(cleared).toHaveLength(2);
  });
});
