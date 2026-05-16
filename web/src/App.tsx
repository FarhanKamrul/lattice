import React from 'react';
import { Shield, Activity, Globe, AlertTriangle, CheckCircle2, XCircle, ArrowRight, Database } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// -----------------------------------
// Mock Data (matches backend output)
// -----------------------------------
const mockSignal = {
  signalId: "c35e335c-7f50-4a89-9e02-42ba8b3cf8ea",
  publishingJurisdiction: "UK",
  targetJurisdictions: ["BR"],
  signalType: "APP_FRAUD",
  anonymisationTier: 2,
  tierRationale: "Tier 2 — Random token vault + k-anonymity (k≥5). Lighter transfer obligations.",
  payload: {
    identifierFields: {
      accountNumber: "be3ff787-222d-4107-b252-5d82ba19e4fc",
      sortCode: "0a8d93db-823d-46dc-8ed2-3b5eccfb8b11",
      deviceFingerprint: "904945da-db5c-4808-8c41-f4e67ab31cc1"
    },
    bandsAndCategories: {
      transactionAmountBand: "0-50000",
      paymentRail: "FPS",
      fraudTypologyCode: "IMPERSONATION",
      geographicRiskBand: "HIGH"
    }
  },
  kAnonymity: { required: 5, enforced: true, passed: true },
  transferMechanisms: { BR: "IDTA + ANPD SCC" }
};

const mockVerdict = {
  overallVerdict: "FULLY_ACTIONABLE",
  verdictRationale: "All required fields present. Legal basis confirmed. Both case-level and systemic actions available.",
  intelligenceValue: {
    score: "HIGH",
    drivers: ["fraudTypologyCode present", "geographicRiskBand present", "paymentRail present"]
  },
  caseActions: [
    { action: "file_SAR_to_COAF", technicallyPossible: true, legallyPermitted: true, effectivelyActionable: true, effectiveActionability: "conditional", instrument: "COAF_RES_36_2021 + AML_LAW_9613_1998" },
    { action: "act_on_foreign_intelligence", technicallyPossible: true, legallyPermitted: "conditional", effectivelyActionable: true, effectiveActionability: "advisory", instrument: "AML_LAW_9613_1998 Art.15 + COAF Egmont" },
    { action: "block_account", technicallyPossible: false, legallyPermitted: "conditional", effectivelyActionable: false, effectiveActionability: "unavailable", blockingRule: "FOREIGN_INTELLIGENCE_GATEWAY", instrument: "BCB_RES_506_2025" }
  ],
  systemicActions: [
    { action: "typology_alert", technicallyPossible: true, legallyPermitted: true, effectivelyActionable: true, effectiveActionability: "conditional", instrument: "COAF_RES_36_2021" },
    { action: "update_fraud_model", technicallyPossible: true, legallyPermitted: true, effectivelyActionable: true, effectiveActionability: "conditional", instrument: "BCB_RES_506_2025" }
  ],
  regulatoryDropLog: [
    { action: "med_trigger", conflictType: "MED_DOMESTIC_ONLY", instrument: "BCB_RES_493_2025", rule: "DOMESTIC PIX ONLY. Foreign-origin signals have no direct MED pathway." },
    { action: "block_account", conflictType: "FOREIGN_INTELLIGENCE_GATEWAY", instrument: "BCB_RES_506_2025", rule: "Foreign-origin signal cannot directly trigger block." }
  ]
};

// -----------------------------------
// Components
// -----------------------------------

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("bg-black/40 border border-white/10 rounded-xl overflow-hidden backdrop-blur-md", className)}>
    {children}
  </div>
);

const Badge = ({ children, variant = 'default', className }: { children: React.ReactNode; variant?: 'default'|'success'|'warning'|'danger'|'outline', className?: string }) => {
  const variants = {
    default: "bg-white/10 text-white",
    success: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
    warning: "bg-amber-500/20 text-amber-400 border border-amber-500/30",
    danger: "bg-red-500/20 text-red-400 border border-red-500/30",
    outline: "border border-white/20 text-white/70"
  };
  return <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-medium", variants[variant], className)}>{children}</span>;
}

export default function App() {

  return (
    <div className="min-h-screen bg-[#050505] text-white p-6 md:p-12 font-sans selection:bg-blue-500/30 relative">
      {/* Background gradients */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-blue-900/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-900/10 blur-[120px] pointer-events-none" />
      
      <div className="max-w-7xl mx-auto space-y-8 relative z-10">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-blue-500/20 rounded-lg">
                <Globe className="w-6 h-6 text-blue-400" />
              </div>
              <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
                Aegis Consortium
              </h1>
            </div>
            <p className="text-white/50 text-sm max-w-xl">
              Cross-Border Fraud Intelligence Layer 1: Adaptive Signal Emitter & Actionability Resolver
            </p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="text-xs text-white/40 uppercase tracking-wider font-semibold">Active Rulesets</span>
              <div className="flex gap-2 mt-1">
                <Badge variant="outline">UK</Badge>
                <Badge variant="outline">US</Badge>
                <Badge variant="outline">BR</Badge>
              </div>
            </div>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Signal Envelope */}
          <div className="lg:col-span-1 space-y-6">
            <Card>
              <div className="p-5 border-b border-white/10 bg-white/5 flex justify-between items-center">
                <h2 className="font-semibold flex items-center gap-2">
                  <Activity className="w-4 h-4 text-blue-400" />
                  Signal Envelope
                </h2>
                <Badge variant="default">Tier {mockSignal.anonymisationTier}</Badge>
              </div>
              <div className="p-5 space-y-6">
                <div className="flex justify-between items-center p-4 bg-white/5 rounded-lg border border-white/5">
                  <div className="text-center">
                    <span className="block text-xs text-white/40 mb-1">Source</span>
                    <span className="text-xl font-bold">{mockSignal.publishingJurisdiction}</span>
                  </div>
                  <ArrowRight className="w-5 h-5 text-white/30" />
                  <div className="text-center">
                    <span className="block text-xs text-white/40 mb-1">Target</span>
                    <span className="text-xl font-bold">{mockSignal.targetJurisdictions[0]}</span>
                  </div>
                </div>

                <div>
                  <h3 className="text-xs text-white/40 uppercase tracking-wider font-semibold mb-3">Identifiers (Tokens)</h3>
                  <div className="space-y-2">
                    {Object.entries(mockSignal.payload.identifierFields).map(([key, val]) => (
                      <div key={key} className="flex justify-between text-sm">
                        <span className="text-white/60">{key}</span>
                        <span className="font-mono text-white/80 text-xs truncate max-w-[120px]">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-xs text-white/40 uppercase tracking-wider font-semibold mb-3">Categories</h3>
                  <div className="space-y-2">
                    {Object.entries(mockSignal.payload.bandsAndCategories).map(([key, val]) => (
                      <div key={key} className="flex justify-between text-sm">
                        <span className="text-white/60">{key}</span>
                        <span className="text-blue-400">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t border-white/10">
                  <span className="text-xs text-white/40 block mb-1">Transfer Mechanism</span>
                  <span className="text-sm font-medium text-emerald-400">{mockSignal.transferMechanisms.BR}</span>
                </div>
              </div>
            </Card>
          </div>

          {/* Right Column: Actionability Verdict */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Verdict Header */}
            <Card className="bg-gradient-to-br from-emerald-900/20 to-black border-emerald-500/20">
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <Badge variant="success" className="mb-3 inline-block px-3 py-1 text-sm border-emerald-500/50">
                      {mockVerdict.overallVerdict.replace('_', ' ')}
                    </Badge>
                    <h2 className="text-2xl font-bold">Actionability Diagnostics</h2>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-white/40 block mb-1">Intelligence Score</span>
                    <span className="text-xl font-bold text-emerald-400">{mockVerdict.intelligenceValue.score}</span>
                  </div>
                </div>
                <p className="text-white/70 text-sm leading-relaxed">
                  {mockVerdict.verdictRationale}
                </p>
              </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Case Actions */}
              <Card>
                <div className="p-4 border-b border-white/10 bg-white/5">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <Shield className="w-4 h-4 text-emerald-400" />
                    Case-Level Actions
                  </h3>
                </div>
                <div className="p-0">
                  {mockVerdict.caseActions.map((action, i) => (
                    <div key={i} className="p-4 border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-sm">{action.action}</span>
                        {action.effectivelyActionable ? (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        ) : (
                          <XCircle className="w-4 h-4 text-red-400" />
                        )}
                      </div>
                      <div className="text-xs text-white/40 flex justify-between">
                        <span>{action.instrument.split(' +')[0]}</span>
                        <span className={action.effectivelyActionable ? "text-emerald-400/70" : "text-red-400/70"}>
                          {action.effectiveActionability}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Systemic Actions */}
              <Card>
                <div className="p-4 border-b border-white/10 bg-white/5">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <Database className="w-4 h-4 text-blue-400" />
                    Systemic Actions
                  </h3>
                </div>
                <div className="p-0">
                  {mockVerdict.systemicActions.map((action, i) => (
                    <div key={i} className="p-4 border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-sm">{action.action}</span>
                        <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      </div>
                      <div className="text-xs text-white/40 flex justify-between">
                        <span>{action.instrument.split(' +')[0]}</span>
                        <span className="text-emerald-400/70">{action.effectiveActionability}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* Regulatory Drop Log */}
            <Card>
              <div className="p-4 border-b border-white/10 bg-white/5">
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  Regulatory Friction Ledger
                </h3>
              </div>
              <div className="p-4 space-y-4">
                {mockVerdict.regulatoryDropLog.map((log, i) => (
                  <div key={i} className="bg-amber-500/5 border border-amber-500/10 rounded-lg p-4">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-sm font-medium text-amber-400/90">{log.conflictType}</span>
                      <span className="text-xs text-white/40">{log.instrument}</span>
                    </div>
                    <p className="text-xs text-white/60 leading-relaxed mb-2">
                      {log.rule}
                    </p>
                    <div className="text-xs font-mono text-white/30">Action blocked: {log.action}</div>
                  </div>
                ))}
              </div>
            </Card>

          </div>
        </div>
      </div>
    </div>
  );
}
