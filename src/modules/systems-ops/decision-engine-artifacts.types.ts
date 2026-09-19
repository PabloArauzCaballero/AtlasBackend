/**
 * @file Tipos de dominio: hacen explícitos estados y contratos internos.
 * @business Esta pieza deja ver, desde el portal, qué política está decidiendo crédito ahora mismo.
 * @system valida lo que el motor de decisión responde antes de dejarlo entrar en el panel.
 */
import { z } from 'zod';

/**
 * Recorte VALIDADO de los contratos del motor de decisión.
 *
 * Sólo se declara lo que esta vista usa, y todo lo demás se ignora en vez de rechazarse: el motor
 * es otro repositorio con su propio ciclo de despliegue y añade campos a sus respuestas
 * continuamente. Un esquema estricto convertiría cada mejora suya en una pantalla rota aquí.
 *
 * Lo que sí se valida es la forma de lo que se lee. Sin ello, un cambio de nombre en el otro lado
 * llegaría al portal como `undefined` pintado en una tabla, y nadie sabría si la política no tiene
 * versión o si el campo cambió de nombre.
 */
const trafficRuleSchema = z.object({
  segmentKey: z.string().optional(),
  trafficPercentage: z.number().optional(),
  priority: z.number().optional(),
});

const artifactSchema = z.object({
  id: z.string(),
  artifactCode: z.string(),
  name: z.string(),
  artifactType: z.string().optional(),
  ownerTeam: z.string().optional(),
  latestVersion: z.string().nullable().optional(),
  latestStatus: z.string().nullable().optional(),
  environmentCode: z.string().nullable().optional(),
  lastValidatedAt: z.string().nullable().optional(),
});

const deploymentSchema = z.object({
  id: z.string(),
  deploymentMode: z.string(),
  deploymentStatus: z.string(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable().optional(),
  isActive: z.boolean(),
  deployedBy: z.string(),
  deployedAt: z.string(),
  environmentId: z.string(),
  environment: z.object({ id: z.string(), code: z.string(), name: z.string(), isProduction: z.boolean().optional() }).optional(),
  artifactVersion: z
    .object({
      id: z.string(),
      versionNumber: z.number().optional(),
      status: z.string().optional(),
      artifact: z.object({ artifactCode: z.string(), name: z.string() }).optional(),
    })
    .optional(),
  traffic: z.array(trafficRuleSchema).optional(),
});

export const artifactPageSchema = z.object({ items: z.array(artifactSchema) });
export const deploymentPageSchema = z.object({ items: z.array(deploymentSchema) });

export type DecisionEngineArtifact = z.infer<typeof artifactSchema>;
export type DecisionEngineDeployment = z.infer<typeof deploymentSchema>;

export interface ActiveArtifactTrafficRule {
  segmentKey: string | null;
  trafficPercentage: number | null;
  priority: number | null;
}

export interface ActiveArtifactRow {
  deploymentId: string;
  artifactCode: string;
  artifactName: string;
  artifactType: string | null;
  ownerTeam: string | null;
  versionNumber: number | null;
  semanticVersion: string | null;
  versionStatus: string | null;
  environmentCode: string;
  deploymentStatus: string;
  deploymentMode: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  deployedBy: string;
  deployedAt: string;
  lastValidatedAt: string | null;
  trafficRules: ActiveArtifactTrafficRule[];
}

export interface ActiveArtifactReport {
  generatedAt: string;
  /** `OK` | `NOT_CONFIGURED` | `UNREACHABLE`. Cada uno pide una acción distinta del operador. */
  status: string;
  message: string;
  environmentFilter: string | null;
  items: ActiveArtifactRow[];
}
