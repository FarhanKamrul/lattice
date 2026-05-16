import React from 'react';
import { cn } from '../utils/cn';
import type { Verdict, Effectiveness, ConflictType } from '../utils/mock';

export const VERDICT_STYLES: Record<Verdict, string> = {
  FULLY_ACTIONABLE:   'bg-[#437a22]/20 text-[#6dbd33] border border-[#437a22]/40',
  CASE_ACTIONABLE:    'bg-teal-500/20 text-teal-300 border border-teal-500/30',
  SYSTEMIC_ONLY:      'bg-[#d19900]/20 text-[#f5c300] border border-[#d19900]/40',
  INTELLIGENCE_ONLY:  'bg-[#006494]/20 text-[#38b6ff] border border-[#006494]/40',
  INACTIONABLE:       'bg-[#a12c7b]/20 text-[#e05cbb] border border-[#a12c7b]/40',
};

export const EFFECTIVENESS_STYLES: Record<Effectiveness, string> = {
  MANDATORY:   'bg-[#437a22]/20 text-[#6dbd33] border border-[#437a22]/40',
  CONDITIONAL: 'bg-[#d19900]/20 text-[#f5c300] border border-[#d19900]/40',
  ADVISORY:    'bg-[#006494]/20 text-[#38b6ff] border border-[#006494]/40',
  UNAVAILABLE: 'bg-[#a12c7b]/20 text-[#e05cbb] border border-[#a12c7b]/40',
};

export const CONFLICT_STYLES: Record<ConflictType, string> = {
  MED_DOMESTIC_ONLY:          'bg-red-500/15 text-red-400 border border-red-500/25',
  FOREIGN_INTELLIGENCE_GATEWAY:'bg-red-500/15 text-red-400 border border-red-500/25',
  TRANSFER_INSTRUMENT_GAP:    'bg-red-500/15 text-red-400 border border-red-500/25',
  NO_MANDATORY_ACTION:        'bg-amber-500/15 text-amber-400 border border-amber-500/25',
  TIPPING_OFF:                'bg-orange-500/15 text-orange-400 border border-orange-500/25',
  FIELD_CLASSIFICATION:       'bg-white/10 text-white/60 border border-white/10',
  K_ANONYMITY_FAILURE:        'bg-purple-500/15 text-purple-400 border border-purple-500/25',
};

export const HEALTH_STYLES = {
  GREEN: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
  AMBER: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  RED:   'bg-red-500/20 text-red-400 border border-red-500/30',
};

export const JUR_FLAGS: Record<string, string> = { UK: '🇬🇧', US: '🇺🇸', BR: '🇧🇷' };

export const VerdictBadge = ({ verdict }: { verdict: Verdict }) => (
  <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap', VERDICT_STYLES[verdict])}>
    {verdict.replace(/_/g, ' ')}
  </span>
);

export const EffectivenessBadge = ({ e }: { e: Effectiveness }) => (
  <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', EFFECTIVENESS_STYLES[e])}>{e}</span>
);

export const ConflictTag = ({ c }: { c: ConflictType }) => (
  <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold', CONFLICT_STYLES[c])}>{c}</span>
);

export const TierBadge = ({ tier }: { tier: 1 | 2 | 3 }) => (
  <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-white/10 text-white/70 border border-white/10">T{tier}</span>
);

export const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('bg-black/40 border border-white/10 rounded-xl overflow-hidden backdrop-blur-md', className)}>
    {children}
  </div>
);

export const SectionHeader = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn('px-4 py-3 border-b border-white/10 bg-white/[0.03] text-xs font-semibold uppercase tracking-widest text-white/50', className)}>
    {children}
  </div>
);
