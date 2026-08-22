/**
 * @file Utilidad pura o acotada reutilizable dentro de su capa.
 * @business Esta pieza evita arranques rotos que se diagnostican como averías de dependencias.
 * @system verifica que el runtime emita metadata de decoradores antes de construir el contenedor.
 */

/** Dependencia de la sonda: sólo existe para dar un tipo al constructor de `MetadataProbe`. */
class MetadataProbeDependency {}

function ProbeDecorator(): ClassDecorator {
  return () => undefined;
}

/**
 * Sonda mínima: una clase decorada con un constructor tipado. Si el runtime emite metadata,
 * `design:paramtypes` existe; si la borra, no.
 */
@ProbeDecorator()
class MetadataProbe {
  constructor(readonly dependency: MetadataProbeDependency) {}
}

/**
 * Comprueba que el runtime que ejecuta la aplicación emita `design:paramtypes`.
 *
 * Por qué existe. NestJS resuelve casi todas sus dependencias leyendo los TIPOS del constructor,
 * que TypeScript emite como metadata sólo con `emitDecoratorMetadata`. Los transpiladores basados
 * en esbuild —`tsx`, `esbuild-register`, `swc` sin `decoratorMetadata: true`— NO la emiten: borran
 * los tipos y siguen adelante. El contenedor se construye igual y revienta más tarde con
 *
 *   Nest can't resolve dependencies of the XService (Repo, ?, +, +). Please make sure that the
 *   argument at index [1] is available in the current module.
 *
 * que señala a un módulo mal cableado. No lo está: exporta exactamente lo que debe. Lo que falta es
 * la metadata, y el mensaje no la menciona en ningún momento — se buscan ciclos de imports que no
 * existen. Este arranque prefiere fallar antes y decir la verdad.
 */
/**
 * `true` si el runtime actual conserva los tipos del constructor.
 *
 * Se comprueba también que `Reflect.getMetadata` exista: sin `reflect-metadata` cargado la API no
 * está, y eso es igual de fatal para Nest que la metadata ausente. Preguntarlo con optional
 * chaining evita que el propio guard reviente con un `TypeError` que volvería a esconder la causa.
 */
export function hasDecoratorMetadata(): boolean {
  const reflect = Reflect as typeof Reflect & { getMetadata?: (key: string, target: unknown) => unknown };
  if (typeof reflect.getMetadata !== 'function') return false;
  return reflect.getMetadata('design:paramtypes', MetadataProbe) !== undefined;
}

/**
 * Nota importante para quien venga a añadir una prueba: **jest tampoco emite esta metadata** en
 * este repositorio (ts-jest con `isolatedModules` transpila sin información de tipos). Es decir,
 * ninguna prueba unitaria puede detectar por sí sola un arranque roto por esta causa: el runtime de
 * pruebas y el de producción difieren justo en lo que aquí se comprueba. Por eso la defensa real
 * son este guard —que corre en el arranque de verdad— y el gate `check:nest-entrypoints`, y por eso
 * el parámetro se inyecta: para poder probar las dos ramas sin depender del runtime de la prueba.
 */
export function assertDecoratorMetadataIsAvailable(metadataAvailable: boolean = hasDecoratorMetadata()): void {
  if (metadataAvailable) return;

  throw new Error(
    [
      'El runtime actual no emite metadata de decoradores (`design:paramtypes`), así que NestJS no',
      'puede resolver dependencias por tipo y fallaría culpando a un módulo sano.',
      '',
      'Causa habitual: arrancar con `tsx`/esbuild, que borra los tipos. Usa el código compilado',
      '(`yarn build && yarn start`) o, en desarrollo, `yarn start:dev`.',
    ].join('\n'),
  );
}
