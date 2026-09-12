import { SystemFlowsController } from '../../src/modules/systems-ops/system-flows.controller.js';
import type { SystemFlowsService } from '../../src/modules/systems-ops/system-flows.service.js';

/**
 * El controlador de Flujos es delgado a propósito: valida y delega. Lo que se comprueba aquí es
 * justamente eso —que cada ruta llama a lo que dice su nombre y le pasa lo que recibió—, porque un
 * cruce de cables entre dos métodos que devuelven listas parecidas no lo detecta ningún tipo: ambos
 * compilan, ambos responden 200, y el portal enseña los datos equivocados sin un solo error.
 */
function build() {
  const llamadas: Record<string, unknown[][]> = {};
  const espia =
    (nombre: string) =>
    (...args: unknown[]) => {
      (llamadas[nombre] ??= []).push(args);
      return { llamado: nombre };
    };
  const service = new Proxy(
    {},
    {
      get: (_target, prop: string) => espia(prop),
    },
  ) as unknown as SystemFlowsService;
  return { controller: new SystemFlowsController(service), llamadas };
}

const usuario = { sub: '7', role: 'system_admin' } as never;

describe('SystemFlowsController · lecturas', () => {
  it.each([
    ['summary', 'summary'],
    ['modules', 'modules'],
    ['imports', 'imports'],
    ['businessFlows', 'businessFlows'],
  ])('%s delega en el caso de uso del mismo nombre', (metodo, esperado) => {
    const { controller, llamadas } = build();
    (controller as unknown as Record<string, () => unknown>)[metodo]();
    expect(llamadas[esperado]).toHaveLength(1);
  });

  it('list, screens y findings pasan su consulta tal cual, cada una a su servicio', () => {
    const { controller, llamadas } = build();
    const query = { page: 2, limit: 10 } as never;
    controller.list(query);
    controller.screens(query);
    controller.findings(query);
    expect(llamadas.listFlows?.[0]?.[0]).toBe(query);
    expect(llamadas.listScreens?.[0]?.[0]).toBe(query);
    expect(llamadas.listFindings?.[0]?.[0]).toBe(query);
  });

  it('el detalle y el grafo de un flujo usan el id del parámetro, no el objeto entero', () => {
    const { controller, llamadas } = build();
    controller.detail({ flowId: 'flow_000000000001' } as never);
    controller.flowGraph({ flowId: 'flow_000000000002' } as never);
    expect(llamadas.getFlow?.[0]?.[0]).toBe('flow_000000000001');
    expect(llamadas.getFlowGraph?.[0]?.[0]).toBe('flow_000000000002');
  });

  it('el grafo de módulo recibe la consulta completa: bloque, módulo y si incluye roles', () => {
    const { controller, llamadas } = build();
    const query = { systemCode: 'ATLAS_BACKEND', module: 'auth', includeRoles: true } as never;
    controller.moduleGraph(query);
    expect(llamadas.getModuleGraph?.[0]?.[0]).toBe(query);
  });
});

describe('SystemFlowsController · escrituras', () => {
  it('cada importación llega a su caso de uso con el actor, no anónima', () => {
    const { controller, llamadas } = build();
    controller.importEndpoints({ systemCode: 'ATLAS_BACKEND', endpoints: [] } as never, usuario);
    controller.importScreens({ clientCode: 'ADMIN_PORTAL', screens: [] } as never, usuario);
    controller.importFindings({ systemCode: 'ATLAS_BACKEND', findings: [] } as never, usuario);
    expect(llamadas.importEndpoints?.[0]?.[1]).toBe('7');
    expect(llamadas.importScreens?.[0]?.[1]).toBe('7');
    expect(llamadas.importFindings?.[0]?.[1]).toBe('7');
  });

  it('verify pasa el token del llamante: sin él no se puede pedir la evidencia de otro bloque', () => {
    const { controller, llamadas } = build();
    controller.verify({ systemCode: 'DECISION_ENGINE', windowDays: 30 } as never, usuario, 'token-abc');
    const [dto, actor, token] = llamadas.verify?.[0] ?? [];
    expect(dto).toMatchObject({ systemCode: 'DECISION_ENGINE', windowDays: 30 });
    expect(actor).toBe('7');
    expect(token).toBe('token-abc');
  });

  it('verify sin token sigue funcionando para el propio bloque, que no necesita federar', () => {
    const { controller, llamadas } = build();
    controller.verify({ systemCode: 'ATLAS_BACKEND', windowDays: 7 } as never, usuario, null);
    expect(llamadas.verify?.[0]?.[2]).toBeNull();
  });
});
