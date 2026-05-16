import { useState, useEffect, useRef } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import { cn } from '../utils/cn';
import {
  Card, SectionHeader, VerdictBadge, EffectivenessBadge, ConflictTag, TierBadge,
  HEALTH_STYLES, JUR_FLAGS,
} from './ui';
import { generateSignal, generateReport, formatAge } from '../utils/mock';
import type { Signal, ConflictType } from '../utils/mock';

// ─── KPI Rail ───────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, flag }: { label: string; value: string | number; sub?: string; flag?: boolean }) {
  return (
    <div className={cn('p-3 rounded-lg border', flag ? 'bg-red-500/10 border-red-500/20' : 'bg-white/[0.03] border-white/10')}>
      <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">{label}</div>
      <div className={cn('text-2xl font-bold tabular-nums', flag ? 'text-red-400' : 'text-white')}>{value}</div>
      {sub && <div className="text-xs text-white/50 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Action Rows (verdict detail) ───────────────────────────────────────────
function ActionRowItem({ action }: { action: { action: string; effectiveness: any; drop?: any } }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-white/5 last:border-0">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-white/[0.02] transition-colors text-left"
      >
        <span className="font-mono text-xs text-white/80">{action.action}</span>
        <div className="flex items-center gap-2">
          <EffectivenessBadge e={action.effectiveness} />
          {action.drop && (
            open ? <ChevronDown className="w-3 h-3 text-white/30" /> : <ChevronRight className="w-3 h-3 text-white/30" />
          )}
        </div>
      </button>
      {open && action.drop && (
        <div className="px-4 pb-3">
          <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg p-3 space-y-1.5">
            <div className="flex gap-2 flex-wrap">
              <ConflictTag c={action.drop.conflictType} />
              <span className="text-[10px] text-white/40 font-mono">{action.drop.instrument}</span>
            </div>
            <p className="text-xs text-white/60 leading-relaxed">{action.drop.rule}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Verdict Detail Panel ────────────────────────────────────────────────────
function VerdictPanel({ signal, onClose }: { signal: Signal; onClose: () => void }) {
  const [diffOpen, setDiffOpen] = useState(false);
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/[0.03] shrink-0">
        <div className="flex items-center gap-2">
          <VerdictBadge verdict={signal.verdict} />
          <TierBadge tier={signal.tier} />
        </div>
        <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="overflow-y-auto flex-1 space-y-4 p-4">
        {/* Metadata strip */}
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-white/40 mb-0.5">Signal ID</div>
            <div className="font-mono text-white/70">{signal.id.slice(0, 16)}…</div>
          </div>
          <div>
            <div className="text-white/40 mb-0.5">Route</div>
            <div>{JUR_FLAGS[signal.from]} {signal.from} → {JUR_FLAGS[signal.to]} {signal.to}</div>
          </div>
          <div>
            <div className="text-white/40 mb-0.5">Transfer</div>
            <div className="text-emerald-400">{signal.transferMechanism}</div>
          </div>
          <div>
            <div className="text-white/40 mb-0.5">Intelligence</div>
            <div className={signal.intelligenceScore === 'HIGH' ? 'text-emerald-400' : signal.intelligenceScore === 'MEDIUM' ? 'text-amber-400' : 'text-white/60'}>
              {signal.intelligenceScore}
            </div>
          </div>
        </div>

        {/* Tier rationale */}
        <div className="bg-white/[0.03] border border-white/10 rounded-lg p-3">
          <div className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Tier Rationale</div>
          <p className="text-xs text-white/70">{signal.tierRationale}</p>
        </div>

        {/* Before/After diff */}
        <div className="border border-white/10 rounded-lg overflow-hidden">
          <button
            className="w-full flex items-center justify-between px-4 py-2.5 bg-white/[0.03] text-xs font-semibold uppercase tracking-widest text-white/50 hover:bg-white/[0.05] transition-colors"
            onClick={() => setDiffOpen(o => !o)}
          >
            Field Transformation Diff
            {diffOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
          {diffOpen && (
            <div className="p-3 space-y-2 text-xs">
              {Object.entries(signal.identifierFields).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-white/40 w-32 shrink-0">{k}</span>
                  <span className="line-through text-red-400/60 font-mono truncate w-20 shrink-0">[ORIGINAL]</span>
                  <span className="text-emerald-400 font-mono truncate">{v.slice(0, 12)}…</span>
                </div>
              ))}
              {Object.entries(signal.bandsAndCategories).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-white/40 w-32 shrink-0">{k}</span>
                  <span className="line-through text-red-400/60 font-mono truncate w-20 shrink-0">[ORIGINAL]</span>
                  <span className="bg-amber-500/20 text-amber-300 px-1.5 rounded font-mono text-[10px]">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Case actions */}
        <div className="border border-white/10 rounded-lg overflow-hidden">
          <SectionHeader>Case-Level Actions</SectionHeader>
          {signal.caseActions.map((a, i) => <ActionRowItem key={i} action={a} />)}
        </div>

        {/* Systemic actions */}
        <div className="border border-white/10 rounded-lg overflow-hidden">
          <SectionHeader>Systemic Actions</SectionHeader>
          {signal.systemicActions.map((a, i) => <ActionRowItem key={i} action={a} />)}
        </div>

        {/* Drop log */}
        {signal.dropLog.length > 0 && (
          <div className="border border-red-500/20 rounded-lg overflow-hidden">
            <SectionHeader className="text-red-400/70 border-red-500/20 bg-red-500/[0.05]">Regulatory Drop Log</SectionHeader>
            <div className="p-3 space-y-3">
              {signal.dropLog.map((d, i) => (
                <div key={i} className="bg-red-500/5 border border-red-500/10 rounded-lg p-3">
                  <div className="flex gap-2 flex-wrap mb-1">
                    <ConflictTag c={d.conflictType} />
                    <span className="text-[10px] text-white/40 font-mono">{d.instrument}</span>
                  </div>
                  <p className="text-xs text-white/60">{d.rule}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Sparkline ───────────────────────────────────────────────────────────────
function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${100 - ((v - min) / range) * 100}`).join(' ');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-16 h-6">
      <polyline points={pts} fill="none" stroke="rgba(96,165,250,0.7)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Bottom Strip ─────────────────────────────────────────────────────────────
function BottomStrip({ report, onConflictFilter }: { report: ReturnType<typeof generateReport>; onConflictFilter: (c: ConflictType | null) => void }) {
  const verdicts = Object.entries(report.verdictBreakdown) as [string, number][];
  const total = report.totalSignals || 1;

  const DONUT_COLORS: Record<string, string> = {
    FULLY_ACTIONABLE: '#437a22', CASE_ACTIONABLE: '#0d9488',
    SYSTEMIC_ONLY: '#d19900', INTELLIGENCE_ONLY: '#006494', INACTIONABLE: '#a12c7b',
  };

  return (
    <div className="grid grid-cols-3 gap-4 mt-4 shrink-0">
      {/* Tile 1: Utility donut */}
      <Card>
        <SectionHeader>Signal Utility Index</SectionHeader>
        <div className="p-4 flex flex-col gap-2">
          {verdicts.map(([v, count]) => (
            <div key={v} className="flex items-center gap-2 text-xs">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: DONUT_COLORS[v] }} />
              <span className="text-white/60 flex-1 truncate">{v.replace(/_/g, ' ')}</span>
              <span className="font-mono text-white/80">{count}</span>
              <span className="text-white/40 w-10 text-right">{Math.round((count / total) * 100)}%</span>
            </div>
          ))}
          <div className="border-t border-white/10 pt-2 mt-1 flex justify-between text-xs">
            <span className="text-white/40">Case utility</span>
            <span className={cn('font-bold', (report.caseActionable / total) < 0.2 ? 'text-red-400' : 'text-emerald-400')}>
              {Math.round((report.caseActionable / total) * 100)}%
              {(report.caseActionable / total) < 0.2 && ' ⚠'}
            </span>
          </div>
        </div>
      </Card>

      {/* Tile 2: Friction heatmap */}
      <Card>
        <SectionHeader>Regulatory Friction</SectionHeader>
        <div className="p-4 space-y-2">
          {report.frictionTop5.map((f, i) => {
            const pct = Math.round((f.count / total) * 100);
            const barColor = f.severity === 'blocking' ? 'bg-red-500' : f.severity === 'advisory' ? 'bg-amber-500' : 'bg-blue-500';
            return (
              <button key={i} onClick={() => onConflictFilter(f.conflictType)} className="w-full group text-left">
                <div className="flex justify-between text-[10px] text-white/50 mb-0.5">
                  <span className="truncate font-mono group-hover:text-white transition-colors">{f.conflictType}</span>
                  <span>{f.count}</span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
                </div>
              </button>
            );
          })}
        </div>
      </Card>

      {/* Tile 3: Typology trends */}
      <Card>
        <SectionHeader>Typology Trend Index</SectionHeader>
        <div className="p-4 space-y-2.5">
          {report.typologyTrends.map((t, i) => {
            const isSpike = t.wow > 30;
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="text-[10px] font-mono text-white/50 flex-1 truncate">{t.key.split('|')[0]}</span>
                <Sparkline data={t.spark} />
                <span className="text-xs font-mono text-white/70 w-6 text-right">{t.current}</span>
                <span className={cn('text-[10px] font-bold px-1 rounded', isSpike ? 'text-amber-400 ring-1 ring-amber-400/50 animate-pulse' : t.wow >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                  {t.wow > 0 ? '+' : ''}{t.wow}%
                </span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────
const SIGNAL_TYPES_FILTER = ['ALL', 'APP_FRAUD', 'UNAUTH_TRANSACTION', 'MULE_ACCOUNT_INDICATOR'];
const FROM_FILTER = ['ALL', 'UK', 'US', 'BR'];
const VERDICT_FILTER = ['ALL', 'CASE_ACTIONABLE', 'SYSTEMIC_ONLY', 'INTELLIGENCE_ONLY', 'INACTIONABLE'];

const INITIAL_SIGNALS = Array.from({ length: 30 }, (_, i) =>
  ({ ...generateSignal(), age: i * 120000 })
);

export default function Dashboard() {
  const [signals, setSignals] = useState<Signal[]>(INITIAL_SIGNALS);
  const [selected, setSelected] = useState<Signal | null>(null);
  const [fromFilter, setFromFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [verdictFilter, setVerdictFilter] = useState('ALL');
  const [conflictFilter, setConflictFilter] = useState<ConflictType | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const report = generateReport(signals);

  // Live feed: new signal every 4s
  useEffect(() => {
    const id = setInterval(() => {
      setSignals(prev => [{ ...generateSignal(), age: 0 }, ...prev.slice(0, 199)]);
    }, 4000);
    return () => clearInterval(id);
  }, []);

  // Age ticker
  useEffect(() => {
    const id = setInterval(() => {
      setSignals(prev => prev.map(s => ({ ...s, age: s.age + 4000 })));
    }, 4000);
    return () => clearInterval(id);
  }, []);

  const filtered = signals.filter(s => {
    if (fromFilter !== 'ALL' && s.from !== fromFilter) return false;
    if (typeFilter !== 'ALL' && s.type !== typeFilter) return false;
    if (verdictFilter !== 'ALL' && s.verdict !== verdictFilter) return false;
    if (conflictFilter && s.topConflict !== conflictFilter) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-4" style={{ height: 'calc(100vh - 120px)' }}>
      {/* Header KPI strip */}
      <div className="flex items-center gap-3 shrink-0">
        <div className={cn('px-3 py-1 rounded-full text-xs font-bold border', HEALTH_STYLES[report.healthScore])}>
          {report.healthScore}
        </div>
        <span className="text-white/40 text-xs">{report.healthRationale}</span>
        <div className="ml-auto text-xs text-white/30 font-mono">{new Date().toUTCString()}</div>
      </div>

      {/* Three-column layout */}
      <div className="flex-1 grid grid-cols-[200px_1fr_360px] gap-4 min-h-0">

        {/* LEFT RAIL */}
        <div className="flex flex-col gap-3 overflow-y-auto">
          <KpiCard label="Signals (30d)" value={report.totalSignals} sub="↑ 12% DoD" />
          <KpiCard
            label="Case-level actionable"
            value={`${report.caseActionable} (${Math.round((report.caseActionable / (report.totalSignals || 1)) * 100)}%)`}
            flag={(report.caseActionable / (report.totalSignals || 1)) < 0.2}
          />
          <KpiCard label="Systemic actionable" value={`${report.systemicActionable} (${Math.round((report.systemicActionable / (report.totalSignals || 1)) * 100)}%)`} />
          <KpiCard label="Typology alerts" value={report.typologyAlerts} sub="SPIKE direction" flag={report.typologyAlerts > 0} />
          <div className={cn('p-3 rounded-lg border', HEALTH_STYLES[report.healthScore])}>
            <div className="text-[10px] uppercase tracking-widest mb-1 opacity-70">Platform Health</div>
            <div className="text-xl font-bold">{report.healthScore}</div>
            <div className="text-[10px] mt-1 opacity-70">{report.healthRationale}</div>
          </div>
          {conflictFilter && (
            <button
              onClick={() => setConflictFilter(null)}
              className="text-xs text-red-400 border border-red-500/20 rounded-lg px-3 py-2 hover:bg-red-500/10 transition-colors"
            >
              ✕ Clear filter: {conflictFilter}
            </button>
          )}
        </div>

        {/* CENTRE: Signal Feed */}
        <Card className="flex flex-col min-h-0">
          {/* Filters */}
          <div className="p-3 border-b border-white/10 flex flex-wrap gap-2 shrink-0">
            <FilterGroup label="From" options={FROM_FILTER} value={fromFilter} onChange={setFromFilter} />
            <FilterGroup label="Type" options={SIGNAL_TYPES_FILTER} value={typeFilter} onChange={setTypeFilter} />
            <FilterGroup label="Verdict" options={VERDICT_FILTER} value={verdictFilter} onChange={setVerdictFilter} />
          </div>
          {/* Table header */}
          <div className="grid grid-cols-[80px_50px_130px_140px_40px_120px_60px] gap-2 px-4 py-2 text-[10px] uppercase tracking-widest text-white/30 border-b border-white/5 shrink-0">
            <span>ID</span><span>From</span><span>Type</span><span>Verdict</span><span>Tier</span><span>Conflict</span><span>Age</span>
          </div>
          {/* Feed rows */}
          <div ref={feedRef} className="overflow-y-auto flex-1">
            {filtered.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setSelected(s)}
                className={cn(
                  'w-full grid grid-cols-[80px_50px_130px_140px_40px_120px_60px] gap-2 px-4 py-2.5 text-left border-b border-white/5 hover:bg-white/[0.04] transition-colors text-xs items-center',
                  selected?.id === s.id ? 'bg-blue-500/10 border-l-2 border-l-blue-500' : '',
                  i === 0 ? 'animate-[slideIn_0.3s_ease-out]' : ''
                )}
              >
                <span className="font-mono text-white/40">{s.id.slice(0, 8)}</span>
                <span>{JUR_FLAGS[s.from]} {s.from}</span>
                <span className="truncate text-white/70">{s.type}</span>
                <span><VerdictBadge verdict={s.verdict} /></span>
                <span className="font-bold text-white/40">T{s.tier}</span>
                <span className="truncate">{s.topConflict ? <span className="text-red-400/80 font-mono text-[10px] truncate">{s.topConflict}</span> : <span className="text-emerald-400/60 text-[10px]">—</span>}</span>
                <span className="text-white/30">{formatAge(s.age)}</span>
              </button>
            ))}
          </div>
        </Card>

        {/* RIGHT: Verdict Detail */}
        <Card className="flex flex-col min-h-0">
          {selected
            ? <VerdictPanel signal={selected} onClose={() => setSelected(null)} />
            : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-white/30">
                <div className="text-4xl mb-3">↖</div>
                <p className="text-sm">Select a signal to view the full verdict</p>
              </div>
            )
          }
        </Card>
      </div>

      {/* BOTTOM STRIP */}
      <BottomStrip report={report} onConflictFilter={setConflictFilter} />

      <style>{`
        @keyframes slideIn { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>
  );
}

function FilterGroup({ label, options, value, onChange }: { label: string; options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-white/30 uppercase mr-1">{label}:</span>
      {options.map(o => (
        <button
          key={o}
          onClick={() => onChange(o)}
          className={cn('text-[10px] px-2 py-0.5 rounded font-medium transition-colors', value === o ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'text-white/40 hover:text-white')}
        >
          {o === 'ALL' ? 'All' : o}
        </button>
      ))}
    </div>
  );
}
