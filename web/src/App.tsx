import { useState } from 'react';
import { Shield } from 'lucide-react';
import Dashboard from './components/Dashboard';
import Simulator from './components/Simulator';
import { cn } from './utils/cn';

export default function App() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'simulator'>('simulator');

  return (
    <div className="min-h-screen bg-[#050505] text-white font-sans selection:bg-blue-500/30">
      {/* Background gradients */}
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-blue-900/20 blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-emerald-900/10 blur-[120px] pointer-events-none" />
      
      {/* Top Navigation */}
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-md relative z-20">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-emerald-500 flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold tracking-tight">Aegis Consortium</span>
          </div>
          
          <div className="flex items-center gap-1 bg-white/5 p-1 rounded-lg border border-white/10">
            <button 
              onClick={() => setActiveTab('dashboard')}
              className={cn("px-4 py-1.5 rounded-md text-sm font-medium transition-colors", activeTab === 'dashboard' ? "bg-white/10 text-white" : "text-white/50 hover:text-white")}
            >
              Intelligence Dashboard
            </button>
            <button 
              onClick={() => setActiveTab('simulator')}
              className={cn("px-4 py-1.5 rounded-md text-sm font-medium transition-colors", activeTab === 'simulator' ? "bg-white/10 text-white" : "text-white/50 hover:text-white")}
            >
              Live Signal Simulator
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="relative z-10 max-w-7xl mx-auto p-6">
        {activeTab === 'dashboard' ? <Dashboard /> : <Simulator />}
      </main>
    </div>
  );
}
