/**
 * @file Adaptador: árbol de la siembra (`FlujoDeclarado`) → etapas de un proceso declarado en código.
 * @business Esta pieza evita tener dos copias del mismo recorrido —la que ejecuta QA y la que documenta el proceso— que acabarían diciendo cosas distintas.
 * @system añade a cada etapa el cliente desde el que se actúa, deducido del actor.
 */
import type { FlujoDeclarado } from '../../../database/seeders/demo/workflow-catalog-flujos.js';
import type { ProcessClientCode, ProcessStageFixture } from './workflow-definition.types.js';

const CLIENT_BY_ACTOR: Record<string, ProcessClientCode> = {
  customer: 'CONSUMER_APP',
  internal_user: 'ADMIN_PORTAL',
  merchant_user: 'ERP_PORTAL',
  system: 'BLOCK',
};

/** `screens`: la pantalla del portal donde actúa la persona en cada etapa (el árbol de la siembra no la sabe). */
export function stagesFromTree(tree: FlujoDeclarado, screens: Record<string, string> = {}): ProcessStageFixture[] {
  return tree.stages.map((stage) => ({
    ...stage,
    client: CLIENT_BY_ACTOR[stage.actor] ?? 'BLOCK',
    ...(screens[stage.code] ? { screen: screens[stage.code] } : {}),
  }));
}
