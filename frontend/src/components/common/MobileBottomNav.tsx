import React from 'react';
import { Home, Gamepad2, Coins, User as UserIcon, ShieldAlert, Users, Activity } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { UserRole } from '../../../../shared/src/types';

export type MobileTab = 'dashboard' | 'games' | 'wallet' | 'profile' | 'api-health';

interface MobileBottomNavProps {
  activeTab: MobileTab;
  onSelectTab: (tab: MobileTab) => void;
  pendingRequestsCount?: number;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeTab,
  onSelectTab,
  pendingRequestsCount = 0,
}) => {
  const { user } = useAuth();
  const isPlayer = user?.role === UserRole.PLAYER;
  const isOwner = user?.role === UserRole.OWNER;

  // Games tab is STRICTLY restricted to Player accounts only
  const tabs = isPlayer
    ? [
        {
          id: 'dashboard' as MobileTab,
          label: 'Home',
          icon: Home,
        },
        {
          id: 'games' as MobileTab,
          label: 'Games',
          icon: Gamepad2,
        },
        {
          id: 'wallet' as MobileTab,
          label: 'Wallet',
          icon: Coins,
          badge: pendingRequestsCount > 0 ? pendingRequestsCount : undefined,
        },
        {
          id: 'profile' as MobileTab,
          label: 'Profile',
          icon: UserIcon,
        },
      ]
    : [
        {
          id: 'dashboard' as MobileTab,
          label: 'Overview',
          icon: Home,
        },
        {
          id: 'wallet' as MobileTab,
          label: 'Requests',
          icon: Coins,
          badge: pendingRequestsCount > 0 ? pendingRequestsCount : undefined,
        },
        {
          id: 'profile' as MobileTab,
          label: 'Management',
          icon: Users,
        },
      ];

  const visibleTabs = !isPlayer && isOwner
    ? [...tabs, { id: 'api-health' as MobileTab, label: 'API Health', icon: Activity }]
    : tabs;

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] bg-zinc-950/95 backdrop-blur-xl border-t border-amber-500/20 z-40 px-2 py-1 shadow-[0_-8px_20px_rgba(0,0,0,0.6)]">
      <div className="flex items-center justify-around h-13">
        {visibleTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`flex-1 flex flex-col items-center justify-center py-1 relative transition-all active:scale-90 ${
                isActive
                  ? 'text-amber-400 font-bold'
                  : 'text-zinc-500 hover:text-zinc-300 font-medium'
              }`}
            >
              {/* Active Indicator Glow */}
              {isActive && (
                <span className="absolute -top-1 w-8 h-1 bg-gradient-to-r from-amber-400 to-yellow-500 rounded-full shadow-[0_0_8px_rgba(234,179,8,0.8)]" />
              )}

              <div className="relative">
                <Icon
                  className={`w-5 h-5 transition-transform ${
                    isActive ? 'scale-110 text-amber-400' : 'text-zinc-400'
                  }`}
                />
                {tab.badge !== undefined && (
                  <span className="absolute -top-1 -right-2 bg-rose-500 text-white font-mono text-[9px] font-bold px-1 rounded-full border border-zinc-950">
                    {tab.badge}
                  </span>
                )}
              </div>

              <span className="text-[10px] mt-0.5 tracking-tight leading-none">
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
