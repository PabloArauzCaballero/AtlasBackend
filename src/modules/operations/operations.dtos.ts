/**
 * @file DTOs: contrato estable de salida sin filtrar modelos de persistencia.
 * @business Esta pieza permite resolver excepciones y revisiones manuales con responsabilidad y trazabilidad.
 * @system gestiona colas y decisiones operativas mediante servicios transaccionales y repositorios aislados.
 */
import { PaginationMeta } from '../../common/utils/pagination/pagination.util.js';

export type WorkQueueItemDto = {
  workItemType: 'manual_review' | 'fraud';
  caseId: string;
  caseCode: string | null;
  customerId: string | null;
  priority: string | null;
  status: string | null;
  reasonCode: string | null;
  openedAt: string | null;
  createdAt: string;
};

export type PaginatedWorkQueueResponseDto = {
  items: WorkQueueItemDto[];
  meta: PaginationMeta;
};

export type ContactSummaryDto = {
  contactType: string | null;
  status: string | null;
  isPrimary: boolean | null;
  valueLast4: string | null;
};

export type ConsentSummaryDto = {
  purposeCode: string | null;
  granted: boolean | null;
  grantedAt: string | null;
  revokedAt: string | null;
};

export type RiskSummaryDto = {
  riskAssessmentRunId: string;
  assessmentType: string | null;
  recommendedAction: string | null;
  riskLevel: string | null;
  fraudScore: number | null;
  decidedAt: string | null;
};

export type ManualReviewSummaryDto = {
  caseId: string;
  caseCode: string | null;
  caseType: string | null;
  priority: string | null;
  status: string | null;
  openedAt: string | null;
};

export type FraudCaseSummaryDto = {
  caseId: string;
  caseCode: string | null;
  severity: string | null;
  caseStatus: string | null;
  openedAt: string | null;
};

/**
 * Lo que se sabe de la IDENTIDAD de este cliente, para quien investiga un caso.
 *
 * Es la mitad que faltaba del expediente. La pantalla enseñaba perfil, contactos,
 * consentimientos y casos abiertos, y nada de la verificación de identidad: quien
 * investigaba un caso de fraude documental tenía que abrir otra herramienta para
 * saber si el carnet siquiera se había verificado, y con qué resultado.
 *
 * `fraudRisk` viene de `identity_verification_attempts.document_forensics_score`,
 * que desde el artefacto 1.2.0 guarda el riesgo de fraude documental del worker y
 * no —como antes— la evidencia de que la imagen fuera un carnet. Son dos
 * preguntas distintas y el nombre de la columna siempre describió la segunda.
 */
export type IdentitySummaryDto = {
  attemptId: string;
  channel: string | null;
  result: string | null;
  /** Parecido biométrico entre el retrato del carnet y la selfie, en `[0,1]`. */
  similarity: number | null;
  /** Riesgo de fraude documental medido por el worker, en `[0,1]`. */
  fraudRisk: number | null;
  requestedAt: string | null;
  completedAt: string | null;
};

/**
 * La FORMA de la agenda del cliente. Nunca su contenido.
 *
 * Lo que llega aquí son las cuentas que el teléfono calculó y los cruces que el
 * servidor resolvió; ni un nombre, ni un teléfono, ni un hash. Ver
 * `customer-contacts-snapshot.schemas.ts`, donde está la razón entera.
 *
 * `available: false` significa que no hay captura o que la persona no dio el
 * permiso, y NO es lo mismo que una agenda vacía: hay menos evidencia, no
 * evidencia en contra. La pantalla tiene que poder decir esa diferencia.
 */
export type AddressBookSummaryDto = {
  available: boolean;
  totalContacts: number;
  uniqueRatio: number;
  bolivianRatio: number;
  referencesFoundInAddressBook: number;
  riskMatches: number;
};

export type InvestigationSummaryResponseDto = {
  customer: {
    customerId: string;
    customerCode: string | null;
    status: string | null;
    phoneLast4: string | null;
    emailDomain: string | null;
    createdAt: string;
  };
  profile: {
    firstName: string | null;
    lastName: string | null;
    birthDate: string | null;
    preferredLanguage: string | null;
  } | null;
  contacts: ContactSummaryDto[];
  consents: ConsentSummaryDto[];
  latestRiskAssessment: RiskSummaryDto | null;
  manualReviewCases: ManualReviewSummaryDto[];
  fraudCases: FraudCaseSummaryDto[];
  latestIdentityVerification: IdentitySummaryDto | null;
  addressBook: AddressBookSummaryDto;
};
