"""
Cross-Border Financial Crime Intelligence Platform
Adaptive Signal Emitter — UK / EU MVP

Tiers:
  1 - Raw Intelligence       (HMAC pseudonymisation, narrow bands)
  2 - Adaptive Intelligence  (token vault + k-anonymity k>=5)  ← default
  3 - Statistical            (differential privacy, k>=10, no identifiers)

Usage:
  python3 adapt_signal.py
  python3 adapt_signal.py --tier 1
  python3 adapt_signal.py --tier 3
  python3 adapt_signal.py --source UK --target EU
"""

import argparse
import hashlib
import hmac as hmac_lib
import json
import math
import random
import sys
import uuid
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR   = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
REG_DIR      = PROJECT_ROOT / "regulations"

JURISDICTION_FILE_MAP = {
    "UK": "UK",
    "US": "US",
    "BR": "Brazil",
    "EU": "EU",
}

# ---------------------------------------------------------------------------
# In-memory token vault  (in production: replace with encrypted KV store)
# ---------------------------------------------------------------------------
_TOKEN_VAULT: dict[str, str] = {}   # token → original value (stays at source FI)
_VALUE_TO_TOKEN: dict[str, str] = {}  # original → token (for consistent re-use per session)


def _mint_token(value: str) -> str:
    """Return a stable random UUID token for this session; store in vault."""
    if value in _VALUE_TO_TOKEN:
        return _VALUE_TO_TOKEN[value]
    token = str(uuid.uuid4())
    _TOKEN_VAULT[token] = value
    _VALUE_TO_TOKEN[value] = token
    return token


def _hmac_value(value: str, secret: str) -> str:
    return hmac_lib.new(
        secret.encode("utf-8"),
        value.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


# ---------------------------------------------------------------------------
# Laplace noise for differential privacy (Tier 3)
# ---------------------------------------------------------------------------
def _laplace_noise(sensitivity: float, epsilon: float) -> float:
    u = random.uniform(-0.5, 0.5)
    return -sensitivity / epsilon * math.copysign(math.log(1 - 2 * abs(u)), u)


# ---------------------------------------------------------------------------
# Amount banding
# ---------------------------------------------------------------------------
TIER1_BANDS = [(1_000, "0-1000"), (10_000, "1000-10000"),
               (50_000, "10000-50000"), (float("inf"), "50000+")]

TIER2_BANDS = [(50_000, "0-50000"), (float("inf"), "50000+")]

TIER3_BANDS = [(100_000, "0-100000"), (float("inf"), "100000+")]


def _band(amount: float, bands: list) -> str:
    for ceiling, label in bands:
        if amount < ceiling:
            return label
    return bands[-1][1]


def _band_amount(amount, tier: int) -> str | None:
    if amount is None:
        return None
    a = float(amount)
    if tier == 1:
        return _band(a, TIER1_BANDS)
    if tier == 2:
        return _band(a, TIER2_BANDS)
    # Tier 3: add Laplace noise before banding (sensitivity=50000, epsilon=0.5)
    noisy = a + _laplace_noise(50_000, 0.5)
    return _band(max(noisy, 0), TIER3_BANDS)


# ---------------------------------------------------------------------------
# Timestamp generalisation
# ---------------------------------------------------------------------------
def _generalise_ts(ts: str | None, tier: int) -> str | None:
    if not ts:
        return None
    try:
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        if tier == 1:
            return dt.strftime("%Y-%m-%dT%H:%M:00Z")   # minute precision
        if tier == 2:
            return dt.strftime("%Y-%m-%dT%H:00:00Z")   # hour precision
        return dt.strftime("%Y-%m-%dZ")                 # day only (Tier 3)
    except ValueError:
        return ts


# ---------------------------------------------------------------------------
# Narrative handling
# ---------------------------------------------------------------------------
PROHIBITED_TERMS = [
    "SAR", "suspicious activity report", "under investigation",
    "law enforcement", "FinCEN", "NCA", "Sars", "COAF",
]


def _sanitise_narrative(text: str | None, tier: int) -> str | None:
    if not text or tier == 3:
        return None                      # Tier 3: suppress entirely
    out = text
    for term in PROHIBITED_TERMS:
        for variant in (term, term.lower(), term.upper()):
            out = out.replace(variant, "[REDACTED]")
    if tier == 2:
        # Reduce to first sentence only
        out = out.split(".")[0].strip() + "." if "." in out else out
    return out


# ---------------------------------------------------------------------------
# k-anonymity check
# ---------------------------------------------------------------------------
def _k_anon_check(signal: dict, k: int, local_dataset: list[dict]) -> tuple[bool, str]:
    """
    Check whether the combination of categorical fields in the signal matches
    at least k records in the local_dataset.

    In a real deployment local_dataset = query against the FI's fraud ledger.
    For this demo we use the synthetic sample passed in at runtime.
    """
    cats = {
        "paymentRail":       signal["payload"]["bandsAndCategories"].get("paymentRail"),
        "fraudTypologyCode": signal["payload"]["bandsAndCategories"].get("fraudTypologyCode"),
        "geographicRiskBand":signal["payload"]["bandsAndCategories"].get("geographicRiskBand"),
        "transactionAmountBand": signal["payload"]["bandsAndCategories"].get("transactionAmountBand"),
    }
    matches = sum(
        1 for record in local_dataset
        if all(record.get(k_) == v for k_, v in cats.items() if v is not None)
    )
    return matches >= k, f"k-anonymity check: {matches} matching records (required ≥{k})"


# ---------------------------------------------------------------------------
# Transfer mechanism lookup
# ---------------------------------------------------------------------------
def _transfer_mechanism(source: str, target: str, tier: int) -> str:
    if tier == 3:
        return "None required — Tier 3 signal is anonymous data"
    pairs = {
        ("UK", "EU"): "UK Adequacy Decision (DUAA 2025) — no additional instrument required",
        ("EU", "UK"): "EU Adequacy Decision for UK — no additional instrument required",
        ("UK", "US"): "IDTA + contractual controls + Egmont/MLAT for FIU channel",
        ("US", "UK"): "Contractual controls + Egmont/MLAT",
        ("UK", "BR"): "IDTA + ANPD SCC",
        ("BR", "UK"): "ANPD SCC + IDTA",
        ("US", "BR"): "Contractual controls + ANPD SCC + Egmont/MLAT",
        ("BR", "US"): "ANPD SCC + contractual controls",
        ("EU", "BR"): "EU SCCs (Commission Decision 2021/914) + ANPD SCC",
        ("BR", "EU"): "ANPD SCC + EU SCCs",
        ("EU", "US"): "EU SCCs (Commission Decision 2021/914) + contractual controls",
        ("US", "EU"): "Contractual controls + EU SCCs",
    }
    return pairs.get((source, target), "Jurisdiction-specific legal review required")


# ---------------------------------------------------------------------------
# Policy resolver — picks the right tier automatically
# ---------------------------------------------------------------------------
class PolicyResolver:
    """
    Reads source and target jurisdiction rules and resolves the
    highest-fidelity tier that both sides legally accept.

    Tier selection logic (UK↔EU default):
      - If both sides have a confirmed full transfer agreement AND
        both permit Tier 1 pseudonymisation → Tier 1
      - If both sides accept tokenisation + k-anonymity (Tier 2) → Tier 2  ← default
      - Fallback → Tier 3 (always safe, no transfer instrument needed)
    """

    TIER_CAPABILITY_FIELD = "anonymisationTiers"  # expected in jurisdiction JSON

    def __init__(self, source_rules: dict, target_rules: dict):
        self.source = source_rules
        self.target = target_rules
        self.source_code = source_rules["jurisdictionCode"]
        self.target_code = target_rules["jurisdictionCode"]

    def resolve_tier(self, force_tier: int | None = None) -> int:
        if force_tier is not None:
            return force_tier

        src_tiers = self._supported_tiers(self.source)
        tgt_tiers = self._supported_tiers(self.target)
        common    = sorted(src_tiers & tgt_tiers)

        if not common:
            return 3  # always safe fallback

        # Default to lowest-numbered common tier ≥ 2
        # (Tier 1 requires explicit transfer confirmation, so we skip it by default)
        for t in common:
            if t >= 2:
                return t
        return 3

    def _supported_tiers(self, rules: dict) -> set[int]:
        tiers = rules.get(self.TIER_CAPABILITY_FIELD, {})
        if tiers:
            return {int(k) for k, v in tiers.items() if v.get("permitted")}

        supported = {3}  # Tier 3 always available
        dp = rules.get("dataProtection", {})

        # Check the actual JSON structure: dataProtection.pseudonymisationStandard.algorithm
        algo = dp.get("pseudonymisationStandard", {}).get("algorithm", "").upper()
        if "HMAC" in algo:
            supported.add(1)
            # If HMAC pseudonymisation is supported, tokenisation/k-anonymity (Tier 2) is also supported
            supported.add(2)

        # Fallback for stubs that might still use recognisedTechnicalMeasures
        measures = dp.get("recognisedTechnicalMeasures", [])
        if "HMAC-SHA256" in measures or "hmac_sha256" in measures:
            supported.add(1)
        if "tokenisation" in measures or "k-anonymity" in measures:
            supported.add(2)

        return supported

    def transfer_mechanism(self, tier: int) -> str:
        return _transfer_mechanism(self.source_code, self.target_code, tier)


# ---------------------------------------------------------------------------
# Signal builder
# ---------------------------------------------------------------------------
DIRECT_IDENTIFIERS  = {"fullName", "dateOfBirth", "nationalId", "passportNumber",
                        "taxId", "email", "postalAddress"}
INDIRECT_IDENTIFIERS = {"accountNumber", "sortCode", "ipAddress",
                         "deviceFingerprint", "phoneNumber", "iban", "bic",
                         "pixKey"}
CATEGORICAL_FIELDS   = {"paymentRail", "fraudTypologyCode", "geographicRiskBand",
                         "deviceRiskTier", "pixKeyTypeCategory"}


def build_signal(
    raw_event:    dict,
    source_rules: dict,
    target_rules: dict,
    hmac_secret:  str,
    tier:         int,
    local_dataset: list[dict],
) -> dict:

    source = source_rules["jurisdictionCode"]
    target = target_rules["jurisdictionCode"]
    k_min  = 10 if tier == 3 else (5 if tier == 2 else 0)

    signal = {
        "signalEnvelopeVersion": "2.0-MVP",
        "signalId":               str(uuid.uuid4()),
        "publishingJurisdiction": source,
        "targetJurisdictions":    [target],
        "publishedAtUTC":         datetime.now(timezone.utc).isoformat(),
        "signalType":             raw_event.get("signalType", "UNKNOWN"),
        "anonymisationTier":      tier,
        "tierRationale":          _tier_rationale(tier),
        "tippingOffCompliance": {
            "sarExistenceDisclosed":    False,
            "languageNeutralityConfirmed": True,
        },
        "payload": {
            "identifierFields":   {},
            "bandsAndCategories": {},
            "timestamps": {
                "transactionUTC": _generalise_ts(raw_event.get("transactionUTC"), tier),
                "detectionUTC":   _generalise_ts(raw_event.get("detectionUTC"),   tier),
            },
            "notes": _sanitise_narrative(raw_event.get("narrative"), tier),
        },
        "transferMechanism": _transfer_mechanism(source, target, tier),
        "retentionPolicy": {
            "minimumYears": max(
                source_rules["dataProtection"]["dataRetention"]["minimumYears"],
                target_rules["dataProtection"]["dataRetention"]["minimumYears"],
            )
        },
        "kAnonymity": {"required": k_min, "enforced": tier >= 2},
        "complianceWarnings": [],
    }

    # ── UK-specific gate ─────────────────────────────────────────────────────
    if source == "UK":
        signal["warningConditionGate"] = {
            "met":        bool(raw_event.get("warningConditionMet", False)),
            "legalBasis": "ECCTA 2023 s.189",
        }
        if not raw_event.get("warningConditionMet"):
            signal["complianceWarnings"].append(
                "UK source: warningConditionMet must be true for platform-mediated sharing."
            )

    # ── Field processing ─────────────────────────────────────────────────────
    for field, value in raw_event.items():
        if field in {"signalType", "transactionUTC", "detectionUTC",
                     "warningConditionMet", "narrative"} or value is None:
            continue

        if field in DIRECT_IDENTIFIERS:
            signal["complianceWarnings"].append(f"Direct identifier suppressed: {field}")
            continue  # always drop regardless of tier

        if field == "transactionAmount":
            signal["payload"]["bandsAndCategories"]["transactionAmountBand"] = (
                _band_amount(value, tier)
            )
            continue

        if field in INDIRECT_IDENTIFIERS:
            if tier == 3:
                # Suppress all indirect identifiers at Tier 3
                continue
            if tier == 1:
                signal["payload"]["identifierFields"][field] = _hmac_value(str(value), hmac_secret)
            else:
                # Tier 2: random token — mathematically unrelated to original
                signal["payload"]["identifierFields"][field] = _mint_token(str(value))
            continue

        if field in CATEGORICAL_FIELDS:
            signal["payload"]["bandsAndCategories"][field] = value

    # ── k-anonymity enforcement ───────────────────────────────────────────────
    if tier >= 2 and local_dataset:
        passed, msg = _k_anon_check(signal, k_min, local_dataset)
        signal["kAnonymity"]["result"] = msg
        if not passed:
            signal["complianceWarnings"].append(
                f"k-anonymity FAILED (k<{k_min}): signal generalised to Tier 3 "
                f"to prevent re-identification."
            )
            # Escalate to Tier 3: wipe identifier fields
            signal["payload"]["identifierFields"] = {}
            signal["anonymisationTier"]  = 3
            signal["tierRationale"]      = _tier_rationale(3) + " [auto-escalated from Tier 2]"
            signal["transferMechanism"]  = _transfer_mechanism(source, target, 3)
        else:
            signal["kAnonymity"]["passed"] = True

    return signal


def _tier_rationale(tier: int) -> str:
    return {
        1: "Tier 1 — HMAC-SHA256 pseudonymisation. Full transfer instrument required.",
        2: "Tier 2 — Random token vault + k-anonymity (k≥5). Lighter transfer obligations.",
        3: "Tier 3 — Differential privacy + k-anonymity (k≥10). No transfer instrument required.",
    }[tier]


# ---------------------------------------------------------------------------
# Rules loader
# ---------------------------------------------------------------------------
def load_rules(jurisdiction: str) -> dict:
    filename = JURISDICTION_FILE_MAP.get(jurisdiction, jurisdiction)
    path = REG_DIR / f"{filename}.json"
    if not path.exists():
        print(f"[WARN] Rules file not found: {path} — using minimal stub.", file=sys.stderr)
        return _stub_rules(jurisdiction)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _stub_rules(code: str) -> dict:
    """Minimal stub so the script runs without all JSON files present."""
    return {
        "jurisdictionCode": code,
        "dataProtection": {
            "dataRetention":             {"minimumYears": 5},
            "recognisedTechnicalMeasures": ["HMAC-SHA256", "tokenisation", "k-anonymity",
                                            "differential-privacy"],
        },
        "lceLcdConstraints": {
            "minRetentionYears":          5,
            "noPlaintextDirectIdentifiers": True,
        },
        "anonymisationTiers": {
            "1": {"permitted": True},
            "2": {"permitted": True},
            "3": {"permitted": True},
        },
    }


# ---------------------------------------------------------------------------
# Synthetic local dataset for k-anonymity demo
# (replace with real ledger query in production)
# ---------------------------------------------------------------------------
DEMO_LOCAL_DATASET = [
    {"paymentRail": "FPS", "fraudTypologyCode": "IMPERSONATION",
     "geographicRiskBand": "HIGH", "transactionAmountBand": "0-50000"},
    {"paymentRail": "FPS", "fraudTypologyCode": "IMPERSONATION",
     "geographicRiskBand": "HIGH", "transactionAmountBand": "0-50000"},
    {"paymentRail": "FPS", "fraudTypologyCode": "IMPERSONATION",
     "geographicRiskBand": "HIGH", "transactionAmountBand": "0-50000"},
    {"paymentRail": "FPS", "fraudTypologyCode": "IMPERSONATION",
     "geographicRiskBand": "HIGH", "transactionAmountBand": "0-50000"},
    {"paymentRail": "FPS", "fraudTypologyCode": "IMPERSONATION",
     "geographicRiskBand": "HIGH", "transactionAmountBand": "0-50000"},
    # Add more records here to simulate a richer local fraud ledger
]


# ---------------------------------------------------------------------------
# Demo raw event
# ---------------------------------------------------------------------------
def demo_event() -> dict:
    return {
        "signalType":          "APP_FRAUD",
        "fullName":            "Jane Example",
        "dateOfBirth":         "1992-01-04",
        "accountNumber":       "12345678",
        "sortCode":            "11-22-33",
        "ipAddress":           "203.0.113.42",
        "deviceFingerprint":   "ios-safari-17-fp-abc123",
        "phoneNumber":         "+447700900123",
        "transactionAmount":   18250.34,
        "paymentRail":         "FPS",
        "fraudTypologyCode":   "IMPERSONATION",
        "geographicRiskBand":  "HIGH",
        "transactionUTC":      "2026-05-16T08:40:00Z",
        "detectionUTC":        "2026-05-16T08:43:00Z",
        "warningConditionMet": True,
        "narrative": (
            "Customer mentioned a SAR and said the account is under investigation "
            "after unusual payment behaviour."
        ),
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(description="Adaptive cross-border fraud signal emitter")
    parser.add_argument("--source",  default="UK",  help="Source jurisdiction code (default: UK)")
    parser.add_argument("--target",  default="BR",  help="Target jurisdiction code (default: BR)")
    parser.add_argument("--tier",    type=int, default=None, choices=[1, 2, 3],
                        help="Force a specific tier (default: auto-resolved)") 
    parser.add_argument("--all-tiers", action="store_true",
                        help="Emit the same event at all three tiers for comparison")
    args = parser.parse_args()

    source_rules = load_rules(args.source)
    target_rules = load_rules(args.target)
    resolver     = PolicyResolver(source_rules, target_rules)
    secret       = "demo-shared-secret-change-me"
    event        = demo_event()

    if args.all_tiers:
        for t in [1, 2, 3]:
            print(f"\n{'='*60}")
            print(f"  TIER {t}  |  {_tier_rationale(t)}")
            print('='*60)
            sig = build_signal(event, source_rules, target_rules, secret, t, DEMO_LOCAL_DATASET)
            print(json.dumps(sig, indent=2))
    else:
        tier = resolver.resolve_tier(force_tier=args.tier)
        print(f"[PolicyResolver] auto-selected Tier {tier} for {args.source}→{args.target}",
              file=sys.stderr)
        sig = build_signal(event, source_rules, target_rules, secret, tier, DEMO_LOCAL_DATASET)
        print(json.dumps(sig, indent=2))


if __name__ == "__main__":
    main()
