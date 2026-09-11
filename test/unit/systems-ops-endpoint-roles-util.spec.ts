import {
  classDecorators,
  classRoles,
  composedRoleDecorators,
  methodDecorators,
  resolveRoleConstants,
  listConstantsIn,
  roleConstantsFromSources,
  routeRoles,
} from '../../src/modules/systems-ops/endpoint-roles.util.js';
import { SYSTEMS_OPS_ROLES } from '../../src/modules/systems-ops/systems-ops.constants.js';

/**
 * La regla de `RolesGuard` leída del código: el `@Roles` del método manda y, sin él, el de la clase. Cada caso es una forma
 * en la que el escaneo anterior asignaba mal los roles (119 de 498 rutas contra el compilador).
 */
const otroModulo = `export const BASE_ROLES = ['admin'] as const;`;
// El decorador compuesto real del repositorio, tal cual: Nest lo aplica como el `@Roles` que envuelve.
const decoradorCompuesto = `export function SystemsOpsControllerSecurity() {
  return applyDecorators(
    ApiTags('systems-ops'),
    UseGuards(JwtAuthGuard, RolesGuard),
    Roles(...SYSTEMS_OPS_ROLES),
  );
}`;
const controlador = `import { Roles } from 'x';
const LOCAL_ROLES = ['customer', ...BASE_ROLES] as const;

@UseGuards(RolesGuard)
@Roles('internal_operator')
@Controller('things')
export class ThingsController {
  constructor(private readonly svc: Svc) {}

  @Roles(...LOCAL_ROLES)
  @ApiOperation({
    summary: 'multilínea',
  })
  @Get('a')
  async a() {
    return 1;
  }

  // @Roles('comentado') no es un decorador
  @Get('b')
  b() {
    return 2;
  }

  @Roles(...NO_EXISTE)
  @Post('c')
  c() {}
}
`;

function rolesDe(source: string, ruta: string, globales = roleConstantsFromSources([otroModulo, source])) {
  const start = source.indexOf('@Controller(');
  const classBlock = source.slice(start);
  const constants = resolveRoleConstants(listConstantsIn(source), globales);
  const compuestos = composedRoleDecorators([decoradorCompuesto], constants);
  const fromClass = classRoles(classDecorators(source, start, classBlock), constants, compuestos);
  return routeRoles(methodDecorators(classBlock, classBlock.indexOf(ruta)), fromClass, constants, compuestos);
}

describe('endpoint-roles.util', () => {
  it('un decorador multilínea entre @Roles y la ruta no deja el @Roles fuera', () => {
    expect(rolesDe(controlador, "@Get('a')")).toEqual(['customer', 'admin']);
  });

  it('una ruta sin @Roles hereda el de la clase, aunque vaya encima de @Controller, y un comentario no cuenta', () => {
    expect(rolesDe(controlador, "@Get('b')")).toEqual(['internal_operator']);
  });

  it('un @Roles de método con una constante que no existe se dice y NO hereda el de la clase', () => {
    expect(rolesDe(controlador, "@Post('c')")).toEqual(['<unresolved:NO_EXISTE>']);
  });

  it('entre @Roles y @SystemsOpsControllerSecurity de clase manda el de más arriba, que Nest aplica el último', () => {
    const conSeguridadArriba =
      "@SystemsOpsControllerSecurity()\n@Roles('x')\n@Controller('s')\nexport class S {\n  @Get('r')\n  r() {}\n}\n";
    const conRolesArriba = "@Roles('x')\n@SystemsOpsControllerSecurity()\n@Controller('s')\nexport class S {\n  @Get('r')\n  r() {}\n}\n";
    expect(rolesDe(conSeguridadArriba, "@Get('r')")).toEqual([...SYSTEMS_OPS_ROLES]);
    expect(rolesDe(conRolesArriba, "@Get('r')")).toEqual(['x']);
  });

  it('una constante declarada con valores distintos en dos ficheros no se adivina, salvo la del propio controlador', () => {
    const globales = roleConstantsFromSources(["const DOBLE = ['a'];", "const DOBLE = ['b'];"]);
    expect(globales.DOBLE).toBeUndefined();
    const controladorSinLocal = "@Controller('d')\nexport class D {\n  @Roles(...DOBLE)\n  @Get('r')\n  r() {}\n}\n";
    expect(rolesDe(controladorSinLocal, "@Get('r')", globales)).toEqual(['<unresolved:DOBLE>']);
    expect(rolesDe(`const DOBLE = ['local'];\n${controladorSinLocal}`, "@Get('r')", globales)).toEqual(['local']);
  });
  it('un decorador compuesto del repositorio (`applyDecorators(Roles(...))`) cuenta como su @Roles, en clase y en método', () => {
    const conCompuesto =
      "@SystemsOpsControllerSecurity()\n@Controller('s')\nexport class S {\n  @Get('r')\n  r() {}\n\n  @SystemsOpsControllerSecurity()\n  @Get('m')\n  m() {}\n}\n";
    expect(rolesDe(conCompuesto, "@Get('r')")).toEqual([...SYSTEMS_OPS_ROLES]);
    expect(rolesDe(conCompuesto, "@Get('m')")).toEqual([...SYSTEMS_OPS_ROLES]);
  });

  it('un rol que no es texto (`ROLE.ADMIN`) se dice, no se calla: una lista vacía se lee «sin restricción»', () => {
    const conEnum = "@Controller('e')\nexport class E {\n  @Roles(ROLE.ADMIN)\n  @Get('r')\n  r() {}\n}\n";
    expect(rolesDe(conEnum, "@Get('r')")).toEqual(['<unresolved:ROLE.ADMIN>']);
  });

  it('un comentario al final de línea no corta la lista de roles, y la indentación de 4 espacios no cruza métodos', () => {
    const conComentario =
      "const CON_COMENTARIO = [\n  'admin', // antes [ops]\n  'risk_analyst',\n];\n@Controller('c')\nexport class C {\n    @Roles(...CON_COMENTARIO)\n    @Get('a')\n    a() {\n      return 1;\n    }\n\n    @Get('b')\n    b() {}\n}\n";
    expect(rolesDe(conComentario, "@Get('a')")).toEqual(['admin', 'risk_analyst']);
    expect(rolesDe(conComentario, "@Get('b')")).toEqual([]);
  });
  it('un decorador compuesto escrito en una línea, o seguido de otro, se resuelve sin contagiarse', () => {
    const enUnaLinea = "export const Seg = () => applyDecorators(UseGuards(G), Roles('admin', 'platform_admin'));";
    const sinRoles = "export const A = () => applyDecorators(ApiTags('x'));";
    const conRoles = "export const B = () => applyDecorators(\n  Roles('risk_analyst'),\n);";
    const constantes = roleConstantsFromSources([]);
    expect(composedRoleDecorators([enUnaLinea], constantes).Seg).toEqual(['admin', 'platform_admin']);
    // La declaración de al lado no le presta su `@Roles`: antes el barrido cruzaba de una a otra.
    const dos = composedRoleDecorators([`${sinRoles}\n${conRoles}`], constantes);
    expect(dos.A).toBeUndefined();
    expect(dos.B).toEqual(['risk_analyst']);
  });
});
