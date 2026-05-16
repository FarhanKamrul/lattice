/**
 * actionability_resolver.ts
 *
 * Run on the RECEIVING end after a cross-border signal is ingested.
 * Reads the jurisdiction's own actionability JSON, evaluates the
 * surviving fields against the Use Matrix, and returns a full
 * ActionabilityVerdict with regulatory drop log.
 *
 * Usage:
 *   const resolver = new ActionabilityResolver("./actionability/UK_actionability.json");
 *   const verdict  = resolver.resolve(incomingSignal);
 */

import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Signal envelope types (must match adapt_signal.ts emitter output)
// ---------------------------------------------------------------------------

export interface SignalPayload {
  identifierFields:   Record<string, string>;
  bandsAndCategories: Record<string, string | null>;
  timestamps:         Record<string, string | null>;
  notes:              string | null;
}

export interface IncomingSignal {
  signalEnvelopeVersion:  string;
  signalId:               string;
  publishingJurisdiction: string;
  targetJurisdictions:    string[];
  publishedAtUTC:         string;
  signalType:             string;
  anonymisationTier:      number;
  tierRationale:          string;
  tippingOffCompliance:   { sarExistenceDisclosed: boolean; languageNeutralityConfirmed: boolean };
  payload:                SignalPayload;
  transferMechanisms:     Record<string, string>;
  retentionPolicy:        { minimumYears: number };
  kAnonymity:             { required: number; enforced: boolean; passed?: boolean; result?: string };
  complianceWarnings:     string[];
  warningConditionGate?:  { met: boolean; legalBasis: string };
}

// ---------------------------------------------------------------------------
// Actionability ruleset types (mirrors *_actionability.json schema)
// ---------------------------------------------------------------------------

type ActionCategory = "case_level" | "systemic";
type PermittedValue = boolean | "conditional" | "advisory_only" | "via_COAF_only";

interface LegalBasis {
  instrument:            string;
  provision?:            string;
  permitted:             PermittedValue;
  condition?:            string | null;
  foreignOriginPermitted?: PermittedValue | boolean;
  mandatoryAction?:      boolean | string;
}

interface ActionRule {
  actionCategory:              ActionCategory;
  requiredFields:              string[];
  legalBasis:                  LegalBasis;
  minimumTier:                 number | null;
  effectiveMinimumTier_foreignOrigin?: number | null;
  effectiveActionability?:     string;
  note?:                       string;
}

interface FieldSurvivalTier {
  identifierFields:   string[];
  bandsAndCategories: string[];
  timestamps:         string[];
  narrative:          string | null;
  note?:              string;
}

interface ActionabilityRuleset {
  jurisdictionCode:         string;
  jurisdictionName:         string;
  systemOwner:              string;
  version:                  string;
  effectiveDate:            string;
  governingInstruments:    unknown[];
  criticalLegalGap?:        { description: string; affectedActions: string[]; resolutionPath?: string };
  fieldSurvivalRules:       { tier1: FieldSurvivalTier; tier2: FieldSurvivalTier; tier3: FieldSurvivalTier };
  useMatrix:                Record<string, Record<string, ActionRule>>;
  conflictTypeDefinitions:  Record<string, string>;
  defaultTier:              number;
  tierSelectionLogic:       string;
}

// ---------------------------------------------------------------------------
// Verdict types
// ---------------------------------------------------------------------------

export type ConflictType =
  | "FIELD_CLASSIFICATION"
  | "TIPPING_OFF"
  | "K_ANONYMITY_FAILURE"
  | "TRANSFER_INSTRUMENT_GAP"
  | "LEGAL_BASIS_ABSENT"
  | "WARNING_CONDITION_NOT_MET"
  | "RETENTION_CONFLICT"
  | "MED_DOMESTIC_ONLY"
  | "FOREIGN_INTELLIGENCE_GATEWAY"
  | "NO_MANDATORY_ACTION"
  | "SAR_CONFIDENTIALITY"
  | "VOLUNTARY_ONLY"
  | "MINIMUM_TIER_NOT_MET";

export interface RegulatoryDropEntry {
  action:       string;
  field?:       string;
  conflictType: ConflictType;
  instrument:   string;
  rule:         string;
  resolution?:  string;
}

export interface ActionVerdict {
  action:               string;
  actionCategory:       ActionCategory;
  technicallyPossible:  boolean;
  legallyPermitted:     PermittedValue;
  effectivelyActionable: boolean;
  effectiveActionability: "mandatory" | "conditional" | "advisory" | "unavailable";
  missingFields?:       string[];
  blockingRule?:        string;
  instrument?:          string;
  note?:                string;
}

export interface IntelligenceValue {
  score:    "HIGH" | "MEDIUM" | "LOW" | "NONE";
  drivers:  string[];
  estimatedPreventionMultiplier: string;
}

export interface ActionabilityVerdict {
  signalId:                string;
  resolvedAtUTC:           string;
  receivingJurisdiction:   string;
  publishingJurisdiction:  string;
  signalType:              string;
  anonymisationTier:       number;

  caseLevelActionable:     boolean;
  systemicActionable:      boolean;

  caseActions:             ActionVerdict[];
  systemicActions:         ActionVerdict[];

  intelligenceValue:       IntelligenceValue;
  regulatoryDropLog:       RegulatoryDropEntry[];

  overallVerdict:          "FULLY_ACTIONABLE" | "CASE_ACTIONABLE" | "SYSTEMIC_ONLY" | "INTELLIGENCE_ONLY" | "INACTIONABLE";
  verdictRationale:        string;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export class ActionabilityResolver {
  private rules: ActionabilityRuleset;

  constructor(rulesetPath: string) {
    const resolved = path.resolve(rulesetPath);
    if (!fs.existsSync(resolved)) {
      throw new Error(`Actionability ruleset not found: ${resolved}`);
    }
    this.rules = JSON.parse(fs.readFileSync(resolved, "utf-8")) as ActionabilityRuleset;
  }

  resolve(signal: IncomingSignal): ActionabilityVerdict {
    const { signalType, anonymisationTier, publishingJurisdiction } = signal;
    const isForeign = publishingJurisdiction !== this.rules.jurisdictionCode;
    const survivingFields = this._survivingFields(signal);
    const dropLog: RegulatoryDropEntry[] = [];

    const signalActions = this.rules.useMatrix[signalType] ?? {};
    const caseVerdicts: ActionVerdict[] = [];
    const systemicVerdicts: ActionVerdict[] = [];

    for (const [actionName, rule] of Object.entries(signalActions)) {
      const verdict = this._evaluateAction(
        actionName, rule, anonymisationTier,
        survivingFields, isForeign, dropLog
      );
      if (rule.actionCategory === "case_level") {
        caseVerdicts.push(verdict);
      } else {
        systemicVerdicts.push(verdict);
      }
    }

    const caseLevelActionable  = caseVerdicts.some(v => v.effectivelyActionable);
    const systemicActionable   = systemicVerdicts.some(v => v.effectivelyActionable);
    const intelligenceValue    = this._computeIntelligenceValue(signal, systemicVerdicts);
    const overallVerdict       = this._overallVerdict(caseLevelActionable, systemicActionable, signal);
    const verdictRationale     = this._rationale(overallVerdict, caseLevelActionable, systemicActionable, isForeign, dropLog);

    return {
      signalId:               signal.signalId,
      resolvedAtUTC:          new Date().toISOString(),
      receivingJurisdiction:  this.rules.jurisdictionCode,
      publishingJurisdiction,
      signalType,
      anonymisationTier,
      caseLevelActionable,
      systemicActionable,
      caseActions:            caseVerdicts,
      systemicActions:        systemicVerdicts,
      intelligenceValue,
      regulatoryDropLog:      dropLog,
      overallVerdict,
      verdictRationale,
    };
  }

  // -- Private helpers ------------------------------------------------------

  /** Flatten all field names that survived anonymisation in this signal. */
  private _survivingFields(signal: IncomingSignal): Set<string> {
    const fields = new Set<string>();
    for (const k of Object.keys(signal.payload.identifierFields))   fields.add(k);
    for (const k of Object.keys(signal.payload.bandsAndCategories)) {
      if (signal.payload.bandsAndCategories[k] !== null) fields.add(k);
    }
    for (const k of Object.keys(signal.payload.timestamps)) {
      if (signal.payload.timestamps[k] !== null) fields.add(k);
    }
    if (signal.payload.notes !== null) fields.add("narrative");
    return fields;
  }

  private _evaluateAction(
    actionName:      string,
    rule:            ActionRule,
    tier:            number,
    surviving:       Set<string>,
    isForeign:       boolean,
    dropLog:         RegulatoryDropEntry[]
  ): ActionVerdict {
    const lb = rule.legalBasis;

    // -- 1. Minimum tier check ----------------------------------------------
    const effectiveMinTier = isForeign && rule.effectiveMinimumTier_foreignOrigin !== undefined
      ? rule.effectiveMinimumTier_foreignOrigin
      : rule.minimumTier;

    if (effectiveMinTier === null) {
      // null means "never available for foreign origin"
      dropLog.push({
        action:       actionName,
        conflictType: "MED_DOMESTIC_ONLY",
        instrument:   lb.instrument,
        rule:         lb.condition ?? "Domestic-only mechanism -- foreign origin not supported",
        resolution:   (this.rules.criticalLegalGap?.resolutionPath) ?? "Bilateral agreement or FIU channel required",
      });
      return this._unavailableVerdict(actionName, rule, "MED_DOMESTIC_ONLY", lb);
    }

    if (effectiveMinTier < tier) {
      dropLog.push({
        action:       actionName,
        conflictType: "MINIMUM_TIER_NOT_MET",
        instrument:   lb.instrument,
        rule:         `Action requires minimum fidelity Tier ${effectiveMinTier}; signal is too broad (Tier ${tier})`,
      });
      return this._unavailableVerdict(actionName, rule, "MINIMUM_TIER_NOT_MET", lb);
    }

    // -- 2. Field dependency check -----------------------------------------
    const missingFields = rule.requiredFields.filter(f => !surviving.has(f));
    if (missingFields.length > 0) {
      for (const field of missingFields) {
        dropLog.push({
          action:       actionName,
          field,
          conflictType: "FIELD_CLASSIFICATION",
          instrument:   lb.instrument,
          rule:         `Required field '${field}' was suppressed by anonymisation (Tier ${tier})`,
        });
      }
      return {
        action:               actionName,
        actionCategory:       rule.actionCategory,
        technicallyPossible:  false,
        legallyPermitted:     lb.permitted,
        effectivelyActionable: false,
        effectiveActionability: "unavailable",
        missingFields,
        blockingRule:         `Missing required fields: ${missingFields.join(", ")}`,
        instrument:           lb.instrument,
      };
    }

    // -- 3. Legal basis check (foreign origin) ----------------------------
    const foreignPermitted = lb.foreignOriginPermitted;
    if (isForeign && foreignPermitted === false) {
      const conflictType: ConflictType = actionName.includes("med") || actionName.includes("dict")
        ? "MED_DOMESTIC_ONLY"
        : "FOREIGN_INTELLIGENCE_GATEWAY";
      dropLog.push({
        action:       actionName,
        conflictType,
        instrument:   lb.instrument,
        rule:         lb.condition ?? "Foreign-origin signals not permitted for this action",
        resolution:   this.rules.criticalLegalGap?.resolutionPath,
      });
      return this._unavailableVerdict(actionName, rule, conflictType, lb);
    }

    // -- 4. Permitted check ------------------------------------------------
    const permitted = lb.permitted;
    if (permitted === false) {
      dropLog.push({
        action:       actionName,
        conflictType: "LEGAL_BASIS_ABSENT",
        instrument:   lb.instrument,
        rule:         lb.provision ?? "No legal basis",
      });
      return this._unavailableVerdict(actionName, rule, "LEGAL_BASIS_ABSENT", lb);
    }

    // -- 5. Determine effective actionability -----------------------------
    let effectiveActionability: ActionVerdict["effectiveActionability"];
    if (permitted === true && lb.mandatoryAction === true) {
      effectiveActionability = "mandatory";
    } else if (permitted === "conditional" || foreignPermitted === "advisory_only" || rule.effectiveActionability === "advisory") {
      effectiveActionability = isForeign ? "advisory" : "conditional";
    } else if (permitted === "conditional") {
      effectiveActionability = "conditional";
    } else {
      effectiveActionability = "conditional";
    }

    const effectivelyActionable = effectiveActionability !== "unavailable";

    if (effectiveActionability === "advisory") {
      dropLog.push({
        action:       actionName,
        conflictType: "NO_MANDATORY_ACTION",
        instrument:   lb.instrument,
        rule:         lb.condition ?? "Action is advisory only for foreign-origin signals",
      });
    }

    return {
      action:               actionName,
      actionCategory:       rule.actionCategory,
      technicallyPossible:  true,
      legallyPermitted:     permitted,
      effectivelyActionable,
      effectiveActionability,
      instrument:           lb.instrument,
      note:                 lb.condition ?? rule.note,
    };
  }

  private _unavailableVerdict(
    actionName: string,
    rule:       ActionRule,
    reason:     ConflictType,
    lb:         LegalBasis
  ): ActionVerdict {
    return {
      action:               actionName,
      actionCategory:       rule.actionCategory,
      technicallyPossible:  false,
      legallyPermitted:     lb.permitted,
      effectivelyActionable: false,
      effectiveActionability: "unavailable",
      blockingRule:         reason,
      instrument:           lb.instrument,
    };
  }

  private _computeIntelligenceValue(
    signal:          IncomingSignal,
    systemicVerdicts: ActionVerdict[]
  ): IntelligenceValue {
    const cats = signal.payload.bandsAndCategories;
    const drivers: string[] = [];

    if (cats["fraudTypologyCode"])   drivers.push("fraudTypologyCode present -- contributes to typology trend analysis");
    if (cats["geographicRiskBand"])  drivers.push("geographicRiskBand present -- enables corridor risk recalibration");
    if (cats["paymentRail"])         drivers.push("paymentRail present -- rail-specific model retraining possible");
    if (cats["transactionAmountBand"]) drivers.push("transactionAmountBand present -- contributes to value-band trend detection");

    const availableSystemic = systemicVerdicts.filter(v => v.effectivelyActionable).length;
    const score: IntelligenceValue["score"] =
      drivers.length >= 3 && availableSystemic >= 2 ? "HIGH"   :
      drivers.length >= 2 && availableSystemic >= 1 ? "MEDIUM" :
      drivers.length >= 1                            ? "LOW"    : "NONE";

    return {
      score,
      drivers,
      estimatedPreventionMultiplier:
        "1:N where N = similar signals in rolling 30-day window. " +
        "Each Tier 3 typology signal contributes to sector-wide fraud model updates " +
        "that prevent N future transactions without additional privacy cost.",
    };
  }

  private _overallVerdict(
    caseLevelActionable: boolean,
    systemicActionable:  boolean,
    signal:              IncomingSignal
  ): ActionabilityVerdict["overallVerdict"] {
    const hasAdvisoryCase = signal.publishingJurisdiction !== this.rules.jurisdictionCode &&
      this.rules.criticalLegalGap?.affectedActions.length;

    if (caseLevelActionable && systemicActionable)   return "FULLY_ACTIONABLE";
    if (caseLevelActionable && !systemicActionable)  return "CASE_ACTIONABLE";
    if (!caseLevelActionable && systemicActionable)  return "SYSTEMIC_ONLY";
    if (!caseLevelActionable && !systemicActionable) return "INTELLIGENCE_ONLY";
    return "INACTIONABLE";
  }

  private _rationale(
    verdict:             ActionabilityVerdict["overallVerdict"],
    caseLevelActionable: boolean,
    systemicActionable:  boolean,
    isForeign:           boolean,
    dropLog:             RegulatoryDropEntry[]
  ): string {
    const conflictCounts = dropLog.reduce((acc, e) => {
      acc[e.conflictType] = (acc[e.conflictType] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const conflicts = Object.entries(conflictCounts)
      .map(([k, v]) => `${k} x${v}`)
      .join(", ");

    const base = {
      FULLY_ACTIONABLE:  "All required fields present. Legal basis confirmed. Both case-level and systemic actions available.",
      CASE_ACTIONABLE:   "Case-level actions available. Systemic actions unavailable due to field/tier constraints.",
      SYSTEMIC_ONLY:     "Case-level actions blocked (missing fields or legal basis). Systemic intelligence intact and actionable.",
      INTELLIGENCE_ONLY: "No directly actionable fields survived anonymisation. Signal contributes to aggregate intelligence only.",
      INACTIONABLE:      "Signal contains insufficient information for any action under receiving jurisdiction rules.",
    }[verdict];

    const foreignNote = isForeign
      ? ` | Foreign-origin signal: case-level actions may require independent reassessment or FIU channel intermediation.`
      : "";

    const conflictNote = conflicts
      ? ` | Regulatory conflicts: ${conflicts}.`
      : "";

    return base + foreignNote + conflictNote;
  }
}

// ---------------------------------------------------------------------------
// Demo -- run directly: npx ts-node actionability_resolver.ts
// ---------------------------------------------------------------------------

if (require.main === module) {
  const ACTIONABILITY_DIR = path.join(__dirname, "..", "regulations");

  // Simulated Tier 2 signal as emitted by adapt_signal.ts (UK->BR)
  const demoSignal: IncomingSignal = {
    signalEnvelopeVersion:  "2.0-MVP",
    signalId:               "61bd1f50-6058-41d9-8bf9-ea2833eac2ff",
    publishingJurisdiction: "UK",
    targetJurisdictions:    ["BR"],
    publishedAtUTC:         "2026-05-16T09:20:11.461Z",
    signalType:             "APP_FRAUD",
    anonymisationTier:      2,
    tierRationale:          "Tier 2 -- Random token vault + k-anonymity (k>=5). Lighter transfer obligations.",
    tippingOffCompliance:   { sarExistenceDisclosed: false, languageNeutralityConfirmed: true },
    payload: {
      identifierFields: {
        accountNumber:     "e43c70fc-1995-478d-9cf9-bc58516487ee",
        sortCode:          "fc5d26ae-bb6a-4cbf-ab97-e58350e396d3",
        ipAddress:         "fbd70376-074e-43ce-bbba-794a89a11508",
        deviceFingerprint: "fed9ed62-0ca3-472f-a603-bd4c4a64580f",
        phoneNumber:       "bead5482-2229-4dd1-8ea1-300af05894f1",
      },
      bandsAndCategories: {
        transactionAmountBand: "0-50000",
        paymentRail:           "FPS",
        fraudTypologyCode:     "IMPERSONATION",
        geographicRiskBand:    "HIGH",
      },
      timestamps: {
        transactionUTC: "2026-05-16T08:00:00Z",
        detectionUTC:   "2026-05-16T08:00:00Z",
      },
      notes: "Customer mentioned a [REDACTED] and said the account is [REDACTED] after unusual payment behaviour.",
    },
    transferMechanisms: { "BR": "IDTA + ANPD SCC" },
    retentionPolicy:    { minimumYears: 5 },
    kAnonymity:         { required: 5, enforced: true, passed: true, result: "5 matching records" },
    complianceWarnings: ["Direct identifier suppressed: fullName", "Direct identifier suppressed: dateOfBirth"],
    warningConditionGate: { met: true, legalBasis: "ECCTA 2023 s.189" },
  };

  // Run against Brazil receiving rules
  const rulesetPath = path.join(ACTIONABILITY_DIR, "Brazil_actionability.json");
  const resolver    = new ActionabilityResolver(rulesetPath);
  const verdict     = resolver.resolve(demoSignal);

  console.log(JSON.stringify(verdict, null, 2));
}
