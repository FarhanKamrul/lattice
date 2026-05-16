import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

import { fileURLToPath } from 'url';

import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Config & Constants
// ---------------------------------------------------------------------------
// @ts-ignore
const SCRIPT_DIR = typeof import.meta !== 'undefined' && import.meta.dirname ? import.meta.dirname : process.cwd();
const PROJECT_ROOT = path.join(SCRIPT_DIR, '..');
const REG_DIR = path.join(PROJECT_ROOT, 'regulations');

const JURISDICTION_FILE_MAP: Record<string, string> = {
    "UK": "UK",
    "US": "US",
    "BR": "Brazil",
    "EU": "EU",
};

const PROHIBITED_TERMS = [
    "SAR", "suspicious activity report", "under investigation",
    "law enforcement", "FinCEN", "NCA", "Sars", "COAF",
];

const TIER1_BANDS = [[1000, "0-1000"], [10000, "1000-10000"], [50000, "10000-50000"], [Infinity, "50000+"]] as const;
const TIER2_BANDS = [[50000, "0-50000"], [Infinity, "50000+"]] as const;
const TIER3_BANDS = [[100000, "0-100000"], [Infinity, "100000+"]] as const;

const DIRECT_IDENTIFIERS = new Set(["fullName", "dateOfBirth", "nationalId", "passportNumber", "taxId", "email", "postalAddress"]);
const INDIRECT_IDENTIFIERS = new Set(["accountNumber", "sortCode", "ipAddress", "deviceFingerprint", "phoneNumber", "iban", "bic", "pixKey"]);
const CATEGORICAL_FIELDS = new Set(["paymentRail", "fraudTypologyCode", "geographicRiskBand", "deviceRiskTier", "pixKeyTypeCategory"]);

// ---------------------------------------------------------------------------
// Token Vault (In-Memory)
// ---------------------------------------------------------------------------
const _TOKEN_VAULT: Record<string, string> = {};
const _VALUE_TO_TOKEN: Record<string, string> = {};

function _mint_token(value: string): string {
    if (_VALUE_TO_TOKEN[value]) return _VALUE_TO_TOKEN[value];
    const token = crypto.randomUUID();
    _TOKEN_VAULT[token] = value;
    _VALUE_TO_TOKEN[value] = token;
    return token;
}

function _hmac_value(value: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(value).digest('hex');
}

// ---------------------------------------------------------------------------
// Noise & Banding
// ---------------------------------------------------------------------------
function _laplace_noise(sensitivity: number, epsilon: number): number {
    const u = Math.random() - 0.5;
    return -(sensitivity / epsilon) * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

function _band(amount: number, bands: ReadonlyArray<readonly [number, string]>): string {
    for (const [ceiling, label] of bands) {
        if (amount < ceiling) return label;
    }
    return bands[bands.length - 1][1];
}

function _band_amount(amount: any, tier: number): string | null {
    if (amount === null || amount === undefined) return null;
    const a = Number(amount);
    if (tier === 1) return _band(a, TIER1_BANDS);
    if (tier === 2) return _band(a, TIER2_BANDS);
    const noisy = a + _laplace_noise(50000, 0.5);
    return _band(Math.max(noisy, 0), TIER3_BANDS);
}

// ---------------------------------------------------------------------------
// Dates & Narrative
// ---------------------------------------------------------------------------
function _generalise_ts(ts: string | null | undefined, tier: number): string | null {
    if (!ts) return null;
    try {
        const dt = new Date(ts.replace("Z", "+00:00"));
        if (isNaN(dt.getTime())) return ts;
        
        const pad = (n: number) => n.toString().padStart(2, '0');
        const ymd = `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
        
        if (tier === 1) return `${ymd}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:00Z`;
        if (tier === 2) return `${ymd}T${pad(dt.getUTCHours())}:00:00Z`;
        return `${ymd}Z`; // Tier 3
    } catch {
        return ts;
    }
}

function _sanitise_narrative(text: string | null | undefined, tier: number): string | null {
    if (!text || tier === 3) return null;
    let out = text;
    for (const term of PROHIBITED_TERMS) {
        const regex = new RegExp(term, "gi");
        out = out.replace(regex, "[REDACTED]");
    }
    if (tier === 2) {
        out = out.includes(".") ? out.split(".")[0].trim() + "." : out;
    }
    return out;
}

// ---------------------------------------------------------------------------
// K-Anonymity
// ---------------------------------------------------------------------------
function _k_anon_check(signal: any, k: number, local_dataset: any[]): [boolean, string] {
    const cats = {
        paymentRail: signal.payload.bandsAndCategories?.paymentRail,
        fraudTypologyCode: signal.payload.bandsAndCategories?.fraudTypologyCode,
        geographicRiskBand: signal.payload.bandsAndCategories?.geographicRiskBand,
        transactionAmountBand: signal.payload.bandsAndCategories?.transactionAmountBand,
    };
    
    let matches = 0;
    for (const record of local_dataset) {
        let match = true;
        for (const [key, val] of Object.entries(cats)) {
            if (val !== undefined && val !== null && record[key] !== val) {
                match = false;
                break;
            }
        }
        if (match) matches++;
    }
    
    return [matches >= k, `k-anonymity check: ${matches} matching records (required ≥${k})`];
}

// ---------------------------------------------------------------------------
// Transfer Mechanism
// ---------------------------------------------------------------------------
function _transfer_mechanism(source: string, target: string, tier: number): string {
    if (tier === 3) return "None required — Tier 3 signal is anonymous data";
    
    const pair = `${source}-${target}`;
    const pairs: Record<string, string> = {
        "UK-EU": "UK Adequacy Decision (DUAA 2025) — no additional instrument required",
        "EU-UK": "EU Adequacy Decision for UK — no additional instrument required",
        "UK-US": "IDTA + contractual controls + Egmont/MLAT for FIU channel",
        "US-UK": "Contractual controls + Egmont/MLAT",
        "UK-BR": "IDTA + ANPD SCC",
        "BR-UK": "ANPD SCC + IDTA",
        "US-BR": "Contractual controls + ANPD SCC + Egmont/MLAT",
        "BR-US": "ANPD SCC + contractual controls",
        "EU-BR": "EU SCCs (Commission Decision 2021/914) + ANPD SCC",
        "BR-EU": "ANPD SCC + EU SCCs",
        "EU-US": "EU SCCs (Commission Decision 2021/914) + contractual controls",
        "US-EU": "Contractual controls + EU SCCs",
    };
    return pairs[pair] || "Jurisdiction-specific legal review required";
}

// ---------------------------------------------------------------------------
// Policy Resolver
// ---------------------------------------------------------------------------
export class PolicyResolver {
    sourceCode: string;
    targetCodes: string[];
    sourceRules: any;
    targetRulesArray: any[];

    constructor(sourceRules: any, targetRulesArray: any[]) {
        this.sourceRules = sourceRules;
        this.targetRulesArray = targetRulesArray;
        this.sourceCode = sourceRules.jurisdictionCode;
        this.targetCodes = targetRulesArray.map((r: any) => r.jurisdictionCode);
    }

    resolveTier(forceTier?: number): number {
        if (forceTier !== undefined) return forceTier;

        const srcTiers = this._supportedTiers(this.sourceRules);
        const tgtTiersArray = this.targetRulesArray.map(r => this._supportedTiers(r));

        let common = [...srcTiers];
        for (const tgtTiers of tgtTiersArray) {
            common = common.filter(t => tgtTiers.has(t));
        }

        common.sort((a, b) => a - b);
        if (common.length === 0) return 3;

        for (const t of common) {
            if (t >= 2) return t;
        }
        return 3;
    }

    private _supportedTiers(rules: any): Set<number> {
        const tiers = rules.anonymisationTiers || {};
        if (Object.keys(tiers).length > 0) {
            const result = new Set<number>();
            for (const [k, v] of Object.entries(tiers)) {
                if ((v as any).permitted) result.add(parseInt(k));
            }
            return result;
        }

        const supported = new Set<number>([3]);
        const dp = rules.dataProtection || {};

        const algo = (dp.pseudonymisationStandard?.algorithm || "").toUpperCase();
        if (algo.includes("HMAC")) {
            supported.add(1);
            supported.add(2);
        }

        const measures = dp.recognisedTechnicalMeasures || [];
        if (measures.includes("HMAC-SHA256") || measures.includes("hmac_sha256")) supported.add(1);
        if (measures.includes("tokenisation") || measures.includes("k-anonymity")) supported.add(2);

        return supported;
    }

    transferMechanisms(tier: number): Record<string, string> {
        const mechs: Record<string, string> = {};
        for (const target of this.targetCodes) {
            mechs[target] = _transfer_mechanism(this.sourceCode, target, tier);
        }
        return mechs;
    }
}

// ---------------------------------------------------------------------------
// Signal Builder
// ---------------------------------------------------------------------------
export function buildSignal(
    rawEvent: any,
    sourceRules: any,
    targetRulesArray: any[],
    hmacSecret: string,
    tier: number,
    localDataset: any[]
): any {
    const source = sourceRules.jurisdictionCode;
    const targets = targetRulesArray.map(r => r.jurisdictionCode);
    const kMin = tier === 3 ? 10 : (tier === 2 ? 5 : 0);

    const mechs: Record<string, string> = {};
    let minYears = sourceRules.dataProtection?.dataRetention?.minimumYears || 5;
    for (const tgtRule of targetRulesArray) {
        mechs[tgtRule.jurisdictionCode] = _transfer_mechanism(source, tgtRule.jurisdictionCode, tier);
        const tgtYears = tgtRule.dataProtection?.dataRetention?.minimumYears || 5;
        if (tgtYears > minYears) minYears = tgtYears;
    }

    const signal: any = {
        signalEnvelopeVersion: "2.0-MVP",
        signalId: crypto.randomUUID(),
        publishingJurisdiction: source,
        targetJurisdictions: targets,
        publishedAtUTC: new Date().toISOString(),
        signalType: rawEvent.signalType || "UNKNOWN",
        anonymisationTier: tier,
        tierRationale: _tierRationale(tier),
        tippingOffCompliance: {
            sarExistenceDisclosed: false,
            languageNeutralityConfirmed: true,
        },
        payload: {
            identifierFields: {},
            bandsAndCategories: {},
            timestamps: {
                transactionUTC: _generalise_ts(rawEvent.transactionUTC, tier),
                detectionUTC: _generalise_ts(rawEvent.detectionUTC, tier),
            },
            notes: _sanitise_narrative(rawEvent.narrative, tier),
        },
        transferMechanisms: mechs,
        retentionPolicy: { minimumYears: minYears },
        kAnonymity: { required: kMin, enforced: tier >= 2 },
        complianceWarnings: [],
    };

    if (source === "UK") {
        signal.warningConditionGate = {
            met: !!rawEvent.warningConditionMet,
            legalBasis: "ECCTA 2023 s.189",
        };
        if (!rawEvent.warningConditionMet) {
            signal.complianceWarnings.push("UK source: warningConditionMet must be true for platform-mediated sharing.");
        }
    }

    for (const [field, value] of Object.entries(rawEvent)) {
        if (["signalType", "transactionUTC", "detectionUTC", "warningConditionMet", "narrative"].includes(field) || value === null || value === undefined) {
            continue;
        }

        if (DIRECT_IDENTIFIERS.has(field)) {
            signal.complianceWarnings.push(`Direct identifier suppressed: ${field}`);
            continue;
        }

        if (field === "transactionAmount") {
            signal.payload.bandsAndCategories.transactionAmountBand = _band_amount(value, tier);
            continue;
        }

        if (INDIRECT_IDENTIFIERS.has(field)) {
            if (tier === 3) continue;
            if (tier === 1) {
                signal.payload.identifierFields[field] = _hmac_value(String(value), hmacSecret);
            } else {
                signal.payload.identifierFields[field] = _mint_token(String(value));
            }
            continue;
        }

        if (CATEGORICAL_FIELDS.has(field)) {
            signal.payload.bandsAndCategories[field] = value;
        }
    }

    if (tier >= 2 && localDataset && localDataset.length > 0) {
        const [passed, msg] = _k_anon_check(signal, kMin, localDataset);
        signal.kAnonymity.result = msg;
        if (!passed) {
            signal.complianceWarnings.push(`k-anonymity FAILED (k<${kMin}): signal generalised to Tier 3 to prevent re-identification.`);
            signal.payload.identifierFields = {};
            signal.anonymisationTier = 3;
            signal.tierRationale = _tierRationale(3) + " [auto-escalated from Tier 2]";
            
            for (const tgt of targets) {
                signal.transferMechanisms[tgt] = _transfer_mechanism(source, tgt, 3);
            }
        } else {
            signal.kAnonymity.passed = true;
        }
    }

    return signal;
}

function _tierRationale(tier: number): string {
    const rationales: Record<number, string> = {
        1: "Tier 1 — HMAC-SHA256 pseudonymisation. Full transfer instrument required.",
        2: "Tier 2 — Random token vault + k-anonymity (k≥5). Lighter transfer obligations.",
        3: "Tier 3 — Differential privacy + k-anonymity (k≥10). No transfer instrument required.",
    };
    return rationales[tier] || "Unknown Tier";
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------
export function loadRules(jurisdiction: string): any {
    const filename = JURISDICTION_FILE_MAP[jurisdiction] || jurisdiction;
    const p = path.join(REG_DIR, `${filename}.json`);
    if (!fs.existsSync(p)) {
        console.warn(`[WARN] Rules file not found: ${p} — using minimal stub.`);
        return _stubRules(jurisdiction);
    }
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function _stubRules(code: string): any {
    return {
        jurisdictionCode: code,
        dataProtection: {
            dataRetention: { minimumYears: 5 },
            recognisedTechnicalMeasures: ["HMAC-SHA256", "tokenisation", "k-anonymity", "differential-privacy"],
        },
        lceLcdConstraints: {
            minRetentionYears: 5,
            noPlaintextDirectIdentifiers: true,
        },
        anonymisationTiers: {
            "1": { permitted: true },
            "2": { permitted: true },
            "3": { permitted: true },
        },
    };
}

// ---------------------------------------------------------------------------
// CLI Execution
// ---------------------------------------------------------------------------
if (require.main === module) {
    const args = process.argv.slice(2);
    let source = "UK";
    let targets = ["BR"];
    let forceTier: number | undefined = undefined;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--source") source = args[++i];
        else if (args[i] === "--target") {
            const t = args[++i];
            targets = t.split(",").map(x => x.trim());
        }
        else if (args[i] === "--tier") forceTier = parseInt(args[++i], 10);
    }

    const sourceRules = loadRules(source);
    const targetRulesArray = targets.map(t => loadRules(t));
    const resolver = new PolicyResolver(sourceRules, targetRulesArray);
    const secret = "demo-shared-secret-change-me";

    const demoEvent = {
        signalType: "APP_FRAUD",
        fullName: "Jane Example",
        dateOfBirth: "1992-01-04",
        accountNumber: "12345678",
        sortCode: "11-22-33",
        ipAddress: "203.0.113.42",
        deviceFingerprint: "ios-safari-17-fp-abc123",
        phoneNumber: "+447700900123",
        transactionAmount: 18250.34,
        paymentRail: "FPS",
        fraudTypologyCode: "IMPERSONATION",
        geographicRiskBand: "HIGH",
        transactionUTC: "2026-05-16T08:40:00Z",
        detectionUTC: "2026-05-16T08:43:00Z",
        warningConditionMet: true,
        narrative: "Customer mentioned a SAR and said the account is under investigation after unusual payment behaviour."
    };

    const demoLocalDataset = [
        { paymentRail: "FPS", fraudTypologyCode: "IMPERSONATION", geographicRiskBand: "HIGH", transactionAmountBand: "0-50000" },
        { paymentRail: "FPS", fraudTypologyCode: "IMPERSONATION", geographicRiskBand: "HIGH", transactionAmountBand: "0-50000" },
        { paymentRail: "FPS", fraudTypologyCode: "IMPERSONATION", geographicRiskBand: "HIGH", transactionAmountBand: "0-50000" },
        { paymentRail: "FPS", fraudTypologyCode: "IMPERSONATION", geographicRiskBand: "HIGH", transactionAmountBand: "0-50000" },
        { paymentRail: "FPS", fraudTypologyCode: "IMPERSONATION", geographicRiskBand: "HIGH", transactionAmountBand: "0-50000" },
    ];

    const tier = resolver.resolveTier(forceTier);
    console.error(`[PolicyResolver] auto-selected Tier ${tier} for ${source}→${targets.join(',')}`);
    const sig = buildSignal(demoEvent, sourceRules, targetRulesArray, secret, tier, demoLocalDataset);
    console.log(JSON.stringify(sig, null, 2));
}
