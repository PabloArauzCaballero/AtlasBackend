import { describe, expect, it } from '@jest/globals';
import { VisibilidadService } from '../../../src/modules/expedientes/application/visibilidad.service.js';
import type { InternalPermissionHolderRow } from '../../../src/modules/internal-users/internal-permission-holders.repository.js';
import type { InternalPermissionHoldersRepository } from '../../../src/modules/internal-users/internal-permission-holders.repository.js';
import type { ExpedientesRepository } from '../../../src/modules/expedientes/repositories/expedientes.repository.js';
import type { ExpedienteAccesosRepository } from '../../../src/modules/expedientes/repositories/expediente-accesos.repository.js';

/**
 * Quién ve el archivo, no a quién se le concedió.
 *
 * La pestaña anterior listaba concesiones y por eso decía «nadie» sobre archivos que ve todo el
 * equipo de riesgo. Lo que se fija aquí es que el acceso POR ROL aparezca sin que exista ninguna
 * concesión, que una concesión suba el nivel de quien ya lo tenía en vez de duplicar la fila, y que
 * quien recibe una concesión directa sin permiso de rol no se caiga de la lista.
 */
function titular(overrides: Partial<InternalPermissionHolderRow> = {}): InternalPermissionHolderRow {
  return {
    internalUserId: '7',
    fullName: 'Ana Ríos',
    email: 'ana@atlas.bo',
    status: 'active',
    department: 'RISK',
    jobTitle: 'Analista',
    roleCode: 'RISK_ANALYST',
    permissionCode: 'expedientes.leer',
    ...overrides,
  };
}

function servicio(input: {
  titulares?: InternalPermissionHolderRow[];
  concesiones?: Array<Record<string, unknown>>;
  ancestros?: Array<{ id: string; ruta: string }>;
}) {
  const holders = { findHolders: async () => input.titulares ?? [] } as unknown as InternalPermissionHoldersRepository;
  const repositorio = { findAncestros: async () => input.ancestros ?? [] } as unknown as ExpedientesRepository;
  const accesos = { findConcesionesVigentes: async () => input.concesiones ?? [] } as unknown as ExpedienteAccesosRepository;
  return new VisibilidadService(holders, repositorio, accesos);
}

describe('VisibilidadService', () => {
  it('lista a quien lo ve por su rol aunque no haya ninguna concesión', async () => {
    const espectadores = await servicio({ titulares: [titular()] }).quienLoVe({
      tenantId: '1',
      expedienteId: '10',
      nodoId: '100',
      ruta: '/auth',
    });

    expect(espectadores).toHaveLength(1);
    expect(espectadores[0]).toMatchObject({ internalUserId: '7', nivel: 'leer', porRol: true, accedeAlMotor: true });
  });

  it('toma el nivel MAYOR entre los permisos del rol y no repite a la persona', async () => {
    const espectadores = await servicio({
      titulares: [
        titular({ permissionCode: 'expedientes.leer' }),
        titular({ permissionCode: 'expedientes.escribir' }),
        titular({ permissionCode: 'expedientes.leer', roleCode: 'OPERATIONS_ANALYST' }),
      ],
    }).quienLoVe({ tenantId: '1', expedienteId: '10', nodoId: '100', ruta: '/auth' });

    expect(espectadores).toHaveLength(1);
    expect(espectadores[0]?.nivel).toBe('escribir');
    expect(espectadores[0]?.roles).toEqual(['RISK_ANALYST', 'OPERATIONS_ANALYST']);
  });

  it('una concesión heredada al rol sube el nivel y dice de dónde viene', async () => {
    const espectadores = await servicio({
      titulares: [titular()],
      ancestros: [{ id: '90', ruta: '/auth' }],
      concesiones: [{ nodoId: '90', principalTipo: 'rol', principalId: 'RISK_ANALYST', nivel: 'compartir' }],
    }).quienLoVe({ tenantId: '1', expedienteId: '10', nodoId: '100', ruta: '/auth/carnet.jpg' });

    expect(espectadores).toHaveLength(1);
    expect(espectadores[0]).toMatchObject({ nivel: 'compartir', porConcesionDeRol: true, heredadaDe: '/auth' });
  });

  it('incluye a quien sólo tiene una concesión directa, sin permiso por rol', async () => {
    const espectadores = await servicio({
      titulares: [],
      concesiones: [{ nodoId: '100', principalTipo: 'usuario_interno', principalId: '42', nivel: 'leer' }],
    }).quienLoVe({ tenantId: '1', expedienteId: '10', nodoId: '100', ruta: '/auth' });

    expect(espectadores).toHaveLength(1);
    expect(espectadores[0]).toMatchObject({
      internalUserId: '42',
      porRol: false,
      porConcesionDirecta: true,
      accedeAlMotor: false,
    });
  });

  it('pone primero a quien entra por el Motor de Decisión', async () => {
    const espectadores = await servicio({
      titulares: [
        titular({ internalUserId: '1', fullName: 'Ana', roleCode: 'COMPLIANCE_ANALYST' }),
        titular({ internalUserId: '2', fullName: 'Zoe', roleCode: 'FRAUD_ANALYST' }),
      ],
    }).quienLoVe({ tenantId: '1', expedienteId: '10', nodoId: '100', ruta: '/auth' });

    expect(espectadores.map((quien) => quien.internalUserId)).toEqual(['2', '1']);
  });
});
