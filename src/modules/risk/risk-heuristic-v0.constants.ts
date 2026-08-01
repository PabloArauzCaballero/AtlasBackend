/**
 * `createRiskAssessment` calcula el score con reglas heurísticas fijas en código (identidad
 * presente = 70/30, contacto verificado = 90/45, etc.), no con un scorecard crediticio
 * calibrado, versionado y auditable por reglas activas en base de datos. Sirve como motor v0
 * para el flujo de onboarding, pero no debe presentarse como scoring financiero final — de ahí
 * el nombre explícito `risk_heuristic_v0` en vez de algo que sugiera un modelo entrenado o
 * aprobado por riesgo. Cuando exista un motor real basado en políticas versionadas
 * (`risk-policy/current` o tabla equivalente), estas constantes deben reemplazarse por el
 * `modelCode`/`modelVersion` que devuelva ese motor en cada corrida.
 */
export const RISK_MODEL_CODE = 'risk_heuristic_v0';
export const RISK_MODEL_VERSION = 'v0';
export const RISK_RULESET_VERSION = 'rules-v1';

/**
 * Umbrales del nivel de riesgo heurístico, sobre el puntaje total de 0 a 100.
 *
 * Estaban escritos como literales dentro de `createRiskAssessment` (`>= 75 ? 'low' : >= 55 ? …`).
 * Aquí quedan con nombre porque son la frontera que un analista quiere leer y discutir sin abrir el
 * servicio — y porque el día que los decida una política versionada, este es el único sitio a mirar.
 */
export const RISK_LEVEL_THRESHOLDS = { low: 75, medium: 55 } as const;

/**
 * Puntaje mínimo con el que la decisión de RESPALDO aprueba el paso siguiente.
 *
 * Sólo aplica cuando no hay ruleset activo que decida. No es un umbral de crédito: es el mínimo para
 * seguir el onboarding sin intervención humana.
 */
export const RISK_APPROVAL_MIN_SCORE = 65;
