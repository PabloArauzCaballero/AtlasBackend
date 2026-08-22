import { describe, expect, it } from '@jest/globals';
import { DATA_NOTEBOOK_LIMITS } from '../../../src/modules/data-notebook/data-notebook.constants.js';
import {
  notebookDocumentParamsSchema,
  notebookDocumentSchema,
  notebookHistoryEntrySchema,
} from '../../../src/modules/data-notebook/data-notebook.schemas.js';

const CELDA = { kind: 'code' as const, language: 'python' as const, source: 'df.head()' };

describe('cuaderno guardado — contrato de entrada', () => {
  it('acepta un documento con celdas de código y de comentario', () => {
    const resultado = notebookDocumentSchema.safeParse({
      title: 'Mora por cosecha',
      datasetCode: 'customer-overview',
      cells: [CELDA, { kind: 'markdown', language: 'python', source: '## Nota' }],
    });
    expect(resultado.success).toBe(true);
  });

  /**
   * La prueba que sostiene todo el argumento de privacidad del módulo.
   *
   * El cuaderno guarda el avance —tabla, valor, registro y gráficos— y por eso el resultado tiene
   * una FORMA declarada en vez de ser un saco. `.strict()` sigue mandando dentro: un campo que
   * nadie declaró no entra, así que la tabla no acaba almacenando lo que a un cliente se le ocurra
   * meter, y `savedAt` es obligatorio porque un resultado sin fecha, restaurado junto a los datos
   * de hoy, se lee como si fuera de hoy.
   */
  it('acepta el resultado de una celda con su fecha, y exige esa fecha', () => {
    const conResultado = {
      title: 'Con resultados',
      cells: [
        {
          ...CELDA,
          outcome: {
            status: 'ok',
            table: { columns: ['estado'], rows: [{ estado: 'ACTIVE' }] },
            images: ['data:image/png;base64,AAAA'],
            logs: ['filas: 100'],
            durationMs: 42,
            executionCount: 1,
            savedAt: '2026-08-15T00:00:00.000Z',
          },
        },
      ],
    };
    expect(notebookDocumentSchema.safeParse(conResultado).success).toBe(true);

    const sinFecha = structuredClone(conResultado);
    delete (sinFecha.cells[0].outcome as Record<string, unknown>).savedAt;
    expect(notebookDocumentSchema.safeParse(sinFecha).success).toBe(false);
  });

  it('no admite campos que nadie declaró, ni en la celda ni en el resultado', () => {
    expect(
      notebookDocumentSchema.safeParse({
        title: 'Campo de más',
        cells: [{ ...CELDA, rowsCrudas: [{ nombre: 'Ana' }] }],
      }).success,
    ).toBe(false);

    expect(
      notebookDocumentSchema.safeParse({
        title: 'Campo de más',
        cells: [
          {
            ...CELDA,
            outcome: { status: 'ok', logs: [], durationMs: 1, savedAt: 'ya', enClaro: true },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('exige al menos una celda y no admite más que el techo', () => {
    expect(notebookDocumentSchema.safeParse({ title: 'Vacío', cells: [] }).success).toBe(false);

    const demasiadas = Array.from({ length: DATA_NOTEBOOK_LIMITS.maxNotebookCells + 1 }, () => CELDA);
    expect(notebookDocumentSchema.safeParse({ title: 'Enorme', cells: demasiadas }).success).toBe(false);
  });

  it('admite el código de una vista del motor, que lleva dos puntos y un punto', () => {
    const resultado = notebookDocumentSchema.safeParse({
      title: 'Decisiones',
      datasetCode: 'motor:decisiones.ejecuciones',
      cells: [CELDA],
    });
    expect(resultado.success).toBe(true);
  });

  it('admite una celda de R, que corre en el navegador igual que las otras dos', () => {
    const resultado = notebookDocumentSchema.safeParse({
      title: 'Mora en R',
      cells: [{ kind: 'code', language: 'r', source: 'summary(df)' }],
    });
    expect(resultado.success).toBe(true);
    expect(notebookDocumentSchema.safeParse({ title: 'X', cells: [{ ...CELDA, language: 'bash' }] }).success).toBe(false);
  });

  it('el identificador de la ruta sólo admite dígitos', () => {
    expect(notebookDocumentParamsSchema.safeParse({ id: '42' }).success).toBe(true);
    expect(notebookDocumentParamsSchema.safeParse({ id: '1 OR 1=1' }).success).toBe(false);
    expect(notebookDocumentParamsSchema.safeParse({ id: '../7' }).success).toBe(false);
  });
});

/**
 * El código de dataset: la MISMA regla en las dos puertas, y por qué es estrecha.
 *
 * Este valor viaja hasta el portal y, cuando apunta al motor, se usa para componer la relación de
 * la consulta que se manda a `/v1/sql-console/query`. Admitir cualquier mezcla de letras, puntos y
 * dos puntos —como se admitía— dejaba entrar `motor:pg_catalog.pg_authid`: lo paraban la guardia
 * léxica del motor y su inspección del plan, pero la primera puerta lo dejaba pasar.
 */
describe('cuaderno de datos — el código de dataset', () => {
  const conCodigo = (datasetCode: string) => notebookDocumentSchema.safeParse({ title: 'T', datasetCode, cells: [CELDA] }).success;

  it('admite las dos formas legítimas y ninguna más', () => {
    expect(conCodigo('customer-overview')).toBe(true);
    expect(conCodigo('motor:decisiones.ejecuciones')).toBe(true);

    expect(conCodigo('motor:pg_catalog.pg_authid')).toBe(true); // forma válida: lo para el motor
    expect(conCodigo('motor:decisiones')).toBe(false); // sin tabla no es una relación
    expect(conCodigo('motor:decisiones.ejecuciones.extra')).toBe(false);
    expect(conCodigo('motor:decisiones.ejecuciones"; DROP TABLE x; --')).toBe(false);
    expect(conCodigo('read_api.v_customer_overview_v1')).toBe(false); // sin prefijo de origen
    expect(conCodigo('Customer-Overview')).toBe(false);
    expect(conCodigo('motor:1decisiones.tabla')).toBe(false); // no es un identificador de Postgres
  });

  /**
   * El defecto que esto arregla y que no se veía: el historial exigía `[a-z0-9-]+`, así que
   * **ninguna celda ejecutada sobre una vista del motor llegaba a registrarse**. El `POST` daba
   * 400, el portal se lo traga a propósito para no perder el trabajo de nadie, y la trazabilidad
   * desaparecía en silencio — justo sobre la mitad del cuaderno que lee decisiones de crédito.
   */
  it('el historial acepta el código del motor, que antes rechazaba en silencio', () => {
    const entrada = { language: 'r' as const, source: 'summary(df)', status: 'ok' as const };
    expect(notebookHistoryEntrySchema.safeParse({ ...entrada, datasetCode: 'motor:decisiones.ejecuciones' }).success).toBe(true);
    expect(notebookHistoryEntrySchema.safeParse({ ...entrada, datasetCode: 'customer overview' }).success).toBe(false);
  });

  it('el historial guarda R, y sigue guardando el SQL de la otra consola', () => {
    const base = { source: 'x', status: 'ok' as const };
    for (const language of ['python', 'javascript', 'r', 'sql']) {
      expect(notebookHistoryEntrySchema.safeParse({ ...base, language }).success).toBe(true);
    }
    expect(notebookHistoryEntrySchema.safeParse({ ...base, language: 'bash' }).success).toBe(false);
  });
});
