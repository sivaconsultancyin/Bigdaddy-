import React from 'react';
import { Home, Coins, Users, Activity } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { UserRole } from '../../../../shared/src/types';

export type MobileTab = 'dashboard' | 'games' | 'wallet' | 'profile' | 'api-health' | 'deposit' | 'withdrawal';

interface MobileBottomNavProps {
  activeTab: MobileTab;
  onSelectTab: (tab: MobileTab) => void;
  pendingRequestsCount?: number;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ activeTab, onSelectTab, pendingRequestsCount = 0 }) => {
  const { user } = useAuth();
  const isPlayer = user?.role === UserRole.PLAYER;
  const isOwner = user?.role === UserRole.OWNER;
  if (isPlayer) return null;

  const tabs = [
    { id: 'dashboard' as MobileTab, label: 'Overview', icon: Home },
    { id: 'wallet' as MobileTab, label: 'Requests', icon: Coins, badge: pendingRequestsCount > 0 ? pendingRequestsCount : undefined },
    { id: 'profile' as MobileTab, label: 'Management', icon: Users },
    ...(!isOwner ? [] : [{ id: 'api-health' as MobileTab, label: 'API Health', icon: Activity }]),
  ];

  return (
    <nav className="fixed bottom-0 left-1/2 z-40 w-full max-w-[430px] -translate-x-1/2 border-t border-amber-500/20 bg-zinc-950/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1 shadow-[0_-8px_20px_rgba(0,0,0,0.6)] backdrop-blur-xl">
      <div className="flex h-13 items-center justify-around">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return <button key={tab.id} onClick={() => onSelectTab(tab.id)} className={`relative flex flex-1 flex-col items-center justify-center py-1 transition active:scale-90 ${active ? 'font-bold text-amber-400' : 'font-medium text-zinc-500'}`}>
            {active && <span className="absolute -top-1 h-1 w-8 rounded-full bg-gradient-to-r from-amber-400 to-yellow-500" />}
            <span className="relative"><Icon className={`h-5 w-5 ${active ? 'text-amber-400' : 'text-zinc-400'}`} />{tab.badge !== undefined && <span className="absolute -right-2 -top-1 rounded-full border border-zinc-950 bg-rose-500 px-1 font-mono text-[9px] font-bold text-white">{tab.badge}</span>}</span>
            <span className="mt-0.5 text-[10px] leading-none tracking-tight">{tab.label}</span>
          </button>;
        })}
      </div>
    </nav>
  );
};
