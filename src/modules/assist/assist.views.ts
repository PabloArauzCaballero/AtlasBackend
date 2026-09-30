/**
 * @file Traducciones puras: lo que contesta el servicio de IA, a las vistas del historial.
 * @business Esta pieza responde dudas de uso de la app y de los portales sin hacer esperar a una persona del equipo.
 * @system descarta lo mal formado y deja sólo los campos que se le enseñan a quien pregunta.
 */
import type {
  AssistConversationDetailView,
  AssistConversationListView,
  AssistConversationSummaryView,
  AssistConversationView,
  AssistTurnView,
} from './assist.schemas.js';

export function vistaDeLista(json: Record<string, unknown>): AssistConversationListView {
  const crudas = Array.isArray(json.conversations) ? json.conversations : [];
  const conversations: AssistConversationSummaryView[] = [];
  for (const cruda of crudas) {
    if (!cruda || typeof cruda !== 'object') continue;
    const c = cruda as Record<string, unknown>;
    if (typeof c.conversationId !== 'string' || typeof c.title !== 'string') continue;
    conversations.push({
      conversationId: c.conversationId,
      title: c.title,
      updatedAt: typeof c.updatedAt === 'string' ? c.updatedAt : '',
      turnCount: typeof c.turnCount === 'number' && Number.isFinite(c.turnCount) ? c.turnCount : 0,
    });
  }
  return { conversations };
}

export function vistaDeDetalle(json: Record<string, unknown>, id: string): AssistConversationDetailView {
  const { turns } = vistaDeConversacion(json);
  return {
    conversationId: typeof json.conversationId === 'string' ? json.conversationId : id,
    title: typeof json.title === 'string' ? json.title : '',
    turns,
  };
}

export function vistaDeConversacion(json: Record<string, unknown>): AssistConversationView {
  const turnsCrudos = Array.isArray(json.turns) ? json.turns : [];
  const turns: AssistTurnView[] = [];
  for (const crudo of turnsCrudos) {
    if (!crudo || typeof crudo !== 'object') continue;
    const turno = crudo as Record<string, unknown>;
    if (typeof turno.turnId !== 'string' || typeof turno.prompt !== 'string' || typeof turno.reply !== 'string') continue;
    turns.push({
      turnId: turno.turnId,
      prompt: turno.prompt,
      reply: turno.reply,
      suggestHandoff: turno.suggestHandoff === true,
      createdAt: typeof turno.createdAt === 'string' ? turno.createdAt : '',
    });
  }
  return { conversationId: typeof json.conversationId === 'string' ? json.conversationId : null, turns };
}
