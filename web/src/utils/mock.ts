// Mock data types and generators for the Aegis dashboard

export type Verdict = 'FULLY_ACTIONABLE' | 'CASE_ACTIONABLE' | 'SYSTEMIC_ONLY' | 'INTELLIGENCE_ONLY' | 'INACTIONABLE';
export type ConflictType = 'MED_DOMESTIC_ONLY' | 'NO_MANDATORY_ACTION' | 'FIELD_CLASSIFICATION' | 'TIPPING_OFF' | 'K_ANONYMITY_FAILURE' | 'TRANSFER_INSTRUMENT_GAP' | 'FOREIGN_INTELLIGENCE_GATEWAY';
export type Effectiveness = 'MANDATORY' | 'CONDITIONAL' | 'ADVISORY' | 'UNAVAILABLE';
export type SignalType = 'APP_FRAUD' | 'UNAUTH_TRANSACTION' | 'MULE_ACCOUNT_INDICATOR';
export type Tier = 1 | 2 | 3;
export type Jurisdiction = 'UK' | 'US' | 'BR';
export type PaymentRail = 'FPS' | 'CHAPS' | 'ACH' | 'WIRE' | 'PIX';
export type Typology = 'IMPERSONATION' | 'INVESTMENT_SCAM' | 'ROMANCE_SCAM' | 'INVOICE_FRAUD';

export interface DropEntry {
  action: string;
  conflictType: ConflictType;
  instrument: string;
  rule: string;
}

export interface ActionRow {
  action: string;
  effectiveness: Effectiveness;
  drop?: DropEntry;
}

export interface Signal {
  id: string;
  from: Jurisdiction;
  to: Jurisdiction;
  type: SignalType;
  verdict: Verdict;
  tier: Tier;
  topConflict?: ConflictType;
  age: number; // ms ago
  emittedAt: string;
  transferMechanism: string;
  tierRationale: string;
  identifierFields: Record<string, string>;
  bandsAndCategories: Record<string, string>;
  caseActions: ActionRow[];
  systemicActions: ActionRow[];
  dropLog: DropEntry[];
  intelligenceScore: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface AggregationReport {
  totalSignals: number;
  caseActionable: number;
  systemicActionable: number;
  typologyAlerts: number;
  healthScore: 'GREEN' | 'AMBER' | 'RED';
  healthRationale: string;
  verdictBreakdown: Record<Verdict, number>;
  frictionTop5: { conflictType: ConflictType; count: number; severity: 'blocking' | 'advisory' | 'conditional' }[];
  typologyTrends: { key: string; spark: number[]; current: number; wow: number }[];
}

function uuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

const JUR_FLAGS: Record<Jurisdiction, string> = { UK: '🇬🇧', US: '🇺🇸', BR: '🇧🇷' };
const SIGNAL_TYPES: SignalType[] = ['APP_FRAUD', 'UNAUTH_TRANSACTION', 'MULE_ACCOUNT_INDICATOR'];
const RAILS: PaymentRail[] = ['FPS', 'CHAPS', 'ACH', 'WIRE', 'PIX'];
const TYPOLOGIES: Typology[] = ['IMPERSONATION', 'INVESTMENT_SCAM', 'ROMANCE_SCAM', 'INVOICE_FRAUD'];

function randomFrom<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

export function generateSignal(overrides: Partial<{ type: SignalType; tier: Tier; from: Jurisdiction; rail: PaymentRail; typology: Typology; riskBand: string }> = {}): Signal {
  const id = uuid();
  const from: Jurisdiction = overrides.from ?? randomFrom(['UK', 'US'] as Jurisdiction[]);
  const type = overrides.type ?? randomFrom(SIGNAL_TYPES);
  const tier: Tier = overrides.tier ?? (Math.random() < 0.5 ? 2 : Math.random() < 0.5 ? 1 : 3);
  const rail = overrides.rail ?? randomFrom(RAILS);
  const typology = overrides.typology ?? randomFrom(TYPOLOGIES);
  const riskBand = overrides.riskBand ?? randomFrom(['LOW', 'MEDIUM', 'HIGH']);

  // Determine verdict based on tier & typology
  let verdict: Verdict;
  const r = Math.random();
  if (tier === 1 && r < 0.6) verdict = 'FULLY_ACTIONABLE';
  else if (tier === 2 && r < 0.4) verdict = 'CASE_ACTIONABLE';
  else if (r < 0.75) verdict = 'SYSTEMIC_ONLY';
  else if (r < 0.9) verdict = 'INTELLIGENCE_ONLY';
  else verdict = 'INACTIONABLE';

  const topConflict: ConflictType | undefined = verdict === 'FULLY_ACTIONABLE' ? undefined : randomFrom(['MED_DOMESTIC_ONLY', 'FOREIGN_INTELLIGENCE_GATEWAY', 'NO_MANDATORY_ACTION', 'FIELD_CLASSIFICATION'] as ConflictType[]);

  const tierMechanisms: Record<Tier, string> = {
    1: 'MLAT + Egmont FIU-to-FIU',
    2: 'IDTA + ANPD SCC',
    3: 'Standard GDPR Article 46 SCC',
  };

  const tierRationale: Record<Tier, string> = {
    1: 'Tier 1 — HMAC-SHA256 pseudonymisation. Highest fidelity. Full MLAT required.',
    2: 'Tier 2 — Random token vault + k-anonymity (k≥5). Lighter transfer obligations.',
    3: 'Tier 3 — Fully generalised. No direct identifiers.',
  };

  const caseActions: ActionRow[] = [
    { action: 'file_SAR_to_COAF', effectiveness: verdict === 'FULLY_ACTIONABLE' || verdict === 'CASE_ACTIONABLE' ? 'CONDITIONAL' : 'ADVISORY' },
    { action: 'act_on_foreign_intelligence', effectiveness: verdict === 'INACTIONABLE' ? 'UNAVAILABLE' : 'ADVISORY' },
    {
      action: 'block_account',
      effectiveness: verdict === 'FULLY_ACTIONABLE' ? 'MANDATORY' : 'UNAVAILABLE',
      drop: verdict !== 'FULLY_ACTIONABLE' ? { action: 'block_account', conflictType: 'FOREIGN_INTELLIGENCE_GATEWAY', instrument: 'BCB_RES_506_2025', rule: 'Foreign-origin signal cannot directly trigger account block. Must route via COAF Egmont channel.' } : undefined,
    },
  ];

  const systemicActions: ActionRow[] = [
    { action: 'typology_alert', effectiveness: verdict === 'INACTIONABLE' ? 'UNAVAILABLE' : 'CONDITIONAL' },
    { action: 'update_fraud_model', effectiveness: verdict === 'INACTIONABLE' ? 'UNAVAILABLE' : 'CONDITIONAL' },
    {
      action: 'med_trigger',
      effectiveness: 'UNAVAILABLE',
      drop: { action: 'med_trigger', conflictType: 'MED_DOMESTIC_ONLY', instrument: 'BCB_RES_493_2025', rule: 'DOMESTIC PIX ONLY. Foreign-origin signals have no direct MED pathway.' },
    },
  ];

  const dropLog: DropEntry[] = [
    ...caseActions.filter(a => a.drop).map(a => a.drop!),
    ...systemicActions.filter(a => a.drop).map(a => a.drop!),
  ];

  return {
    id,
    from,
    to: 'BR',
    type,
    verdict,
    tier,
    topConflict,
    age: Math.floor(Math.random() * 3600000),
    emittedAt: new Date(Date.now() - Math.random() * 3600000).toISOString(),
    transferMechanism: tierMechanisms[tier],
    tierRationale: tierRationale[tier],
    identifierFields: {
      accountNumber: uuid(),
      sortCode: uuid().slice(0, 8),
      deviceFingerprint: uuid(),
    },
    bandsAndCategories: {
      transactionAmountBand: randomFrom(['0-1000', '1000-10000', '10000-50000', '50000+']),
      paymentRail: rail,
      fraudTypologyCode: typology,
      geographicRiskBand: riskBand,
    },
    caseActions,
    systemicActions,
    dropLog,
    intelligenceScore: riskBand === 'HIGH' ? 'HIGH' : riskBand === 'MEDIUM' ? 'MEDIUM' : 'LOW',
  };
}

export function generateReport(signals: Signal[]): AggregationReport {
  const total = signals.length;
  const caseActionable = signals.filter(s => s.verdict === 'FULLY_ACTIONABLE' || s.verdict === 'CASE_ACTIONABLE').length;
  const systemicActionable = signals.filter(s => s.verdict !== 'INACTIONABLE').length;

  const conflictCounts: Partial<Record<ConflictType, number>> = {};
  signals.forEach(s => { if (s.topConflict) conflictCounts[s.topConflict] = (conflictCounts[s.topConflict] ?? 0) + 1; });

  const frictionTop5 = Object.entries(conflictCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([k, v]) => ({
      conflictType: k as ConflictType,
      count: v,
      severity: (['MED_DOMESTIC_ONLY', 'FOREIGN_INTELLIGENCE_GATEWAY', 'TRANSFER_INSTRUMENT_GAP'] as ConflictType[]).includes(k as ConflictType) ? 'blocking' as const : 'advisory' as const,
    }));

  const verdictBreakdown: Record<Verdict, number> = {
    FULLY_ACTIONABLE: 0, CASE_ACTIONABLE: 0, SYSTEMIC_ONLY: 0, INTELLIGENCE_ONLY: 0, INACTIONABLE: 0,
  };
  signals.forEach(s => verdictBreakdown[s.verdict]++);

  const typologyKeys = ['IMPERSONATION|FPS|HIGH', 'INVESTMENT_SCAM|CHAPS|MEDIUM', 'ROMANCE_SCAM|ACH|LOW', 'INVOICE_FRAUD|WIRE|HIGH'];
  const typologyTrends = typologyKeys.map(k => {
    const spark = Array.from({ length: 7 }, () => Math.floor(Math.random() * 50) + 5);
    const current = spark[6];
    const prev = spark[5];
    return { key: k, spark, current, wow: Math.round(((current - prev) / (prev || 1)) * 100) };
  });

  const caseRatio = total > 0 ? caseActionable / total : 0;
  const healthScore: 'GREEN' | 'AMBER' | 'RED' = caseRatio < 0.1 ? 'RED' : caseRatio < 0.3 ? 'AMBER' : 'GREEN';

  return {
    totalSignals: total,
    caseActionable,
    systemicActionable,
    typologyAlerts: typologyTrends.filter(t => t.wow > 30).length,
    healthScore,
    healthRationale: healthScore === 'RED' ? 'Critical: case-actionable ratio below 10%' : healthScore === 'AMBER' ? 'Typology spike detected. Review IMPERSONATION corridor.' : 'All metrics nominal.',
    verdictBreakdown,
    frictionTop5,
    typologyTrends,
  };
}

export function formatAge(ms: number): string {
  if (ms < 60000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  return `${Math.floor(ms / 3600000)}h ago`;
}

export { JUR_FLAGS };
