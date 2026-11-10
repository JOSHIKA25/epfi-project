import React from 'react';
import {
  Activity,
  AlertTriangle,
  Sliders,
  AlertOctagon,
  ShieldCheck,
  TrendingUp,
  Share2,
  BookOpen,
  Layers,
  Wrench,
  Workflow,
  FileUp,
  ClipboardList,
  Factory,
  Stethoscope,
  Shield,
} from 'lucide-react';

export type TabKey =
  | 'flowsheet' | 'telemetry' | 'alarms' | 'replay' | 'faults' | 'health'
  | 'prediction' | 'kg' | 'rag' | 'crewai' | 'maintenance' | 'n8n' | 'admin';

interface NavigationProps {
  activeTab: TabKey;
  onSelectTab: (tab: TabKey) => void;
  activeFaultsCount: number;
  anomalyScore: number;
  pendingOrdersCount: number;
  isAdmin?: boolean;
  openAlarmCount?: number;
}

const groups = [
  {
    id: 'plant', label: 'TEP workflow', icon: Factory,
    tabs: [
      { key: 'replay' as TabKey, label: 'Data → Detect → Diagnose', icon: FileUp },
      { key: 'flowsheet' as TabKey, label: 'Plant overview', icon: Activity },
      { key: 'telemetry' as TabKey, label: 'Telemetry check', icon: Sliders },
      { key: 'faults' as TabKey, label: 'Fault Lab', icon: AlertOctagon },
    ],
  },
  {
    id: 'analysis', label: 'Analysis', icon: Stethoscope,
    tabs: [
      { key: 'health' as TabKey, label: 'Anomaly check', icon: ShieldCheck },
      { key: 'prediction' as TabKey, label: 'Fault + sensors', icon: TrendingUp },
      { key: 'kg' as TabKey, label: 'Impact graph', icon: Share2 },
      { key: 'rag' as TabKey, label: 'Knowledge search', icon: BookOpen },
      { key: 'crewai' as TabKey, label: 'Unit agents', icon: Layers },
    ],
  },
  {
    id: 'response', label: 'Review & dispatch', icon: ClipboardList,
    tabs: [
      { key: 'alarms' as TabKey, label: 'Alarm review', icon: AlertTriangle },
      { key: 'maintenance' as TabKey, label: 'Work orders', icon: Wrench },
      { key: 'n8n' as TabKey, label: 'Notifications', icon: Workflow },
    ],
  },
];

export const Navigation: React.FC<NavigationProps> = ({
  activeTab,
  onSelectTab,
  activeFaultsCount,
  anomalyScore,
  pendingOrdersCount,
  isAdmin = false,
  openAlarmCount = 0,
}) => {
  const activeGroup = groups.find((group) => group.tabs.some((tab) => tab.key === activeTab))?.id
    ?? (activeTab === 'admin' ? 'access' : 'plant');
  const selectGroup = (groupId: string) => {
    const group = groups.find((item) => item.id === groupId);
    if (group) onSelectTab(group.tabs[0].key);
    else if (groupId === 'access' && isAdmin) onSelectTab('admin');
  };

  const badgeFor = (key: TabKey): string | null => {
    if (key === 'faults' && activeFaultsCount > 0) return `${activeFaultsCount} active`;
    if (key === 'health' && anomalyScore >= 100) return 'above limit';
    if (key === 'alarms' && openAlarmCount > 0) return `${openAlarmCount} open`;
    if (key === 'maintenance' && pendingOrdersCount > 0) return `${pendingOrdersCount} pending`;
    return null;
  };

  const selectedGroup = groups.find((group) => group.id === activeGroup);
  return (
    <nav aria-label="Project flow" className="border-b border-slate-800 bg-slate-950 px-4 py-1.5">
      <div className="flex items-center gap-2 overflow-x-auto">
        {groups.map((group) => {
          const Icon = group.icon;
          const selected = activeGroup === group.id;
          return (
            <button key={group.id} onClick={() => selectGroup(group.id)}
              className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${selected ? 'border-cyan-800 bg-slate-800 text-cyan-300' : 'border-transparent text-slate-400 hover:bg-slate-900 hover:text-slate-200'}`}>
              <Icon className="h-3.5 w-3.5" />{group.label}
            </button>
          );
        })}
        {isAdmin && (
          <button onClick={() => selectGroup('access')}
            className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${activeGroup === 'access' ? 'border-cyan-800 bg-slate-800 text-cyan-300' : 'border-transparent text-slate-400 hover:bg-slate-900 hover:text-slate-200'}`}>
            <Shield className="h-3.5 w-3.5" />Access
          </button>
        )}
      </div>
      {selectedGroup && (
        <div className="mt-1 flex items-center gap-1 overflow-x-auto border-t border-slate-900 pt-1">
          {selectedGroup.tabs.map((tab) => {
            const Icon = tab.icon;
            const selected = activeTab === tab.key;
            const badge = badgeFor(tab.key);
            return (
              <button key={tab.key} onClick={() => onSelectTab(tab.key)}
                className={`flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] transition ${selected ? 'bg-cyan-950/70 text-cyan-200' : 'text-slate-500 hover:bg-slate-900 hover:text-slate-200'}`}>
                <Icon className="h-3 w-3" />{tab.label}
                {badge && <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-300">{badge}</span>}
              </button>
            );
          })}
        </div>
      )}
    </nav>
  );
};
