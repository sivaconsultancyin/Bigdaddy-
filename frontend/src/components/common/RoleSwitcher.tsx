import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { UserRole, AppMode } from '../../../../shared/src/types';
import { ConfigStatusModal } from './ConfigStatusModal';
import { Shield, Crown, UserCheck, Gamepad2, Sparkles, Sliders } from 'lucide-react';

export const RoleSwitcher: React.FC = () => {
  const { user, loginAsRole, loading, configInfo } = useAuth();
  const [showConfigModal, setShowConfigModal] = useState(false);

  const isPreview = configInfo?.mode !== AppMode.PRODUCTION;

  const roles = [
    {
      role: UserRole.PLAYER,
      label: 'Player',
      icon: Gamepad2,
      color: 'from-emerald-600 to-green-700 border-emerald-400/50 text-emerald-200',
    },
    {
      role: UserRole.ADMIN,
      label: 'Admin',
      icon: UserCheck,
      color: 'from-blue-600 to-cyan-700 border-blue-400/50 text-blue-200',
    },
    {
      role: UserRole.SUPER_ADMIN,
      label: 'Super',
      icon: Shield,
      color: 'from-purple-600 to-indigo-700 border-purple-400/50 text-purple-200',
    },
    {
      role: UserRole.OWNER,
      label: 'Owner',
      icon: Crown,
      color: 'from-amber-500 to-yellow-600 border-amber-400/50 text-amber-200',
    },
  ];

  return (
    <>
      <div className="bg-zinc-950/95 border-b border-amber-500/15 px-2 py-1 text-xs text-zinc-300 w-full">
        <div className="flex items-center justify-between gap-1.5 overflow-x-auto scrollbar-none">
          {/* Mode Pill */}
          <button
            onClick={() => setShowConfigModal(true)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] font-bold shrink-0"
          >
            <Sparkles className="w-2.5 h-2.5 text-amber-400 animate-pulse shrink-0" />
            <span>Simulated</span>
            <Sliders className="w-2.5 h-2.5 text-zinc-500" />
          </button>

          {/* Quick Role Buttons */}
          <div className="flex items-center gap-1 shrink-0">
            {roles.map((r) => {
              const Icon = r.icon;
              const isActive = user?.role === r.role;

              return (
                <button
                  key={r.role}
                  onClick={() => loginAsRole(r.role)}
                  disabled={loading}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold transition-all border shrink-0 ${
                    isActive
                      ? `bg-gradient-to-r ${r.color} shadow-sm ring-1 ring-white/20`
                      : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Icon className="w-2.5 h-2.5" />
                  <span>{r.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <ConfigStatusModal
        isOpen={showConfigModal}
        onClose={() => setShowConfigModal(false)}
      />
    </>
  );
};
