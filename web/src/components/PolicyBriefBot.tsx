import { useState } from 'react';
import { Sparkles, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../utils/cn';
import type { Signal } from '../utils/mock';

// Simulates Workers AI (llama-3.1-8b-instruct) response.
// In production: POST /api/brief { signal } → Worker calls AI binding.
function generatePolicyBrief(signal: Signal): string {
  const verdictMap: Record<string, string> = {
    FULLY_ACTIONABLE: 'is fully actionable — all requested investigative and blocking steps are legally permissible',
    CASE_ACTIONABLE: 'is partially actionable at the case level — targeted investigation is permitted, though systemic blocking requires additional legal basis',
    SYSTEMIC_ONLY: 'is actionable for systemic intelligence only — individual account-level action is not currently permitted under the receiving jurisdiction\'s legal framework',
    INTELLIGENCE_ONLY: 'carries intelligence value only — no direct case or systemic action can be taken without escalation through diplomatic channels',
    INACTIONABLE: 'cannot be acted upon in its current form — it does not satisfy the minimum legal thresholds for the receiving jurisdiction',
  };

  const tierMap: Record<number, string> = {
    1: 'highest fidelity (Tier 1), meaning the signal retains pseudonymised identifiers sufficient for individual account tracing',
    2: 'intermediate fidelity (Tier 2), with identifiers replaced by anonymised tokens and transaction bands replacing exact amounts',
    3: 'lowest fidelity (Tier 3), fully generalised with no direct identifiers — suitable only for statistical pattern analysis',
  };

  const conflictAdvice: Record<string, string> = {
    MED_DOMESTIC_ONLY: 'The primary blocker is that Brazil\'s MED 2.0 emergency blocking mechanism is restricted to domestically-originated Pix transactions. To unlock direct blocking capability, the sending institution must route the request through the COAF–Egmont channel, which provides a formal bilateral legal basis.',
    FOREIGN_INTELLIGENCE_GATEWAY: 'Direct account blocking by the receiving institution is not permitted for foreign-origin signals under current regulations. The recommended path is to file an intelligence referral to the national FIU (COAF), who can initiate domestic proceedings independently.',
    NO_MANDATORY_ACTION: 'No mandatory action exists for this signal type in the target jurisdiction. Institutions may take voluntary protective measures, but are not legally compelled to act. Consider whether the signal meets the threshold for a voluntary SAR filing.',
    TRANSFER_INSTRUMENT_GAP: 'The transfer mechanism between these jurisdictions lacks a ratified legal basis. An IDTA or equivalent adequacy decision is required before the signal can lawfully move. This is a structural gap requiring policy intervention, not a case-by-case fix.',
    FIELD_CLASSIFICATION: 'Certain fields in this signal are classified at a higher protection level than the agreed transfer tier permits. Reclassifying the corridor to Tier 1 or obtaining explicit consent from the data subject would resolve this.',
    K_ANONYMITY_FAILURE: 'The signal failed k-anonymity checks, meaning the combination of retained fields could re-identify fewer than 5 individuals. The system automatically generalised to Tier 3. If higher fidelity is needed, the dataset must be expanded or additional suppression applied.',
    TIPPING_OFF: 'Sharing this signal risks tipping off the subject of an active investigation, which is prohibited under anti-tipping provisions. The signal should be held until the investigation reaches a stage where disclosure is safe.',
  };

  const topConflictText = signal.topConflict
    ? `\n\n**Key regulatory blocker:** ${conflictAdvice[signal.topConflict] ?? 'A regulatory constraint is preventing full actionability. Review the drop log for the specific instrument.'}`
    : '\n\n**No blocking conflicts detected.** All standard transfer and action thresholds are satisfied.';

  const actionSummary = signal.caseActions
    .filter(a => a.effectiveness !== 'UNAVAILABLE')
    .map(a => `• **${a.action.replace(/_/g, ' ')}** (${a.effectiveness.toLowerCase()})`)
    .join('\n');

  return `**Policy Briefing — Signal ${signal.id.slice(0, 8).toUpperCase()}**

This intelligence signal, received from ${signal.from} and routed to ${signal.to}, relates to a **${signal.type.replace(/_/g, ' ').toLowerCase()}** incident involving a **${signal.bandsAndCategories.paymentRail}** transaction in the **${signal.bandsAndCategories.geographicRiskBand?.toLowerCase()} risk** band.

The signal ${verdictMap[signal.verdict] ?? 'has an undetermined verdict status'}. It carries **${signal.intelligenceScore} intelligence value** and was transmitted at ${tierMap[signal.tier]}.

**What you can do right now:**
${actionSummary || '• No immediate actions are available under current legal constraints.'}
${topConflictText}

**Transfer basis:** ${signal.transferMechanism}. This instrument governs the lawful movement of the signal and defines the obligations of the receiving institution.

*This briefing was generated automatically. It does not constitute legal advice. Consult your institution's compliance officer before taking action.*`;
}

interface PolicyBriefBotProps {
  signal: Signal;
}

export default function PolicyBriefBot({ signal }: PolicyBriefBotProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<string | null>(null);

  const handleGenerate = () => {
    if (brief) { setOpen(o => !o); return; }
    setLoading(true);
    setOpen(true);
    // Simulate AI latency (Workers AI cold start ~800ms)
    setTimeout(() => {
      setBrief(generatePolicyBrief(signal));
      setLoading(false);
    }, 900 + Math.random() * 400);
  };

  // Reset when signal changes
  if (brief && !brief.includes(signal.id.slice(0, 8).toUpperCase())) {
    setBrief(null);
    setOpen(false);
  }

  return (
    <div className="border border-blue-500/20 rounded-lg overflow-hidden">
      <button
        onClick={handleGenerate}
        className="w-full flex items-center justify-between px-4 py-3 bg-blue-500/[0.06] hover:bg-blue-500/10 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-blue-400" />
          <span className="text-xs font-semibold text-blue-300 uppercase tracking-wider">AI Policy Brief</span>
          <span className="text-[10px] text-blue-400/60 bg-blue-500/10 px-1.5 py-0.5 rounded font-mono">Workers AI</span>
        </div>
        {open
          ? <ChevronDown className="w-3 h-3 text-blue-400/60" />
          : <ChevronRight className="w-3 h-3 text-blue-400/60" />
        }
      </button>

      {open && (
        <div className="p-4 bg-blue-500/[0.03] border-t border-blue-500/15">
          {loading ? (
            <div className="flex items-center gap-2 text-blue-300/60 text-xs">
              <Loader2 className="w-3 h-3 animate-spin" />
              Generating policy briefing…
            </div>
          ) : brief ? (
            <div className="text-xs text-white/70 leading-relaxed space-y-2">
              {brief.split('\n\n').map((para, i) => (
                <p key={i} className={cn(
                  para.startsWith('**Policy Briefing') ? 'text-blue-300 font-semibold text-sm' : '',
                  para.startsWith('*This briefing') ? 'text-white/30 italic' : '',
                )}>
                  {para.split(/\*\*(.*?)\*\*/g).map((chunk, j) =>
                    j % 2 === 1
                      ? <strong key={j} className="text-white/90 font-semibold">{chunk}</strong>
                      : <span key={j}>{chunk}</span>
                  )}
                </p>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
