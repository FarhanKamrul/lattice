import { useState } from 'react';
import { Scale, ChevronDown, ChevronRight, Lightbulb } from 'lucide-react';
import { cn } from '../utils/cn';
import type { ConflictType } from '../utils/mock';

interface FrictionEntry {
  conflictType: ConflictType;
  count: number;
  severity: 'blocking' | 'advisory' | 'conditional';
}

// Static advisory table — maps each conflict type to instrument + recommended decision
const ADVISORY: Record<ConflictType, {
  instrument: string;
  summary: string;
  recommendation: string;
  recommendationClass: 'green' | 'amber' | 'red';
}> = {
  MED_DOMESTIC_ONLY: {
    instrument: 'BCB Res. 493/2025',
    summary: 'Brazil\'s MED 2.0 emergency blocking is restricted to domestically-originated Pix fraud. Foreign signals cannot directly trigger a block.',
    recommendation: 'Route via COAF–Egmont channel. FIU can initiate domestic MED proceeding independently once intelligence is received.',
    recommendationClass: 'amber',
  },
  FOREIGN_INTELLIGENCE_GATEWAY: {
    instrument: 'BCB Res. 506/2025',
    summary: 'Receiving institutions cannot directly block accounts based on foreign intelligence without a domestic legal trigger.',
    recommendation: 'File a Suspicious Activity Report (SAR) with COAF. COAF can issue a domestic freeze order using the foreign signal as supporting evidence.',
    recommendationClass: 'amber',
  },
  NO_MANDATORY_ACTION: {
    instrument: 'AML Law 9613/1998 Art. 11',
    summary: 'No mandatory action threshold is met. Institution has discretion but no legal obligation to act.',
    recommendation: 'Consider voluntary SAR filing if institutional risk appetite justifies it. No automatic block is warranted.',
    recommendationClass: 'green',
  },
  TRANSFER_INSTRUMENT_GAP: {
    instrument: 'UK GDPR Art. 46 / IDTA',
    summary: 'The corridor lacks a ratified transfer instrument. The signal cannot lawfully move in its current form.',
    recommendation: 'Escalate to legal team to fast-track IDTA or SCCs for this corridor. In the interim, generalise to Tier 3 before transfer.',
    recommendationClass: 'red',
  },
  FIELD_CLASSIFICATION: {
    instrument: 'GDPR Art. 9 / FCA SYSC 6',
    summary: 'One or more fields are classified above the permitted tier for this transfer.',
    recommendation: 'Suppress or generalise the offending fields before re-emitting. If high fidelity is critical, negotiate a Tier 1 agreement with the target jurisdiction.',
    recommendationClass: 'amber',
  },
  K_ANONYMITY_FAILURE: {
    instrument: 'ICO Anonymisation Code / ANPD Guidance',
    summary: 'The signal failed k-anonymity (k<5). The remaining field combination could re-identify individuals.',
    recommendation: 'Expand the aggregation window, apply additional suppression, or escalate to Tier 3. Signal is safe to transmit at Tier 3 with no identifiers.',
    recommendationClass: 'amber',
  },
  TIPPING_OFF: {
    instrument: 'Terrorism Act 2000 s.21D / POCA 2002 s.333A',
    summary: 'Sharing this signal risks alerting the subject of an active investigation, which is a criminal offence.',
    recommendation: 'Hold signal until the investigation is at a stage where disclosure is safe. Coordinate with the NCA or equivalent before any transmission.',
    recommendationClass: 'red',
  },
};

const SEVERITY_COLORS = {
  blocking: { bar: 'bg-red-500', text: 'text-red-400', border: 'border-red-500/20', bg: 'bg-red-500/5' },
  advisory: { bar: 'bg-amber-500', text: 'text-amber-400', border: 'border-amber-500/20', bg: 'bg-amber-500/5' },
  conditional: { bar: 'bg-blue-500', text: 'text-blue-400', border: 'border-blue-500/20', bg: 'bg-blue-500/5' },
};

const REC_COLORS = {
  green: 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20',
  amber: 'text-amber-300 bg-amber-500/10 border border-amber-500/20',
  red: 'text-red-300 bg-red-500/10 border border-red-500/20',
};

function AdvisoryRow({ entry, total }: { entry: FrictionEntry; total: number }) {
  const [open, setOpen] = useState(false);
  const advice = ADVISORY[entry.conflictType];
  const colors = SEVERITY_COLORS[entry.severity];
  const pct = Math.round((entry.count / total) * 100);

  return (
    <div className={cn('border rounded-lg overflow-hidden', colors.border)}>
      <button
        onClick={() => setOpen(o => !o)}
        className={cn('w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-white/[0.02] transition-colors', colors.bg)}
      >
        {/* Severity dot */}
        <div className={cn('w-2 h-2 rounded-full shrink-0', colors.bar)} />

        {/* Conflict name */}
        <span className={cn('font-mono text-xs font-semibold flex-1', colors.text)}>
          {entry.conflictType}
        </span>

        {/* Count + bar */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-20 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className={cn('h-full rounded-full', colors.bar)} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-xs text-white/50 w-8 text-right font-mono">{entry.count}</span>
        </div>

        {/* Instrument */}
        <span className="text-[10px] text-white/30 font-mono hidden xl:block w-40 truncate shrink-0">
          {advice?.instrument ?? '—'}
        </span>

        {open
          ? <ChevronDown className="w-3 h-3 text-white/30 shrink-0" />
          : <ChevronRight className="w-3 h-3 text-white/30 shrink-0" />
        }
      </button>

      {open && advice && (
        <div className="px-4 pb-4 pt-2 space-y-3 border-t border-white/5">
          <p className="text-xs text-white/60 leading-relaxed">{advice.summary}</p>
          <div className={cn('flex items-start gap-2 rounded-lg p-3', REC_COLORS[advice.recommendationClass])}>
            <Lightbulb className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <p className="text-xs leading-relaxed">{advice.recommendation}</p>
          </div>
        </div>
      )}
    </div>
  );
}

interface RegulationAdvisoryPanelProps {
  frictionTop5: FrictionEntry[];
  total: number;
}

export default function RegulationAdvisoryPanel({ frictionTop5, total }: RegulationAdvisoryPanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (frictionTop5.length === 0) return null;

  return (
    <div className="border border-white/10 rounded-xl overflow-hidden bg-black/40 backdrop-blur-md">
      <button
        onClick={() => setCollapsed(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-white/[0.03] border-b border-white/10 hover:bg-white/[0.05] transition-colors"
      >
        <div className="flex items-center gap-2">
          <Scale className="w-4 h-4 text-purple-400" />
          <span className="text-xs font-semibold uppercase tracking-widest text-white/60">
            Regulatory Advisory — Top Blockers
          </span>
          <span className="text-[10px] bg-purple-500/15 text-purple-400 border border-purple-500/25 px-2 py-0.5 rounded-full font-semibold">
            {frictionTop5.filter(f => f.severity === 'blocking').length} blocking
          </span>
        </div>
        {collapsed
          ? <ChevronRight className="w-3 h-3 text-white/30" />
          : <ChevronDown className="w-3 h-3 text-white/30" />
        }
      </button>

      {!collapsed && (
        <div className="p-4 space-y-2">
          {frictionTop5.map((f, i) => (
            <AdvisoryRow key={i} entry={f} total={total} />
          ))}
        </div>
      )}
    </div>
  );
}
