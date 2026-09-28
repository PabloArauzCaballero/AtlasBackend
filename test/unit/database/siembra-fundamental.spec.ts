/**
 * @file La siembra fundamental corre en CADA despliegue: no puede arrastrar población inventada ni
 *   pisar lo que un operador cambió.
 * @business Las pantallas de configuración del portal (colas de soporte, productos de crédito,
 *   políticas, catálogos) no sirven vacías; los clientes y préstamos inventados, en cambio, no deben
 *   aparecer en un entorno que no los pidió. Esta prueba vigila esa línea.
 * @system Recorre los bloques declarados sin base: las referencias literales y `refA` de un bloque
 *   fundamental no pueden depender de un bloque demostrativo, y el escritor inserta sin actualizar.
 */
import { describe, expect, it, jest } from '@jest/globals';
import type { Client } from 'pg';
import { escribirBloque, sentenciaDe } from '../../../src/database/seeders/demo/escritor.js';
import { DOMINIOS, planDeSiembra, sembrarDemo } from '../../../src/database/seeders/demo/index.js';
import { esReferencia, type BloqueSembrado } from '../../../src/database/seeders/demo/tipos.js';

const bloques = DOMINIOS.flatMap((dominio) => dominio.bloques);
const fundamentales = bloques.filter((bloque) => bloque.fundamental);
const demostrativos = bloques.filter((bloque) => !bloque.fundamental);

const tablasFundamentales = new Set(fundamentales.map((bloque) => bloque.tabla));
const tablasSoloDemo = new Set(demostrativos.map((bloque) => bloque.tabla).filter((tabla) => !tablasFundamentales.has(tabla)));

function idsDe(lista: readonly BloqueSembrado[]): Set<number> {
  const ids = new Set<number>();
  for (const bloque of lista) for (const fila of bloque.filas) if (typeof fila._id === 'number') ids.add(fila._id);
  return ids;
}

const idsFundamentales = idsDe(fundamentales);
/** Identificadores que SÓLO existen si corre la demostración. */
const idsSoloDemo = new Set([...idsDe(demostrativos)].filter((id) => !idsFundamentales.has(id)));

function tablasReferidas(valor: unknown, acumulado: string[] = []): string[] {
  if (!esReferencia(valor)) return acumulado;
  acumulado.push(valor.ref.tabla);
  for (const interno of Object.values(valor.ref.donde)) tablasReferidas(interno, acumulado);
  return acumulado;
}

function numerosLiterales(valor: unknown): number[] {
  // Sólo el bloque reservado: un número pequeño (un orden, un plazo) no es una referencia a la demo.
  if (typeof valor === 'number') return valor >= 900_000 && valor < 1_000_000 ? [valor] : [];
  if (typeof valor === 'string') return (valor.match(/\b9\d{5}\b/g) ?? []).map(Number);
  return [];
}

function clienteFalso(rowCount = 1): { cliente: Client; consultas: { sql: string; parametros: unknown[] }[] } {
  const consultas: { sql: string; parametros: unknown[] }[] = [];
  const query = jest.fn(async (sql: string, parametros: unknown[] = []) => {
    consultas.push({ sql, parametros });
    // Una consulta de `refA` pide `valor`; un INSERT devuelve cuántas filas entraron.
    return sql.startsWith('SELECT') ? { rows: [{ valor: 1 }], rowCount: 1 } : { rows: [], rowCount };
  });
  return { cliente: { query } as unknown as Client, consultas };
}

describe('siembra fundamental', () => {
  it('la población inventada NO es fundamental', () => {
    for (const tabla of [
      'customer.customers',
      'partner.partner_profiles',
      'credit.loans',
      'credit.credit_lines',
      'support.support_cases',
      'support.support_agent_profiles',
      'iam.internal_users',
      'iam.merchant_users',
      'messaging.notification_campaigns',
      'case_management.fraud_cases',
      'privacy.data_subject_requests',
      'telemetry.customer_location_pings',
    ]) {
      expect(tablasFundamentales.has(tabla)).toBe(false);
    }
  });

  it('las pantallas de configuración del portal tienen su bloque fundamental', () => {
    for (const tabla of [
      'support.support_queues',
      'support.support_case_categories',
      'support.knowledge_articles',
      'credit.credit_products',
      'credit.delinquency_policies',
      'messaging.notification_policies',
      'catalog.context_catalogs',
      'catalog.event_definitions',
      'catalog.decision_artifact_bindings',
      'privacy.retention_policies',
      'privacy.data_classification_policies',
      'audit.data_quality_rules',
      'platform_ops.system_test_suites',
      'risk.feature_definitions',
    ]) {
      expect(tablasFundamentales.has(tabla)).toBe(true);
    }
  });

  it('ningún bloque fundamental apunta a una fila que sólo crea la demostración', () => {
    const fugas: string[] = [];
    for (const bloque of fundamentales) {
      const anuladas = new Set(bloque.columnasDemostrativas ?? []);
      for (const [indice, fila] of bloque.filas.entries()) {
        for (const [columna, valor] of Object.entries(fila)) {
          if (columna === '_id' || anuladas.has(columna)) continue;
          for (const tabla of tablasReferidas(valor)) {
            if (tablasSoloDemo.has(tabla)) fugas.push(`${bloque.tabla}[${indice}].${columna} → refA(${tabla})`);
          }
          for (const numero of numerosLiterales(valor)) {
            if (idsSoloDemo.has(numero)) fugas.push(`${bloque.tabla}[${indice}].${columna} = ${numero}`);
          }
        }
      }
    }
    expect(fugas).toEqual([]);
  });

  it('las columnas demostrativas declaradas existen en sus filas', () => {
    for (const bloque of fundamentales) {
      for (const columna of bloque.columnasDemostrativas ?? []) {
        expect(bloque.filas.every((fila) => columna in fila)).toBe(true);
      }
    }
  });

  it('en modo fundamental inserta sin destino de conflicto y nunca actualiza', () => {
    const bloque: BloqueSembrado = {
      tabla: 'support.support_queues',
      filas: [{ _id: 1, queue_code: 'x', name: 'X' }],
      conflicto: ['queue_code'],
    };
    const { sql } = sentenciaDe(bloque, 'fundamental');
    expect(sql).toMatch(/ON CONFLICT DO NOTHING$/);
    expect(sql).not.toContain('DO UPDATE');
    expect(sentenciaDe(bloque).sql).toContain('ON CONFLICT ("queue_code") DO UPDATE SET');
  });

  it('anula las columnas demostrativas y cuenta sólo las filas que faltaban', async () => {
    const bloque: BloqueSembrado = {
      tabla: 'catalog.decision_artifact_bindings',
      filas: [
        { _id: 990201, decision_type: 'A', changed_by_internal_user_id: 930003 },
        { _id: 990202, decision_type: 'B', changed_by_internal_user_id: 930003 },
      ],
      fundamental: true,
      columnasDemostrativas: ['changed_by_internal_user_id'],
    };
    const { cliente, consultas } = clienteFalso(0);
    const resultado = await escribirBloque(cliente, bloque, new Map(), 'fundamental');
    expect(resultado).toMatchObject({ filas: 2, nuevas: 0 });
    expect(consultas.every((c) => c.parametros[2] === null)).toBe(true);

    const completa = clienteFalso(1);
    await escribirBloque(completa.cliente, bloque);
    expect(completa.consultas[0]?.parametros[2]).toBe(930003);
  });

  it('sembrarDemo fundamental escribe sólo los bloques fundamentales, en orden', async () => {
    const { cliente, consultas } = clienteFalso(1);
    const resultados = await sembrarDemo(cliente, undefined, 'fundamental');
    const escritas = new Set(resultados.flatMap((r) => r.bloques.map((b) => b.tabla)));
    expect(escritas).toEqual(tablasFundamentales);
    const insertadas = new Set(
      consultas.filter((c) => c.sql.startsWith('INSERT')).map((c) => /INSERT INTO "([^"]+)"\."([^"]+)"/.exec(c.sql)?.slice(1).join('.')),
    );
    for (const tabla of tablasSoloDemo) expect(insertadas.has(tabla)).toBe(false);
  });

  it('el plan fundamental es un subconjunto del completo', () => {
    const completo = planDeSiembra();
    const fundamental = planDeSiembra('fundamental');
    expect(fundamental.length).toBe(fundamentales.length);
    expect(fundamental.every((linea) => linea.fundamental)).toBe(true);
    expect(completo.length).toBe(bloques.length);
  });
});
