/**
 * @file Puerto de hechos de entrada de Riesgo (AT-027).
 * @business Riesgo evalúa con hechos autorizados del cliente —estado, consentimiento vigente, contactos
 *   verificados, identidad— sin importar los repositorios de Clientes ni leer sus tablas por su cuenta.
 * @system Interfaz + token. El adaptador local los lee de la misma base; un adaptador remoto los pediría
 *   al dueño. `readAt` deja constancia de la frescura de los hechos con los que se decidió.
 */
export type RiskInputFacts = Readonly<{
  /** `false` cuando el cliente no existe en el tenant: el caso de uso responde 404, no evalúa. */
  exists: boolean;
  lifecycleStatus: string | null;
  hasGrantedConsent: boolean;
  verifiedContactCount: number;
  hasIdentity: boolean;
  readAt: string;
}>;

export interface RiskInputFactsPort {
  loadFacts(tenantId: string, customerId: string): Promise<RiskInputFacts>;
}

export const RISK_INPUT_FACTS_PORT = 'atlas.risk.input-facts-port';
