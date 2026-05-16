import React, { useState, useCallback, useRef } from 'react';
import { Play, RotateCcw, Download, ChevronDown, ChevronRight, Plus, X } from 'lucide-react';
import { cn } from '../utils/cn';
import { Card, SectionHeader, VerdictBadge, EffectivenessBadge, ConflictTag, TierBadge, JUR_FLAGS } from './ui';
import { generateSignal } from '../utils/mock';
import type { Signal, Jurisdiction, SignalType, PaymentRail, Typology } from '../utils/mock';

const ALL_JURS: Jurisdiction[] = ['UK', 'US', 'BR'];

// ─── Node positions on SVG canvas ───────────────────────────────────────────
const NODE_POS: Record<Jurisdiction, { x: number; y: number }> = {
  UK: { x: 160, y: 160 },
  US: { x: 480, y: 260 },
  BR: { x: 320, y: 380 },
};

// ─── Animated dot along edge ─────────────────────────────────────────────────
function AnimatedDot({ from, to, active, onDone }: { from: Jurisdiction; to: Jurisdiction; active: boolean; onDone: () => void }) {
  const f = NODE_POS[from];
  const t = NODE_POS[to];
  const [progress, setProgress] = useState(0);

  React.useEffect(() => {
    if (!active) { setProgress(0); return; }
    const start = Date.now();
    const dur = 1500;
    const frame = () => {
      const p = Math.min((Date.now() - start) / dur, 1);
      setProgress(p);
      if (p < 1) requestAnimationFrame(frame);
      else onDone();
    };
    requestAnimationFrame(frame);
  }, [active]);

  if (!active && progress === 0) return null;
  const cx = f.x + (t.x - f.x) * progress;
  const cy = f.y + (t.y - f.y) * progress;
  return (
    <circle cx={cx} cy={cy} r={6} fill="#60a5fa" filter="url(#glow)">
      <animate attributeName="r" values="5;8;5" dur="0.6s" repeatCount="indefinite" />
    </circle>
  );
}

// ─── Map Canvas ──────────────────────────────────────────────────────────────
function MapCanvas({
  source, targets, availableToAdd, verdicts, animating, onAnimDone, onAddTarget, onRemoveTarget,
}: {
  source: Jurisdiction; targets: Jurisdiction[]; availableToAdd: Jurisdiction[];
  verdicts: Record<string, Signal | null>; animating: boolean;
  onAnimDone: (t: Jurisdiction) => void; onAddTarget: (j: Jurisdiction) => void; onRemoveTarget: (j: Jurisdiction) => void;
}) {
  const RING_COLOR = (j: Jurisdiction) => {
    const v = verdicts[j];
    if (!v) return '#334155';
    if (v.verdict === 'FULLY_ACTIONABLE' || v.verdict === 'CASE_ACTIONABLE') return '#22c55e';
    if (v.verdict === 'INACTIONABLE') return '#ef4444';
    return '#f59e0b';
  };

  return (
    <div className="relative h-full w-full">
      <svg viewBox="0 80 640 360" className="absolute inset-0 w-full h-full">
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L6,3 z" fill="rgba(255,255,255,0.2)" />
          </marker>
        </defs>

        {/* Source node */}
        <circle cx={NODE_POS[source].x} cy={NODE_POS[source].y} r={44} fill="#0f172a" stroke="#3b82f6" strokeWidth={3}
          filter="url(#glow)" />
        <text x={NODE_POS[source].x} y={NODE_POS[source].y + 5} textAnchor="middle" fill="white" fontSize="13" fontWeight="bold">{source}</text>
        <text x={NODE_POS[source].x} y={NODE_POS[source].y + 62} textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="10">SOURCE</text>

        {/* Edges + target nodes */}
        {targets.map(t => (
          <g key={t}>
            <line
              x1={NODE_POS[source].x} y1={NODE_POS[source].y}
              x2={NODE_POS[t].x} y2={NODE_POS[t].y}
              stroke="rgba(255,255,255,0.1)" strokeWidth={2} strokeDasharray="6 4"
              markerEnd="url(#arrow)"
            />
            <circle cx={NODE_POS[t].x} cy={NODE_POS[t].y} r={44} fill="#0f172a" stroke={RING_COLOR(t)} strokeWidth={3}
              filter="url(#glow)" />
            <text x={NODE_POS[t].x} y={NODE_POS[t].y + 5} textAnchor="middle" fill="white" fontSize="13" fontWeight="bold">{t}</text>
            <text x={NODE_POS[t].x} y={NODE_POS[t].y - 58} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="10">
              {verdicts[t]?.verdict?.replace(/_/g, ' ') ?? 'PENDING'}
            </text>
            <AnimatedDot from={source} to={t} active={animating} onDone={() => onAnimDone(t)} />
          </g>
        ))}
      </svg>

      {/* Add/Remove buttons overlaid */}
      <div className="absolute bottom-4 left-4 flex gap-2">
        {availableToAdd.map(j => (
          <button key={j} onClick={() => onAddTarget(j)}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs hover:bg-white/10 transition-colors">
            <Plus className="w-3 h-3" />{JUR_FLAGS[j]} {j}
          </button>
        ))}
      </div>
      <div className="absolute top-4 right-4 flex gap-2">
        {targets.map(j => (
          <button key={j} onClick={() => onRemoveTarget(j)}
            className="flex items-center gap-1 px-2 py-1 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 hover:bg-red-500/20 transition-colors">
            <X className="w-3 h-3" />{j}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Evolution Step ──────────────────────────────────────────────────────────
function EvoStep({ n, title, active, children }: { n: number; title: string; active: boolean; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  React.useEffect(() => { if (active) setOpen(true); }, [active]);
  return (
    <div className={cn('border border-white/10 rounded-lg overflow-hidden transition-opacity', active ? 'opacity-100' : 'opacity-30')}>
      <button
        disabled={!active}
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 bg-white/[0.03] hover:bg-white/[0.05] transition-colors text-left"
      >
        <div className={cn('w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0', active ? 'bg-blue-500 text-white' : 'bg-white/10 text-white/30')}>
          {n}
        </div>
        <span className="flex-1 text-sm font-medium">{title}</span>
        {active && (open ? <ChevronDown className="w-4 h-4 text-white/40" /> : <ChevronRight className="w-4 h-4 text-white/40" />)}
      </button>
      {open && children && <div className="p-4">{children}</div>}
    </div>
  );
}

// ─── Verdict Mini-Card per target ─────────────────────────────────────────────
function TargetVerdict({ jur, signal }: { jur: Jurisdiction; signal: Signal }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">{JUR_FLAGS[jur]}</span>
        <span className="font-bold">{jur}</span>
        <VerdictBadge verdict={signal.verdict} />
        <TierBadge tier={signal.tier} />
        <span className={cn('text-xs ml-auto', signal.intelligenceScore === 'HIGH' ? 'text-emerald-400' : signal.intelligenceScore === 'MEDIUM' ? 'text-amber-400' : 'text-white/50')}>
          {signal.intelligenceScore} intel
        </span>
      </div>
      <div className="space-y-1">
        {[...signal.caseActions, ...signal.systemicActions].map((a, i) => (
          <div key={i} className="flex items-center justify-between py-1 border-b border-white/5 last:border-0">
            <span className="font-mono text-xs text-white/60">{a.action}</span>
            <EffectivenessBadge e={a.effectiveness} />
          </div>
        ))}
      </div>
      {signal.dropLog.length > 0 && (
        <div className="space-y-1">
          {signal.dropLog.map((d, i) => (
            <div key={i} className="flex gap-2 items-start">
              <ConflictTag c={d.conflictType} />
              <span className="text-[10px] text-white/40 flex-1">{d.rule.slice(0, 80)}…</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Simulator ──────────────────────────────────────────────────────────
export default function Simulator() {
  const [source, setSource] = useState<Jurisdiction>('UK');
  const [targets, setTargets] = useState<Jurisdiction[]>(['BR']);
  const [signalType, setSignalType] = useState<SignalType>('APP_FRAUD');
  const [amount, setAmount] = useState('0-1k');
  const [rail, setRail] = useState<PaymentRail>('FPS');
  const [typology, setTypology] = useState<Typology>('IMPERSONATION');
  const [riskBand, setRiskBand] = useState('HIGH');
  const [step, setStep] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [verdicts, setVerdicts] = useState<Record<string, Signal | null>>({});
  const [emittedSignal, setEmittedSignal] = useState<Signal | null>(null);
  const arrivedRef = useRef<Set<Jurisdiction>>(new Set());

  const availableToAdd = ALL_JURS.filter(j => j !== source && !targets.includes(j));

  const handleEmit = useCallback(() => {
    const signal = generateSignal({ type: signalType, rail, typology, riskBand, from: source });
    setEmittedSignal(signal);
    setStep(1);
    setAnimating(false);
    arrivedRef.current = new Set();
    setVerdicts(Object.fromEntries(targets.map(t => [t, null])));

    setTimeout(() => setStep(2), 600);
    setTimeout(() => { setStep(3); setAnimating(true); }, 1200);
  }, [signalType, rail, typology, riskBand, source, targets]);

  const handleDotArrived = useCallback((t: Jurisdiction) => {
    arrivedRef.current.add(t);
    const verdict = generateSignal({ type: signalType, from: source });
    setVerdicts(v => ({ ...v, [t]: verdict }));
    if (arrivedRef.current.size === targets.length) {
      setAnimating(false);
      setStep(4);
    }
  }, [targets.length, signalType, source]);

  const handleReset = () => {
    setStep(0); setAnimating(false); arrivedRef.current = new Set();
    setVerdicts({}); setEmittedSignal(null);
  };

  const handleExport = () => {
    if (!emittedSignal) return;
    const blob = new Blob([JSON.stringify(emittedSignal, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `signal-${emittedSignal.id.slice(0, 8)}.json`; a.click();
  };

  return (
    <div className="flex flex-col gap-4" style={{ height: 'calc(100vh - 120px)' }}>
      {/* Top: Canvas + Evolution */}
      <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">

        {/* Map Canvas */}
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_rgba(59,130,246,0.05)_0%,_transparent_70%)]" />
          <SectionHeader>Map Canvas — Signal Flow</SectionHeader>
          <div className="relative" style={{ height: 'calc(100% - 36px)' }}>
            <MapCanvas
              source={source}
              targets={targets}
              availableToAdd={availableToAdd}
              verdicts={verdicts}
              animating={animating}
              onAnimDone={handleDotArrived}
              onAddTarget={j => setTargets(t => [...t, j])}
              onRemoveTarget={j => setTargets(t => t.filter(x => x !== j))}
            />
          </div>
        </Card>

        {/* Signal Evolution Panel */}
        <Card className="flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-white/[0.03] shrink-0">
            <span className="text-xs font-semibold uppercase tracking-widest text-white/50">Signal Evolution</span>
            <div className="flex gap-2">
              <button onClick={handleExport} disabled={!emittedSignal} className="flex items-center gap-1 text-xs text-white/40 hover:text-white disabled:opacity-30 transition-colors">
                <Download className="w-3 h-3" /> Export JSON
              </button>
              <button onClick={handleReset} className="flex items-center gap-1 text-xs text-white/40 hover:text-white transition-colors">
                <RotateCcw className="w-3 h-3" /> Reset
              </button>
            </div>
          </div>
          <div className="overflow-y-auto flex-1 p-4 space-y-3">
            <EvoStep n={1} title="Raw Event" active={step >= 1}>
              {emittedSignal && (
                <div className="space-y-1 text-xs font-mono text-white/60">
                  <div><span className="text-white/30">type: </span><span className="text-red-400">{emittedSignal.type}</span></div>
                  <div><span className="text-white/30">rail: </span><span className="text-red-400">{emittedSignal.bandsAndCategories.paymentRail}</span></div>
                  <div><span className="text-white/30">typology: </span><span className="text-red-400">{emittedSignal.bandsAndCategories.fraudTypologyCode}</span></div>
                  <div><span className="text-white/30">riskBand: </span><span className="text-red-400">{emittedSignal.bandsAndCategories.geographicRiskBand}</span></div>
                  <div><span className="text-white/30">accountNumber: </span><span className="text-red-400">[RAW]</span></div>
                </div>
              )}
            </EvoStep>

            <EvoStep n={2} title="Tier Resolution" active={step >= 2}>
              {emittedSignal && (
                <div className="space-y-2">
                  <TierBadge tier={emittedSignal.tier} />
                  <p className="text-xs text-white/60">{emittedSignal.tierRationale}</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {targets.map(t => (
                      <div key={t} className="bg-white/[0.03] rounded p-2">
                        <div className="text-white/40">{JUR_FLAGS[t]} {t}</div>
                        <div className="text-emerald-400 text-[10px] mt-1">{emittedSignal.transferMechanism}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </EvoStep>

            <EvoStep n={3} title="Anonymised Signal Envelope" active={step >= 3}>
              {emittedSignal && (
                <div className="space-y-2 text-xs">
                  <p className="text-white/40 mb-2">Field transformation diff:</p>
                  {Object.entries(emittedSignal.identifierFields).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="text-white/30 w-28 shrink-0">{k}</span>
                      <span className="line-through text-red-400/60 font-mono">[ORIG]</span>
                      <span className="text-emerald-400 font-mono truncate">{v.slice(0, 12)}…</span>
                    </div>
                  ))}
                  {Object.entries(emittedSignal.bandsAndCategories).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <span className="text-white/30 w-28 shrink-0">{k}</span>
                      <span className="line-through text-red-400/60 font-mono">[ORIG]</span>
                      <span className="bg-amber-500/20 text-amber-300 px-1.5 rounded font-mono text-[10px]">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </EvoStep>

            {targets.map((t, i) => (
              <EvoStep key={t} n={4 + i} title={`Actionability — ${JUR_FLAGS[t]} ${t}`} active={step >= 4 && !!verdicts[t]}>
                {verdicts[t] && <TargetVerdict jur={t} signal={verdicts[t]!} />}
              </EvoStep>
            ))}
          </div>
        </Card>
      </div>

      {/* Bottom: Transaction Composer */}
      <Card className="shrink-0">
        <div className="p-4 flex flex-wrap items-end gap-4">
          {/* Source selector */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">Source</label>
            <div className="flex gap-1">
              {ALL_JURS.map(j => (
                <button key={j} onClick={() => setSource(j)}
                  className={cn('px-3 py-1.5 rounded-lg text-sm font-medium transition-colors', source === j ? 'bg-blue-500 text-white' : 'bg-white/5 text-white/50 hover:bg-white/10')}>
                  {JUR_FLAGS[j]} {j}
                </button>
              ))}
            </div>
          </div>

          <ComposerSelect label="Signal Type" value={signalType} onChange={v => setSignalType(v as SignalType)}
            options={['APP_FRAUD', 'UNAUTH_TRANSACTION', 'MULE_ACCOUNT_INDICATOR']} />
          <ComposerSegment label="Amount" value={amount} onChange={setAmount} options={['0-1k', '1k-10k', '10k-50k', '50k+']} />
          <ComposerSelect label="Payment Rail" value={rail} onChange={v => setRail(v as PaymentRail)}
            options={['FPS', 'CHAPS', 'ACH', 'WIRE', 'PIX']} />
          <ComposerSelect label="Typology" value={typology} onChange={v => setTypology(v as Typology)}
            options={['IMPERSONATION', 'INVESTMENT_SCAM', 'ROMANCE_SCAM', 'INVOICE_FRAUD']} />
          <ComposerSegment label="Risk Band" value={riskBand} onChange={setRiskBand} options={['LOW', 'MEDIUM', 'HIGH']} />

          <button
            onClick={handleEmit}
            disabled={animating}
            className="ml-auto h-10 px-8 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-lg flex items-center gap-2 transition-colors shadow-[0_0_20px_rgba(59,130,246,0.4)] text-sm"
          >
            <Play className="w-4 h-4" /> EMIT SIGNAL
          </button>
        </div>
      </Card>
    </div>
  );
}

function ComposerSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500/50">
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function ComposerSegment({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-widest text-white/40 mb-1.5">{label}</label>
      <div className="flex rounded-lg overflow-hidden border border-white/10">
        {options.map(o => (
          <button key={o} onClick={() => onChange(o)}
            className={cn('px-3 py-1.5 text-xs font-medium transition-colors', value === o ? 'bg-blue-500/30 text-blue-300' : 'bg-white/5 text-white/40 hover:bg-white/10')}>
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}
