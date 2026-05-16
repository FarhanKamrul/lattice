/**
 * signal_aggregator.ts
 *
 * Receive-side aggregation layer. Consumes ActionabilityVerdict objects
 * produced by actionability_resolver.ts and maintains three rolling views:
 *
 *   1. SignalUtilityTracker      -- overallVerdict counts per jurisdiction pair
 *   2. RegulatoryFrictionLedger  -- conflictType x instrument frequency
 *   3. TypologyTrendIndex        -- typology pattern velocity, week-on-week delta
 *
 * All state is in-memory (swap backing store for InfluxDB / TimescaleDB in prod).
 *
 * Usage:
 *   const store = new AggregationStore({ windowDays: 30, alertDeltaThreshold: 0.2 });
 *   store.ingest(verdict);
 *   console.log(store.report("UK", "BR"));
 */

import type { ActionabilityVerdict, RegulatoryDropEntry, ConflictType } from "./actionability_resolver";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface AggregationConfig {
  /** Rolling window length in days (default 30). */
  windowDays: number;
  /** Week-on-week typology delta that triggers a spike alert (default 0.20 = 20%). */
  alertDeltaThreshold: number;
}

const DEFAULT_CONFIG: AggregationConfig = {
  windowDays:          30,
  alertDeltaThreshold: 0.20,
};

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type JurisdictionPair = `${string}->${string}`;

function pairKey(from: string, to: string): JurisdictionPair {
  return `${from}->${to}`;
}

/** A timestamped record stored per ingested verdict. */
interface IngestionRecord {
  ts:          number;   // Date.now()
  pair:        JurisdictionPair;
  signalType:  string;
  tier:        number;
  verdict:     ActionabilityVerdict["overallVerdict"];
  dropLog:     RegulatoryDropEntry[];
  typologyKey: string;   // e.g. "IMPERSONATION|FPS|HIGH"
  amountBand:  string | null;
}

// ---------------------------------------------------------------------------
// 1. SignalUtilityTracker
// ---------------------------------------------------------------------------

export interface UtilitySnapshot {
  pair:                  JurisdictionPair;
  windowDays:            number;
  totalSignals:          number;
  byVerdict:             Record<ActionabilityVerdict["overallVerdict"], number>;
  caseUtilityPct:        number;
  systemicUtilityPct:    number;
  caseUtilityFlag:       boolean;   // true = below 20% threshold -- flag for regulator
  topSignalTypes:        Array<{ signalType: string; count: number }>;
}

// ---------------------------------------------------------------------------
// 2. RegulatoryFrictionLedger
// ---------------------------------------------------------------------------

export interface FrictionEntry {
  conflictType:  ConflictType;
  instrument:    string;
  count:         number;
  affectedPct:   number;   // % of signals in window that had this conflict
  resolution?:   string;
}

export interface FrictionReport {
  pair:          JurisdictionPair;
  windowDays:    number;
  totalSignals:  number;
  totalDrops:    number;
  avgDropsPerSignal: number;
  topConflicts:  FrictionEntry[];
  topInstruments: Array<{ instrument: string; count: number; pct: number }>;
}

// ---------------------------------------------------------------------------
// 3. TypologyTrendIndex
// ---------------------------------------------------------------------------

export type TrendDirection = "SPIKE" | "RISING" | "STABLE" | "DECLINING";

export interface TypologyTrend {
  typologyKey:        string;
  currentWeekCount:   number;
  previousWeekCount:  number;
  deltaPercent:       number;
  direction:          TrendDirection;
  alert:              boolean;
}

export interface TrendReport {
  pair:          JurisdictionPair;
  generatedAtUTC: string;
  trends:        TypologyTrend[];
  activeAlerts:  TypologyTrend[];
}

// ---------------------------------------------------------------------------
// 4. Full report
// ---------------------------------------------------------------------------

export interface AggregationReport {
  generatedAtUTC:  string;
  pair:            JurisdictionPair;
  windowDays:      number;
  utility:         UtilitySnapshot;
  friction:        FrictionReport;
  trends:          TrendReport;
  platformSummary: {
    overallHealthScore: "GREEN" | "AMBER" | "RED";
    primaryBottleneck:  string;
    regulatoryInsight:  string;
    recommendedAction:  string;
  };
}

// ---------------------------------------------------------------------------
// SignalUtilityTracker
// ---------------------------------------------------------------------------

class SignalUtilityTracker {
  private records: IngestionRecord[] = [];

  ingest(r: IngestionRecord): void {
    this.records.push(r);
  }

  snapshot(pair: JurisdictionPair, windowMs: number): UtilitySnapshot {
    const cutoff  = Date.now() - windowMs;
    const window  = this.records.filter(r => r.pair === pair && r.ts >= cutoff);
    const total   = window.length;

    const byVerdict = {
      FULLY_ACTIONABLE:  0,
      CASE_ACTIONABLE:   0,
      SYSTEMIC_ONLY:     0,
      INTELLIGENCE_ONLY: 0,
      INACTIONABLE:      0,
    } as Record<ActionabilityVerdict["overallVerdict"], number>;

    const typeCounts: Record<string, number> = {};

    for (const r of window) {
      byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1;
      typeCounts[r.signalType] = (typeCounts[r.signalType] ?? 0) + 1;
    }

    const caseCount    = byVerdict.FULLY_ACTIONABLE + byVerdict.CASE_ACTIONABLE;
    const systemicCount = byVerdict.FULLY_ACTIONABLE + byVerdict.CASE_ACTIONABLE + byVerdict.SYSTEMIC_ONLY;
    const caseUtilityPct    = total > 0 ? caseCount / total : 0;
    const systemicUtilityPct = total > 0 ? systemicCount / total : 0;

    const topSignalTypes = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([signalType, count]) => ({ signalType, count }));

    return {
      pair,
      windowDays:       windowMs / 86_400_000,
      totalSignals:     total,
      byVerdict,
      caseUtilityPct:   Math.round(caseUtilityPct * 1000) / 10,
      systemicUtilityPct: Math.round(systemicUtilityPct * 1000) / 10,
      caseUtilityFlag:  caseUtilityPct < 0.20,
      topSignalTypes,
    };
  }
}

// ---------------------------------------------------------------------------
// RegulatoryFrictionLedger
// ---------------------------------------------------------------------------

class RegulatoryFrictionLedger {
  private records: IngestionRecord[] = [];

  ingest(r: IngestionRecord): void {
    this.records.push(r);
  }

  report(pair: JurisdictionPair, windowMs: number): FrictionReport {
    const cutoff  = Date.now() - windowMs;
    const window  = this.records.filter(r => r.pair === pair && r.ts >= cutoff);
    const total   = window.length;

    // Flatten all drop log entries
    const allDrops: RegulatoryDropEntry[] = window.flatMap(r => r.dropLog);

    // Count by conflictType x instrument
    type FrictionKey = `${ConflictType}||${string}`;
    const conflictMap   = new Map<FrictionKey, { count: number; resolution?: string }>();
    const instrumentMap = new Map<string, number>();

    // Track which signals (by index) had each conflict type
    const signalConflicts = new Map<ConflictType, Set<number>>();

    window.forEach((rec, idx) => {
      for (const drop of rec.dropLog) {
        const key: FrictionKey = `${drop.conflictType}||${drop.instrument}`;
        const existing = conflictMap.get(key) ?? { count: 0 };
        conflictMap.set(key, { count: existing.count + 1, resolution: drop.resolution });

        instrumentMap.set(drop.instrument, (instrumentMap.get(drop.instrument) ?? 0) + 1);

        if (!signalConflicts.has(drop.conflictType)) {
          signalConflicts.set(drop.conflictType, new Set());
        }
        signalConflicts.get(drop.conflictType)!.add(idx);
      }
    });

    const topConflicts: FrictionEntry[] = Array.from(conflictMap.entries())
      .map(([key, { count, resolution }]) => {
        const [conflictType, instrument] = key.split("||") as [ConflictType, string];
        const affectedSignals = signalConflicts.get(conflictType)?.size ?? 0;
        return {
          conflictType,
          instrument,
          count,
          affectedPct: total > 0 ? Math.round((affectedSignals / total) * 1000) / 10 : 0,
          resolution,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    const topInstruments = Array.from(instrumentMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([instrument, count]) => ({
        instrument,
        count,
        pct: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      }));

    return {
      pair,
      windowDays:        windowMs / 86_400_000,
      totalSignals:      total,
      totalDrops:        allDrops.length,
      avgDropsPerSignal: total > 0 ? Math.round((allDrops.length / total) * 100) / 100 : 0,
      topConflicts,
      topInstruments,
    };
  }
}

// ---------------------------------------------------------------------------
// TypologyTrendIndex
// ---------------------------------------------------------------------------

class TypologyTrendIndex {
  private records: IngestionRecord[] = [];

  ingest(r: IngestionRecord): void {
    this.records.push(r);
  }

  report(pair: JurisdictionPair, alertThreshold: number): TrendReport {
    const now              = Date.now();
    const oneWeekMs        = 7 * 86_400_000;
    const currentWeekStart = now - oneWeekMs;
    const prevWeekStart    = now - 2 * oneWeekMs;

    const inPair = this.records.filter(r => r.pair === pair);
    const currentWeek  = inPair.filter(r => r.ts >= currentWeekStart);
    const previousWeek = inPair.filter(r => r.ts >= prevWeekStart && r.ts < currentWeekStart);

    // Count per typologyKey per week
    const count = (records: IngestionRecord[]): Map<string, number> => {
      const m = new Map<string, number>();
      for (const r of records) {
        m.set(r.typologyKey, (m.get(r.typologyKey) ?? 0) + 1);
      }
      return m;
    };

    const currCounts = count(currentWeek);
    const prevCounts = count(previousWeek);

    // Union of all typology keys seen in either week
    const allKeys = new Set([...currCounts.keys(), ...prevCounts.keys()]);

    const trends: TypologyTrend[] = Array.from(allKeys).map(key => {
      const curr = currCounts.get(key) ?? 0;
      const prev = prevCounts.get(key) ?? 0;
      let deltaPercent: number;
      let direction: TrendDirection;

      if (prev === 0 && curr > 0) {
        deltaPercent = 1.0;   // new typology, treat as 100% increase
        direction    = "SPIKE";
      } else if (prev === 0 && curr === 0) {
        deltaPercent = 0;
        direction    = "STABLE";
      } else {
        deltaPercent = (curr - prev) / prev;
        direction    =
          deltaPercent >= alertThreshold      ? "SPIKE"    :
          deltaPercent >= alertThreshold / 2  ? "RISING"   :
          deltaPercent <= -alertThreshold     ? "DECLINING" : "STABLE";
      }

      return {
        typologyKey:       key,
        currentWeekCount:  curr,
        previousWeekCount: prev,
        deltaPercent:      Math.round(deltaPercent * 1000) / 10,
        direction,
        alert: direction === "SPIKE",
      };
    }).sort((a, b) => b.currentWeekCount - a.currentWeekCount);

    return {
      pair,
      generatedAtUTC: new Date().toISOString(),
      trends,
      activeAlerts: trends.filter(t => t.alert),
    };
  }
}

// ---------------------------------------------------------------------------
// AggregationStore -- public API
// ---------------------------------------------------------------------------

export class AggregationStore {
  private config: AggregationConfig;
  private utility:  SignalUtilityTracker    = new SignalUtilityTracker();
  private friction: RegulatoryFrictionLedger = new RegulatoryFrictionLedger();
  private trends:   TypologyTrendIndex       = new TypologyTrendIndex();

  constructor(config: Partial<AggregationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Ingest a resolved ActionabilityVerdict into all three sub-trackers.
   * Call this immediately after actionability_resolver.resolve().
   */
  ingest(verdict: ActionabilityVerdict): void {
    const cats = verdict.signalType
      ? `${verdict.signalType}` : "UNKNOWN";
    const payload = (verdict as any)._payload as {
      bandsAndCategories?: Record<string, string | null>
    } | undefined;

    // Build typologyKey from whatever categorical fields the verdict carries.
    // In production, pass the original signal payload through for richer keying.
    const typologyKey = [
      (verdict as any).fraudTypologyCode ?? "UNKNOWN_TYPOLOGY",
      (verdict as any).paymentRail       ?? "UNKNOWN_RAIL",
      (verdict as any).geographicRiskBand ?? "UNKNOWN_RISK",
    ].join("|");

    const record: IngestionRecord = {
      ts:          Date.now(),
      pair:        pairKey(verdict.publishingJurisdiction, verdict.receivingJurisdiction),
      signalType:  verdict.signalType,
      tier:        verdict.anonymisationTier,
      verdict:     verdict.overallVerdict,
      dropLog:     verdict.regulatoryDropLog,
      typologyKey,
      amountBand:  null,
    };

    this.utility.ingest(record);
    this.friction.ingest(record);
    this.trends.ingest(record);
  }

  /**
   * Ingest with explicit typology metadata (preferred -- call this when you
   * have access to the original signal's bandsAndCategories).
   */
  ingestWithMeta(
    verdict:          ActionabilityVerdict,
    bandsAndCategories: Record<string, string | null>
  ): void {
    const typologyKey = [
      bandsAndCategories["fraudTypologyCode"]  ?? "UNKNOWN_TYPOLOGY",
      bandsAndCategories["paymentRail"]         ?? "UNKNOWN_RAIL",
      bandsAndCategories["geographicRiskBand"]  ?? "UNKNOWN_RISK",
    ].join("|");

    const record: IngestionRecord = {
      ts:          Date.now(),
      pair:        pairKey(verdict.publishingJurisdiction, verdict.receivingJurisdiction),
      signalType:  verdict.signalType,
      tier:        verdict.anonymisationTier,
      verdict:     verdict.overallVerdict,
      dropLog:     verdict.regulatoryDropLog,
      typologyKey,
      amountBand:  bandsAndCategories["transactionAmountBand"] ?? null,
    };

    this.utility.ingest(record);
    this.friction.ingest(record);
    this.trends.ingest(record);
  }

  /**
   * Generate a full aggregation report for a jurisdiction pair.
   * Defaults to all ingested data if from/to are omitted.
   */
  report(from: string, to: string): AggregationReport {
    const pair      = pairKey(from, to);
    const windowMs  = this.config.windowDays * 86_400_000;

    const utility  = this.utility.snapshot(pair, windowMs);
    const friction = this.friction.report(pair, windowMs);
    const trends   = this.trends.report(pair, this.config.alertDeltaThreshold);

    const platformSummary = this._platformSummary(utility, friction, trends);

    return {
      generatedAtUTC: new Date().toISOString(),
      pair,
      windowDays:     this.config.windowDays,
      utility,
      friction,
      trends,
      platformSummary,
    };
  }

  // -- Private --------------------------------------------------------------

  private _platformSummary(
    utility:  UtilitySnapshot,
    friction: FrictionReport,
    trends:   TrendReport
  ): AggregationReport["platformSummary"] {
    const topConflict = friction.topConflicts[0];
    const topAlert    = trends.activeAlerts[0];

    // Health score
    let health: "GREEN" | "AMBER" | "RED";
    if (utility.caseUtilityPct === 0 && utility.systemicUtilityPct < 50) {
      health = "RED";
    } else if (utility.caseUtilityFlag || trends.activeAlerts.length > 0) {
      health = "AMBER";
    } else {
      health = "GREEN";
    }

    // Primary bottleneck
    const bottleneck = topConflict
      ? `${topConflict.conflictType} (${topConflict.instrument}) -- affects ${topConflict.affectedPct}% of signals`
      : "No dominant bottleneck identified";

    // Regulatory insight
    const insight = topConflict
      ? `${topConflict.count} drop events traced to ${topConflict.instrument}. ` +
        (topConflict.resolution
          ? `Proposed resolution: ${topConflict.resolution}.`
          : `No standard resolution path identified -- bilateral review recommended.`)
      : "Friction profile within normal parameters.";

    // Recommended action
    let action: string;
    if (utility.caseUtilityPct === 0) {
      action = "Case-level utility is 0%. Initiate bilateral MOU or FIU channel agreement to unlock case-level actions.";
    } else if (trends.activeAlerts.length > 0 && topAlert) {
      action = `Typology spike detected: ${topAlert.typologyKey} (+${topAlert.deltaPercent}% WoW). Issue sector-wide typology alert.`;
    } else if (utility.caseUtilityFlag) {
      action = `Case utility below 20% (${utility.caseUtilityPct}%). Review transfer instrument and legal basis gaps.`;
    } else {
      action = "No immediate action required. Monitor friction trends.";
    }

    return { overallHealthScore: health, primaryBottleneck: bottleneck, regulatoryInsight: insight, recommendedAction: action };
  }
}

// ---------------------------------------------------------------------------
// Demo -- npx ts-node signal_aggregator.ts
// ---------------------------------------------------------------------------

if (require.main === module) {
  const { ActionabilityResolver } = require("./actionability_resolver");
  const path = require("path");

  const ACTIONABILITY_DIR = path.join(__dirname, "..", "regulations");
  const resolver = new ActionabilityResolver(
    path.join(ACTIONABILITY_DIR, "Brazil_actionability.json")
  );

  const store = new AggregationStore({ windowDays: 30, alertDeltaThreshold: 0.20 });

  const typologies  = ["IMPERSONATION", "INVESTMENT_SCAM", "ROMANCE_SCAM", "INVOICE_FRAUD"];
  const rails       = ["FPS", "CHAPS", "WIRE"];
  const riskBands   = ["HIGH", "MEDIUM", "LOW"];

  let i = 0;
  console.log("Starting 30-second simulation...");

  const interval = setInterval(() => {
    // Inject a few signals per tick
    for (let j = 0; j < 5; j++) {
      const typology = typologies[i % typologies.length];
      const rail     = rails[i % rails.length];
      const risk     = riskBands[i % riskBands.length];
      i++;

      const signal = {
        signalEnvelopeVersion:  "2.0-MVP",
        signalId:               `demo-${i}`,
        publishingJurisdiction: "UK",
        targetJurisdictions:    ["BR"],
        publishedAtUTC:         new Date().toISOString(),
        signalType:             "APP_FRAUD",
        anonymisationTier:      2,
        tierRationale:          "Tier 2",
        tippingOffCompliance:   { sarExistenceDisclosed: false, languageNeutralityConfirmed: true },
        payload: {
          identifierFields:   { accountNumber: `token-${i}`, deviceFingerprint: `token-dev-${i}` },
          bandsAndCategories: { transactionAmountBand: "0-50000", paymentRail: rail, fraudTypologyCode: typology, geographicRiskBand: risk },
          timestamps:         { transactionUTC: new Date().toISOString(), detectionUTC: new Date().toISOString() },
          notes:              null,
        },
        transferMechanisms:  { "BR": "IDTA + ANPD SCC" },
        retentionPolicy:    { minimumYears: 5 },
        kAnonymity:         { required: 5, enforced: true, passed: true },
        complianceWarnings: [],
        warningConditionGate: { met: true, legalBasis: "ECCTA 2023 s.189" },
      };

      const verdict = resolver.resolve(signal);
      store.ingestWithMeta(verdict, signal.payload.bandsAndCategories);
    }
  }, 1000);

  // Print report every 5 seconds
  const reportInterval = setInterval(() => {
    const report = store.report("UK", "BR");
    console.log(`\n--- Tick at ${i} signals ingested ---`);
    console.log(`Total Signals: ${report.utility.totalSignals}`);
    console.log(`Health Score: ${report.platformSummary.overallHealthScore}`);
    console.log(`Recommended Action: ${report.platformSummary.recommendedAction}`);
    console.log(`Top Conflict: ${report.friction.topConflicts[0]?.conflictType} (${report.friction.topConflicts[0]?.count} drops)`);
    console.log(`Trends (top 2): ${JSON.stringify(report.trends.trends.slice(0,2).map(t => [t.typologyKey, t.direction]))}`);
  }, 5000);

  setTimeout(() => {
    clearInterval(interval);
    clearInterval(reportInterval);
    console.log("\nSimulation complete.");
  }, 30000);
}
