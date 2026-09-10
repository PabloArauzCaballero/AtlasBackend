import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Sequelize } from 'sequelize-typescript';
import { DecisionArtifactBindingService, DECISION_TYPES } from '../../../src/modules/decision-engine/decision-artifact-binding.service.js';
import { env } from '../../../src/config/env.js';
import type { DecisionEngineClient } from '../../../src/modules/decision-engine/decision-engine.client.js';

/**
 * Qué artefacto decide cada cosa.
 *
 * Esta pantalla existe por un fallo concreto: el valor por defecto apuntaba a `credit_underwriting`,
 * que en el motor se llama `ATLAS_BNPL_UNDERWRITING`, y cada solicitud de crédito moría en un 404
 * silencioso. De ahí las dos reglas que se fijan aquí.
 *
 * La lista de opciones la da el MOTOR, porque es el único que sabe qué artefactos existen y están
 * publicados: de una lista no se puede elegir algo que no existe. Y `assign` valida contra esa misma
 * lista, porque aceptar texto libre habría reproducido el problema con una interfaz más bonita.
 *
 * El entorno sigue siendo el RESPALDO para poder desplegar sin configurar nada: mientras no haya
 * fila, todo sigue exactamente igual que antes. Y la procedencia se publica junto al código, porque
 * «no hay fila, se usó el entorno» y «alguien eligió esto» son dos situaciones muy distintas para
 * quien mira la pantalla, y hasta ahora se veían igual — no se veían en absoluto.
 *
 * Las dos caídas son deliberadamente asimétricas: si la tabla no se puede leer se cae al entorno y
 * se sigue —una tabla de configuración inaccesible no puede dejar sin decidir a nadie—, y si el
 * motor no contesta la pantalla se abre igual con lista vacía, pero entonces la asignación se marca
 * como NO validada en vez de afirmar que lo fue.
 */
type Clave = keyof typeof env;

const original = new Map<Clave, unknown>();

function poner(valores: Partial<Record<Clave, unknown>>): void {
  for (const [clave, valor] of Object.entries(valores) as Array<[Clave, unknown]>) {
    if (!original.has(clave)) original.set(clave, (env as Record<string, unknown>)[clave]);
    (env as Record<string, unknown>)[clave] = valor;
  }
}

describe('DecisionArtifactBindingService', () => {
  let query: jest.Mock;
  let client: { listArtifacts: jest.Mock };
  let service: DecisionArtifactBindingService;

  beforeEach(() => {
    query = jest.fn(async () => []);
    client = { listArtifacts: jest.fn(async () => [{ artifactCode: 'ATLAS_BNPL_UNDERWRITING', name: 'BNPL', latestVersion: '3' }]) };
    poner({
      DECISION_ENGINE_IDENTITY_ARTIFACT: 'ATLAS_IDENTITY',
      DECISION_ENGINE_CREDIT_ARTIFACT: 'ATLAS_BNPL_UNDERWRITING',
      DECISION_ENGINE_PARTNER_ARTIFACT: 'ATLAS_PARTNER',
      DECISION_ENGINE_RISK_ARTIFACT: 'ATLAS_RISK',
    });
    service = new DecisionArtifactBindingService({ query } as unknown as Sequelize, client as unknown as DecisionEngineClient);
  });

  afterEach(() => {
    for (const [clave, valor] of original) (env as Record<string, unknown>)[clave] = valor;
    original.clear();
  });

  describe('resolver el artefacto', () => {
    it('con fila elegida manda ella, y se declara que alguien la eligió', async () => {
      query.mockResolvedValueOnce([{ artifact_code: 'ATLAS_OTRO', pinned_version: '2' }] as never);

      const resuelto = await service.resolve('t1', 'credit');

      expect(resuelto).toMatchObject({ artifactCode: 'ATLAS_OTRO', source: 'binding', pinnedVersion: '2' });
    });

    it('sin fila se cae al ENTORNO y se dice que viene de ahí', async () => {
      const resuelto = await service.resolve('t1', 'credit');

      expect(resuelto).toMatchObject({ artifactCode: 'ATLAS_BNPL_UNDERWRITING', source: 'environment', pinnedVersion: null });
    });

    it('cada tipo de decisión lee su propia variable de entorno', async () => {
      await expect(service.resolve('t1', 'identity')).resolves.toHaveProperty('artifactCode', 'ATLAS_IDENTITY');
      await expect(service.resolve('t1', 'partner')).resolves.toHaveProperty('artifactCode', 'ATLAS_PARTNER');
      await expect(service.resolve('t1', 'risk')).resolves.toHaveProperty('artifactCode', 'ATLAS_RISK');
    });

    it('sin fila y sin entorno se declara SIN ASIGNAR: no es lo mismo que estar en el entorno', async () => {
      poner({ DECISION_ENGINE_CREDIT_ARTIFACT: '' });

      const resuelto = await service.resolve('t1', 'credit');

      expect(resuelto).toMatchObject({ artifactCode: null, source: 'unset' });
    });

    it('si la tabla no se puede leer se sigue con el entorno: una configuración caída no deja sin decidir', async () => {
      query.mockRejectedValueOnce(new Error('relation does not exist') as never);

      const resuelto = await service.resolve('t1', 'credit');

      expect(resuelto).toMatchObject({ artifactCode: 'ATLAS_BNPL_UNDERWRITING', source: 'environment' });
    });

    it('una fila con el código vacío no cuenta como elección', async () => {
      query.mockResolvedValueOnce([{ artifact_code: '', pinned_version: null }] as never);

      await expect(service.resolve('t1', 'credit')).resolves.toHaveProperty('source', 'environment');
    });

    it('la consulta acota por tenant y tipo, ambos por parámetro', async () => {
      await service.resolve('t1', 'credit');

      const [sql, opciones] = query.mock.calls.at(-1) as [string, { replacements: Record<string, unknown> }];
      expect(opciones.replacements).toEqual({ tenantId: 't1', decisionType: 'credit' });
      expect(sql).not.toContain("'t1'");
    });

    it('la respuesta lleva la ficha del catálogo: qué endpoints lo disparan y en qué punto del recorrido', async () => {
      const resuelto = await service.resolve('t1', 'credit');

      expect(resuelto.title).toEqual(expect.any(String));
      expect(resuelto.consumerEndpoints).toEqual(expect.any(Array));
    });
  });

  describe('la pantalla de configuración', () => {
    it('lista los cuatro tipos, cada uno con su procedencia', async () => {
      const lista = await service.list('t1');

      expect(lista.map((item) => item.decisionType)).toEqual([...DECISION_TYPES]);
      expect(lista.every((item) => item.source === 'environment')).toBe(true);
    });
  });

  describe('el catálogo del motor', () => {
    it('normaliza el código: el motor lo publica con dos nombres distintos', async () => {
      client.listArtifacts.mockResolvedValueOnce([
        { artifactCode: 'A', name: 'Uno', artifactType: 'DECISION', latestVersion: '2', latestStatus: 'PUBLISHED' },
        { code: 'B', name: null },
      ] as never);

      const catalogo = await service.availableArtifacts();

      expect(catalogo).toEqual([
        { code: 'A', name: 'Uno', type: 'DECISION', latestVersion: '2', status: 'PUBLISHED' },
        { code: 'B', name: null, type: null, latestVersion: null, status: null },
      ]);
    });

    it('si el motor no contesta devuelve lista vacía y NO lanza: la pantalla debe poder abrirse', async () => {
      client.listArtifacts.mockRejectedValueOnce(new Error('ECONNREFUSED') as never);

      await expect(service.availableArtifacts()).resolves.toEqual([]);
    });
  });

  describe('asignar', () => {
    it('NO deja guardar un código que el motor no publica: es la razón de ser de la pantalla', async () => {
      await expect(
        service.assign({ tenantId: 't1', decisionType: 'credit', artifactCode: 'credit_underwriting', internalUserId: '7' }),
      ).rejects.toThrow('DECISION_ARTIFACT_NOT_PUBLISHED');
      expect(query).not.toHaveBeenCalled();
    });

    it('el error dice qué sí está disponible: rechazar sin decir las opciones obliga a adivinar', async () => {
      const fallo = await service
        .assign({ tenantId: 't1', decisionType: 'credit', artifactCode: 'inventado', internalUserId: '7' })
        .catch((error: unknown) => error);

      expect((fallo as Error).message).toContain('ATLAS_BNPL_UNDERWRITING');
    });

    it('un código publicado se guarda y se declara validado', async () => {
      const resultado = await service.assign({
        tenantId: 't1',
        decisionType: 'credit',
        artifactCode: 'ATLAS_BNPL_UNDERWRITING',
        pinnedVersion: '3',
        internalUserId: '7',
        notes: 'lo pidió riesgo',
      });

      expect(resultado).toMatchObject({
        artifactCode: 'ATLAS_BNPL_UNDERWRITING',
        source: 'binding',
        pinnedVersion: '3',
        validatedAgainstEngine: true,
      });
      const [sql, opciones] = query.mock.calls.at(-1) as [string, { replacements: Record<string, unknown> }];
      expect(sql).toContain('ON CONFLICT');
      expect(opciones.replacements).toMatchObject({ tenantId: 't1', decisionType: 'credit', pinnedVersion: '3', notes: 'lo pidió riesgo' });
    });

    it('con el motor caído se guarda IGUAL, pero declarando que no se validó', async () => {
      client.listArtifacts.mockRejectedValueOnce(new Error('caído') as never);

      const resultado = await service.assign({ tenantId: 't1', decisionType: 'credit', artifactCode: 'lo-que-sea', internalUserId: '7' });

      expect(resultado.validatedAgainstEngine).toBe(false);
      expect(query).toHaveBeenCalled();
    });

    it('sin versión fijada se sigue la vigente del despliegue, y se guarda nula', async () => {
      await service.assign({ tenantId: 't1', decisionType: 'credit', artifactCode: 'ATLAS_BNPL_UNDERWRITING', internalUserId: null });

      const [, opciones] = query.mock.calls.at(-1) as [string, { replacements: Record<string, unknown> }];
      expect(opciones.replacements).toMatchObject({ pinnedVersion: null, notes: null, internalUserId: null });
    });
  });
});
