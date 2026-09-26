import React from 'react';
import {
  Activity,
  Sliders,
  AlertOctagon,
  ShieldCheck,
  TrendingUp,
  Share2,
  BookOpen,
  Layers,
  Wrench,
  Workflow,
} from 'lucide-react';

export type TabKey =
  | 'flowsheet'
  | 'telemetry'
  | 'faults'
  | 'health'
  | 'prediction'
  | 'kg'
  | 'rag'
  | 'crewai'
  | 'maintenance'
  | 'n8n';

interface NavigationProps {
  activeTab: TabKey;
  onSelectTab: (tab: TabKey) => void;
  activeFaultsCount: number;
  anomalyScore: number;
  pendingOrdersCount: number;
}

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onSelectTab,
  activeFaultsCount,
  anomalyScore,
  pendingOrdersCount,
}) => {
  const tabs = [
    {
      key: 'flowsheet' as TabKey,
      label: 'P&ID Flowsheet',
      icon: Activity,
      badge: null,
    },
    {
      key: 'telemetry' as TabKey,
      label: '41 Variables',
      icon: Sliders,
      badge: '41',
    },
    {
      key: 'faults' as TabKey,
      label: 'Fault Lab (IDV 1-21)',
      icon: AlertOctagon,
      badge: activeFaultsCount > 0 ? `${activeFaultsCount} Active` : null,
      badgeColor: 'bg-rose-500 text-white',
    },
    {
      key: 'health' as TabKey,
      label: 'Health & Autoencoder',
      icon: ShieldCheck,
      badge: anomalyScore > 35 ? `${anomalyScore.toFixed(0)}%` : null,
      badgeColor: 'bg-amber-500 text-slate-950',
    },
    {
      key: 'prediction' as TabKey,
      label: 'XGBoost & SHAP',
      icon: TrendingUp,
      badge: 'XAI',
    },
    {
      key: 'kg' as TabKey,
      label: 'Knowledge Graph',
      icon: Share2,
      badge: 'Neo4j',
    },
    {
      key: 'rag' as TabKey,
      label: 'RAG Engineering Docs',
      icon: BookOpen,
      badge: 'SOPs',
    },
    {
      key: 'crewai' as TabKey,
      label: 'CrewAI Multi-Agent',
      icon: Layers,
      badge: '5 Agents',
    },
    {
      key: 'maintenance' as TabKey,
      label: 'Maintenance Station',
      icon: Wrench,
      badge: pendingOrdersCount > 0 ? `${pendingOrdersCount} Review` : null,
      badgeColor: 'bg-amber-400 text-slate-950 font-bold',
    },
    {
      key: 'n8n' as TabKey,
      label: 'n8n Automation',
      icon: Workflow,
      badge: 'Webhooks',
    },
  ];

  return (
    <nav className="bg-slate-950 border-b border-slate-800 px-4 flex items-center overflow-x-auto scrollbar-none gap-1 py-1.5">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.key;
        return (
          <button
            key={tab.key}
            onClick={() => onSelectTab(tab.key)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer select-none ${
              isActive
                ? 'bg-slate-800 text-cyan-400 border border-slate-700 shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'
            }`}
          >
            <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-cyan-400' : 'text-slate-500'}`} />
            <span>{tab.label}</span>
            {tab.badge && (
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono font-medium ${
                  tab.badgeColor || (isActive ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-slate-800 text-slate-400')
                }`}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
};
