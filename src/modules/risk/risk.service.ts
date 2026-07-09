import { BadRequestException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { AuthenticatedUser } from '../../common/types/auth.types.js';
import { assertOwnCustomerResource } from '../../common/utils/auth/ownership.util.js';
import { sha256Hex } from '../../common/utils/crypto/hash.util.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { RISK_MODEL_CODE, RISK_MODEL_VERSION, RISK_RULESET_VERSION } from './risk-heuristic-v0.constants.js';
import { RiskAssessmentResultResponseDto } from './risk.dtos.js';
import { toRiskAssessmentResultResponse } from './risk.mapper.js';
import { RiskRepository } from './risk.repository.js';
import { CreateRiskAssessmentDto } from './risk.schemas.js';

function toScore(value: number): string {
  return Math.max(0, Math.min(100, value)).toFixed(2);
}

@Injectable()
export class RiskService {
  constructor(
    private readonly riskRepository: RiskRepository,
    private readonly customersRepository: CustomersRepository,
    @InjectConnection() private readonly sequelize: Sequelize,
  ) {}

  async getLatestCustomerRiskResult(input: {
    tenantId: string;
    customerId: string;
    currentUser: AuthenticatedUser;
  }): Promise<RiskAssessmentResultResponseDto | null> {
    assertOwnCustomerResource(input.currentUser, input.customerId);

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) {
      throw new NotFoundException('Cliente no encontrado.');
    }

    const result = await this.riskRepository.findLatestCustomerRiskResult(input.tenantId, input.customerId);
    return result ? toRiskAssessmentResultResponse(result) : null;
  }

  async createRiskAssessment(input: {
    tenantId: string;
    customerId: string;
    body: CreateRiskAssessmentDto;
    currentUser: AuthenticatedUser;
    idempotencyKey: string;
  }) {
    if (!input.idempotencyKey) throw new BadRequestException('X-Idempotency-Key header is required.');
    assertOwnCustomerResource(input.currentUser, input.customerId);

    const customer = await this.customersRepository.findById(input.tenantId, input.customerId);
    if (!customer) throw new NotFoundException('Cliente no encontrado.');
    if (customer.lifecycleStatus === 'blocked') {
      throw new UnprocessableEntityException('CUSTOMER_BLOCKED_FOR_RISK_ASSESSMENT');
    }

    const [consents, contacts, identities] = await Promise.all([
      this.riskRepository.findCustomerConsents(input.tenantId, input.customerId),
      this.riskRepository.findCustomerContacts(input.tenantId, input.customerId),
      this.riskRepository.findIdentityDocuments(input.tenantId, input.customerId),
    ]);

    const hasGrantedConsent = consents.some((consent) => consent.granted === true && !consent.revokedAt);
    if (!hasGrantedConsent) throw new UnprocessableEntityException('REQUIRED_CONSENT_MISSING');

    // NOTA (P1-03 del reporte de auditoría): esto es un motor heurístico v0 — puntajes fijos
    // codificados a mano, no un scorecard crediticio calibrado ni versionado en base de datos.
    // Sirve para el flujo de onboarding actual pero no debe presentarse como score financiero
    // final. `RISK_MODEL_CODE`/`RISK_MODEL_VERSION` (ver risk-heuristic-v0.constants.ts) hacen
    // ese límite explícito en la respuesta y en el registro persistido de cada corrida.
    const verifiedContactCount = contacts.filter((contact) => contact.status === 'verified').length;
    const hasIdentity = identities.length > 0;
    const identityScore = hasIdentity ? 70 : 30;
    const contactScore = verifiedContactCount > 0 ? 90 : 45;
    const deviceScore = input.body.deviceId ? 70 : 55;
    const behaviorScore = 50;
    const consistencyScore = hasIdentity && verifiedContactCount > 0 ? 75 : 45;
    const fraudScore = hasIdentity && verifiedContactCount > 0 ? 20 : 55;
    const totalScore = Math.round((identityScore + contactScore + deviceScore + behaviorScore + consistencyScore + (100 - fraudScore)) / 6);

    const missing: string[] = [];
    if (!hasIdentity) missing.push('identity_document');
    if (verifiedContactCount === 0) missing.push('verified_contact');

    const decision = missing.length > 0 ? 'manual_review_required' : totalScore >= 65 ? 'approved_for_next_step' : 'manual_review_required';
    const riskLevel = totalScore >= 75 ? 'low' : totalScore >= 55 ? 'medium' : 'high';
    const now = new Date();
    const reasons = missing.length > 0 ? missing.map((code) => `missing_${code}`) : ['minimum_onboarding_risk_passed'];

    return this.sequelize.transaction(async (transaction) => {
      const featureRun = await this.riskRepository.createFeatureComputationRun(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          sessionId: input.body.sessionId ?? null,
          deviceId: input.body.deviceId ?? null,
          runReason: input.body.assessmentType,
          triggerSource: input.body.channel,
          idempotencyKey: input.idempotencyKey,
          now,
        },
        { transaction },
      );

      const featureMap = {
        hasGrantedConsent,
        verifiedContactCount,
        hasIdentity,
        identityScore,
        contactScore,
        deviceScore,
        behaviorScore,
        consistencyScore,
        fraudScore,
      };
      for (const [featureCode, value] of Object.entries(featureMap)) {
        await this.riskRepository.createFeatureValue(
          {
            tenantId: input.tenantId,
            computationRunId: String(featureRun.id),
            customerId: input.customerId,
            sessionId: input.body.sessionId ?? null,
            deviceId: input.body.deviceId ?? null,
            featureCode,
            valueNumber: typeof value === 'number' ? value.toFixed(4) : null,
            valueBoolean: typeof value === 'boolean' ? value : null,
            valueText: null,
            valueJson: null,
            now,
          },
          { transaction },
        );
      }

      const snapshot = await this.riskRepository.createFeatureSnapshot(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          deviceId: input.body.deviceId ?? null,
          sessionId: input.body.sessionId ?? null,
          featuresJson: featureMap,
          missingFeaturesJson: { missing },
          integrityHash: sha256Hex(JSON.stringify(featureMap)),
          now,
        },
        { transaction },
      );

      const run = await this.riskRepository.createRiskAssessmentRun(
        {
          tenantId: input.tenantId,
          customerId: input.customerId,
          sessionId: input.body.sessionId ?? null,
          deviceId: input.body.deviceId ?? null,
          featureSnapshotId: String(snapshot.id),
          assessmentType: input.body.assessmentType,
          triggerSource: input.body.channel,
          idempotencyKey: input.idempotencyKey,
          now,
        },
        { transaction },
      );
      await this.riskRepository.attachSnapshotToRun(snapshot, String(run.id), { transaction });
      await this.riskRepository.createRiskAssessmentContext(
        {
          tenantId: input.tenantId,
          riskAssessmentRunId: String(run.id),
          contextPayloadHash: sha256Hex(JSON.stringify(input.body.requestedLimitContext ?? {})),
          now,
        },
        { transaction },
      );

      for (const reason of reasons) {
        await this.riskRepository.createRuleFired(
          {
            tenantId: input.tenantId,
            riskAssessmentRunId: String(run.id),
            ruleCode: reason,
            riskDimension: reason.includes('identity') ? 'identity' : 'onboarding',
            outputAction: decision,
            reasonCode: reason,
            severity: decision === 'manual_review_required' ? 'medium' : 'low',
            isHardStop: false,
            inputValues: featureMap,
            rulesetVersionCode: RISK_RULESET_VERSION,
            now,
          },
          { transaction },
        );
      }

      await this.riskRepository.createContribution(
        {
          tenantId: input.tenantId,
          riskAssessmentRunId: String(run.id),
          featureCode: 'identity_and_contact_readiness',
          rawValue: { hasIdentity, verifiedContactCount },
          scorePoints: toScore((identityScore + contactScore) / 2),
          reasonCode: hasIdentity && verifiedContactCount > 0 ? 'positive_readiness' : 'missing_onboarding_data',
          now,
        },
        { transaction },
      );

      const result = await this.riskRepository.createRiskResult(
        {
          tenantId: input.tenantId,
          runId: String(run.id),
          customerId: input.customerId,
          sessionId: input.body.sessionId ?? null,
          deviceId: input.body.deviceId ?? null,
          assessmentType: input.body.assessmentType,
          recommendedAction: decision,
          riskLevel,
          scoreTotal: toScore(totalScore),
          fraudScore: toScore(fraudScore),
          identityScore: toScore(identityScore),
          deviceRiskScore: toScore(deviceScore),
          behaviorScore: toScore(behaviorScore),
          contactabilityScore: toScore(contactScore),
          consistencyScore: toScore(consistencyScore),
          reasonCodes: { reasons },
          featureSnapshotId: String(snapshot.id),
          integrityHash: sha256Hex(`${run.id}:${decision}:${totalScore}`),
          modelVersionCode: RISK_MODEL_VERSION,
          rulesetVersionCode: RISK_RULESET_VERSION,
          now,
        },
        { transaction },
      );

      let manualReviewCaseId: string | null = null;
      if (decision === 'manual_review_required') {
        const manualCase = await this.riskRepository.createManualReviewCase(
          {
            tenantId: input.tenantId,
            customerId: input.customerId,
            riskAssessmentRunId: String(run.id),
            priority: riskLevel === 'high' ? 'high' : 'medium',
            caseType: 'risk_assessment_review',
            notes: `Revisión requerida: ${reasons.join(', ')}`,
            now,
          },
          { transaction },
        );
        manualReviewCaseId = String(manualCase.id);
        for (const missingCode of missing) {
          await this.riskRepository.createDataQualityIssue(
            { tenantId: input.tenantId, targetRecordId: input.customerId, issueCode: `missing_${missingCode}`, now },
            { transaction },
          );
        }
      }
      await this.riskRepository.createAudit(
        {
          tenantId: input.tenantId,
          actorType: input.currentUser.role,
          actorInternalUserId: input.currentUser.internalUserId ?? null,
          actionCode: 'risk_assessment.created',
          targetId: input.customerId,
          payload: { runId: String(run.id), resultId: String(result.id), decision, manualReviewCaseId },
          now,
        },
        { transaction },
      );

      return {
        riskAssessmentRunId: String(run.id),
        riskAssessmentResultId: String(result.id),
        decision,
        riskLevel,
        fraudRiskLevel: fraudScore >= 70 ? 'high' : fraudScore >= 40 ? 'medium' : 'low',
        manualReviewCaseId,
        nextStep: decision === 'manual_review_required' ? 'manual_review' : 'continue_onboarding',
        reasons: reasons.map((code) => ({ code, message: code.replaceAll('_', ' ') })),
        modelCode: RISK_MODEL_CODE,
        modelVersion: RISK_MODEL_VERSION,
        rulesetVersion: RISK_RULESET_VERSION,
      };
    });
  }

  async getRiskAssessmentDetail(tenantId: string, runId: string) {
    const [run, result, rules, contributions, snapshot] = await Promise.all([
      this.riskRepository.findRiskRun(tenantId, runId),
      this.riskRepository.findRiskResultByRun(tenantId, runId),
      this.riskRepository.findRulesByRun(tenantId, runId),
      this.riskRepository.findContributionsByRun(tenantId, runId),
      this.riskRepository.findSnapshotByRun(tenantId, runId),
    ]);
    if (!run) throw new NotFoundException('Evaluación de riesgo no encontrada.');
    return {
      run,
      result,
      rulesFired: rules,
      featureContributions: contributions,
      featureSnapshot: snapshot,
    };
  }

  async getRiskAssessmentExplanation(tenantId: string, runId: string) {
    const detail = await this.getRiskAssessmentDetail(tenantId, runId);
    const result = detail.result;
    if (!result) throw new NotFoundException('Resultado de riesgo no encontrado.');
    const rules = detail.rulesFired.map((rule) => rule.reasonCode).filter((code): code is string => Boolean(code));
    return {
      decision: result.recommendedAction,
      summary: rules.length > 0 ? `Decisión basada en: ${rules.join(', ')}.` : 'Evaluación registrada sin reglas explicativas adicionales.',
      topPositiveFactors: detail.featureContributions
        .filter((item) => Number(item.scorePoints ?? '0') >= 60)
        .map((item) => ({ code: item.featureCode, label: item.reasonCode, impact: 'positive' })),
      topNegativeFactors: detail.featureContributions
        .filter((item) => Number(item.scorePoints ?? '0') < 60)
        .map((item) => ({ code: item.featureCode, label: item.reasonCode, impact: 'negative' })),
      rulesFired: rules,
      recommendedAction: result.recommendedAction,
    };
  }
}
