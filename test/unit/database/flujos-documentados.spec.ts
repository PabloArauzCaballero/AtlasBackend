/**
 * @file Un flujo documentado que apunta a una ruta inexistente es peor que no documentarlo.
 * @business El catálogo de flujos es lo que consume el tablero del portal y lo que un motor de QA
 *   recorre. Una ruta mal escrita ahí manda a alguien a probar un endpoint que nadie sirve.
 * @system Compara los pasos declarados contra el inventario de rutas de la aplicación, sin levantarla.
 *
 * Por qué no se comprueba contra el servicio corriendo: este gate tiene que correr en el PR, donde
 * no hay base ni proceso. El inventario se deriva de los decoradores de los controladores, que es de
 * donde Nest también lo deriva al arrancar.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FLUJO_CLIENTE_COMPLETO } from '../../../src/database/seeders/demo/flujo-cliente-completo.seed-data.js';
import { FLUJO_CLIENTE_PARTNER } from '../../../src/database/seeders/demo/flujo-cliente-partner.seed-data.js';
import type { FlujoDeclarado } from '../../../src/database/seeders/demo/workflow-catalog-flujos.js';

const RAIZ = join(process.cwd(), 'src', 'modules');

function archivosDeControlador(directorio: string): string[] {
  const encontrados: string[] = [];
  for (const entrada of readdirSync(directorio)) {
    const ruta = join(directorio, entrada);
    if (statSync(ruta).isDirectory()) encontrados.push(...archivosDeControlador(ruta));
    else if (entrada.endsWith('.controller.ts')) encontrados.push(ruta);
  }
  return encontrados;
}

/**
 * Inventario `MÉTODO /ruta` a partir de `@Controller('x')` + `@Get('y')`.
 *
 * Se normalizan los nombres de parámetro (`:customerId` → `:p`) porque el catálogo los nombra según
 * lo que significan en el recorrido y el controlador según su firma; lo que tiene que coincidir es
 * la FORMA de la ruta, no cómo se llama cada hueco.
 */
function inventarioDeRutas(): Set<string> {
  const rutas = new Set<string>();
  for (const archivo of archivosDeControlador(RAIZ)) {
    const fuente = readFileSync(archivo, 'utf8');
    // Un archivo puede declarar VARIOS `@Controller`: `social-trust.controller.ts` tiene cuatro,
    // con prefijos distintos (`whatsapp`, `facebook`, `telco`…). Tomar el primero para todo el
    // archivo asignaba a `/whatsapp/verification/start` el prefijo de otro y el gate reportaba
    // huérfana una ruta que el backend sí sirve — un falso positivo que manda a corregir lo que
    // está bien. Se trocea el archivo por cada `@Controller` y cada trozo lleva SU prefijo.
    const marcas = [...fuente.matchAll(/@Controller\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g)];
    const trozos = marcas.map((marca, indice) => ({
      prefijo: marca[1] ?? '',
      cuerpo: fuente.slice(marca.index ?? 0, marcas[indice + 1]?.index ?? fuente.length),
    }));
    for (const trozo of trozos.length > 0 ? trozos : [{ prefijo: '', cuerpo: fuente }]) {
      for (const coincidencia of trozo.cuerpo.matchAll(/@(Get|Post|Put|Patch|Delete)\(\s*(?:['"`]([^'"`]*)['"`])?\s*\)/g)) {
        const metodo = coincidencia[1].toUpperCase();
        const sufijo = coincidencia[2] ?? '';
        const completa = `/${[trozo.prefijo, sufijo].filter(Boolean).join('/')}`.replace(/\/+/g, '/');
        rutas.add(`${metodo} ${normalizar(completa)}`);
      }
    }
  }
  return rutas;
}

function normalizar(ruta: string): string {
  return ruta.replace(/:[A-Za-z0-9_]+/g, ':p').replace(/\/$/, '') || '/';
}

const RUTAS = inventarioDeRutas();

function pasosDe(flujo: FlujoDeclarado) {
  return flujo.stages.flatMap((etapa) => etapa.steps.map((paso) => ({ etapa: etapa.code, ...paso })));
}

describe.each([
  ['customer_full_lifecycle', FLUJO_CLIENTE_COMPLETO],
  ['customer_partner_commerce', FLUJO_CLIENTE_PARTNER],
])('flujo documentado %s', (_codigo, flujo) => {
  const pasos = pasosDe(flujo);

  it('el inventario de rutas del repositorio no está vacío', () => {
    // Si el extractor deja de encontrar controladores, TODAS las comprobaciones de abajo pasarían
    // por vacuidad. Es la trampa clásica de un gate que se mide a sí mismo.
    expect(RUTAS.size).toBeGreaterThan(300);
  });

  it('cada paso apunta a una ruta que el backend SIRVE de verdad', () => {
    const huerfanos = pasos
      .filter((paso) => !RUTAS.has(`${paso.method.toUpperCase()} ${normalizar(paso.path)}`))
      .map((paso) => `${paso.etapa}/${paso.code}: ${paso.method} ${paso.path}`);
    expect(huerfanos).toEqual([]);
  });

  it('ningún código de paso está repetido', () => {
    const codigos = pasos.map((paso) => paso.code);
    expect(codigos).toHaveLength(new Set(codigos).size);
  });

  it('ningún código de etapa está repetido', () => {
    const codigos = flujo.stages.map((etapa) => etapa.code);
    expect(codigos).toHaveLength(new Set(codigos).size);
  });

  it('declara exactamente una etapa de entrada y al menos una terminal', () => {
    expect(flujo.stages.filter((etapa) => etapa.entry)).toHaveLength(1);
    expect(flujo.stages.filter((etapa) => etapa.terminal).length).toBeGreaterThanOrEqual(1);
  });

  it('cada etapa tiene al menos un paso', () => {
    expect(flujo.stages.filter((etapa) => etapa.steps.length === 0).map((etapa) => etapa.code)).toEqual([]);
  });

  it('todo paso tiene nombre y descripción: un catálogo sin prosa no explica nada', () => {
    const mudos = pasos.filter((paso) => paso.name.trim().length < 3 || paso.description.trim().length < 20);
    expect(mudos.map((paso) => paso.code)).toEqual([]);
  });

  it('los pasos públicos son los que de verdad no necesitan sesión', () => {
    // Un paso marcado `auth: false` que en realidad exige token manda a quien lo recorra a un 401
    // que se lee como «el endpoint está roto».
    const publicos = pasos.filter((paso) => paso.auth === false).map((paso) => paso.code);
    for (const codigo of publicos) {
      expect(codigo).toMatch(/consent_documents|verification_channels|survey_catalog|signup|login|logout|partner\.start/);
    }
  });
});

describe('cobertura de los flujos documentados', () => {
  it('el recorrido del cliente cubre las etapas que el producto tiene, no sólo el alta', () => {
    const etapas = FLUJO_CLIENTE_COMPLETO.stages.map((etapa) => etapa.code);
    // Estas son las que faltaban entero antes del 21-sep-2026: el catálogo saltaba del registro a
    // la decisión de crédito y dejaba fuera la mitad del producto.
    expect(etapas).toEqual(
      expect.arrayContaining([
        'identity_capture',
        'address_capture',
        'financial_profile',
        'social_capture',
        'consumer_survey',
        'external_evidence',
        'operator_review',
        'risk_assessment',
        'credit_line',
        'loan_servicing',
        'payment_claims',
        'privacy_exit',
      ]),
    );
  });

  it('el recorrido de comercio declara sus TRES actores', () => {
    const actores = new Set(FLUJO_CLIENTE_PARTNER.stages.map((etapa) => etapa.actor));
    // Un recorrido con un solo actor comprobaría una sola autorización y pasaría en verde.
    expect([...actores].sort()).toEqual(['customer', 'internal_user', 'merchant_user']);
  });

  it('el encuentro en la caja lo ejecuta el CLIENTE sobre el QR del comercio', () => {
    const caja = FLUJO_CLIENTE_PARTNER.stages.find((etapa) => etapa.code === 'point_of_sale');
    expect(caja?.actor).toBe('customer');
    expect(caja?.steps[0].path).toBe('/merchant-qr/resolve');
  });

  it('la aceptación de la compra es del COMERCIO, no del cliente', () => {
    const aceptacion = FLUJO_CLIENTE_PARTNER.stages.flatMap((etapa) => etapa.steps).find((paso) => paso.code === 'pos.partner_acceptance');
    // Que el cliente pudiera aceptar su propia compra sería el defecto de autorización más caro
    // posible en este producto.
    expect(aceptacion?.roles).toEqual(['merchant_user']);
  });

  it('los dos flujos juntos documentan más endpoints que los tres que había', () => {
    const total = pasosDe(FLUJO_CLIENTE_COMPLETO).length + pasosDe(FLUJO_CLIENTE_PARTNER).length;
    expect(total).toBeGreaterThan(100);
  });
});
