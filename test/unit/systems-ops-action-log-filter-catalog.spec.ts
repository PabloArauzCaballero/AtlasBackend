import { buildActionLogFilterCatalog } from '../../src/modules/systems-ops/action-log-filter-catalog.js';
import { systemsActionLogQuerySchema } from '../../src/modules/systems-ops/systems-ops.schemas.js';

/**
 * El catálogo de filtros de la auditoría.
 *
 * Existe por un desajuste que no se veía desde ninguno de los dos lados: el
 * endpoint aceptaba once filtros y la pantalla ofrecía tres, con sus opciones
 * COPIADAS A MANO en un array de React. Las consecuencias eran dos y ambas
 * silenciosas — ocho filtros que para quien usaba el portal no existían, y unas
 * opciones que podían separarse del esquema sin que nada fallara hasta que
 * alguien filtrara y recibiera un 400.
 *
 * Lo que se fija aquí es que las opciones SALGAN del esquema y no de una copia.
 * Si mañana se añade un método HTTP o un nivel de riesgo, el catálogo lo publica
 * solo; si alguien vuelve a escribirlos a mano, esta prueba se pone roja.
 */

const CATALOGO = buildActionLogFilterCatalog({
  modules: ['customers', 'risk'],
  actorTypes: ['INTERNAL_USER', 'SERVICE'],
});

function campo(nombre: string) {
  const encontrado = CATALOGO.fields.find((field) => field.name === nombre);
  if (!encontrado) throw new Error(`El catálogo no publica el filtro «${nombre}».`);
  return encontrado;
}

describe('los conjuntos cerrados salen del esquema, no de una copia', () => {
  it('publica exactamente los métodos que el endpoint acepta', () => {
    const delEsquema = systemsActionLogQuerySchema.shape.method.unwrap().options;
    expect(campo('method').options.map((opcion) => opcion.value)).toEqual([...delEsquema]);
  });

  it('publica exactamente los niveles de riesgo que el endpoint acepta', () => {
    const delEsquema = systemsActionLogQuerySchema.shape.riskLevel.unwrap().options;
    expect(campo('riskLevel').options.map((opcion) => opcion.value)).toEqual([...delEsquema]);
  });

  it('explica qué significa cada nivel de riesgo', () => {
    // «HIGH» a secas no dice nada a quien no escribió la instrumentación, y esa
    // es justo la persona que filtra una auditoría.
    for (const opcion of campo('riskLevel').options) {
      expect(opcion.label).toContain('·');
    }
  });
});

describe('los conjuntos abiertos salen de la bitácora', () => {
  it('ofrece los módulos que de verdad aparecen, marcados como tal', () => {
    const modulo = campo('module');
    expect(modulo.source).toBe('DATA');
    expect(modulo.options.map((opcion) => opcion.value)).toEqual(['customers', 'risk']);
  });

  it('sin datos, el filtro existe pero sin opciones que ofrecer', () => {
    // Vacío NO es lo mismo que ausente: el filtro sigue publicándose para que la
    // pantalla pueda decir «todavía no hay módulos registrados» en vez de callar.
    const vacio = buildActionLogFilterCatalog({ modules: [], actorTypes: [] });
    const modulo = vacio.fields.find((field) => field.name === 'module');
    expect(modulo).toBeDefined();
    expect(modulo?.options).toEqual([]);
  });
});

describe('el catálogo cubre TODO lo que el endpoint acepta', () => {
  it('no deja ningún filtro del esquema sin publicar', () => {
    // Ésta es la prueba que impide que el desajuste vuelva: si alguien añade un
    // filtro al esquema y no al catálogo, la pantalla no podría ofrecerlo nunca
    // y nada lo delataría.
    const noSonFiltros = new Set(['page', 'limit', 'endpointId']);
    const delEsquema = Object.keys(systemsActionLogQuerySchema.shape).filter((nombre) => !noSonFiltros.has(nombre));
    const publicados = CATALOGO.fields.map((field) => field.name);

    expect([...delEsquema].sort()).toEqual([...publicados].sort());
  });

  it('cada filtro dice qué control necesita', () => {
    // Es lo que evita el defecto original: un `input` de texto donde
    // conceptualmente hay un conjunto cerrado de opciones.
    for (const field of CATALOGO.fields) {
      expect(field.control).toBeTruthy();
      if (field.control === 'select' || field.control === 'boolean') {
        expect(field.options.length).toBeGreaterThan(0);
      }
    }
  });
});
