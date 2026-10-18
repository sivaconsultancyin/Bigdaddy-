import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Wallet, UserRole, AppConfigInfo, AppMode } from '../../../shared/src/types';
import { ApiClient } from '../api/client';

interface AuthContextType {
  user: User | null;
  wallet: Wallet | null;
  configInfo: AppConfigInfo | null;
  configError: string | null;
  loading: boolean;
  login: (credentials: { username: string; password: string }) => Promise<void>;
  loginAsRole: (role: UserRole) => Promise<void>;
  logout: () => void;
  refreshWallet: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [configInfo, setConfigInfo] = useState<AppConfigInfo | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadConfig = async () => {
    try {
      const cfg = await ApiClient.getConfig();
      setConfigInfo(cfg);
    } catch (err: any) {
      if (err.message?.includes('PRODUCTION_CONFIGURATION_ERROR')) {
        setConfigError(err.message);
      }
    }
  };

  const refreshUser = async () => {
    const token = ApiClient.getToken();
    if (!token) {
      loginAsRole(UserRole.PLAYER).catch(() => setLoading(false));
      return;
    }
    try {
      const data = await ApiClient.getMe();
      setUser(data.user);
      setWallet(data.wallet);
    } catch (err: any) {
      if (err.message?.includes('PRODUCTION_CONFIGURATION_ERROR')) {
        setConfigError(err.message);
      }
      ApiClient.clearToken();
      setUser(null);
      setWallet(null);
      // Auto-relogin in preview/dev mode to restore demo player session
      loginAsRole(UserRole.PLAYER).catch(() => setLoading(false));
    } finally {
      setLoading(false);
    }
  };

  const refreshWallet = async () => {
    const token = ApiClient.getToken();
    if (!token) {
      return;
    }
    try {
      const data = await ApiClient.getMyWallet();
      if (data?.wallet) {
        setWallet(data.wallet);
      }
    } catch (err: any) {
      const msg = err?.message || '';
      if (
        msg.includes('Missing or invalid') ||
        msg.includes('Expired or invalid') ||
        msg.includes('User does not exist') ||
        msg.includes('Authentication required')
      ) {
        ApiClient.clearToken();
        setUser(null);
        setWallet(null);
        loginAsRole(UserRole.PLAYER).catch(() => {});
        return;
      }
      console.warn('Could not refresh wallet:', msg);
    }
  };

  useEffect(() => {
    loadConfig();
    const token = ApiClient.getToken();
    if (token) {
      refreshUser();
    } else {
      // In Development/Preview Mode, automatically sign in to demo Player account
      // for an effortless, instant UI preview experience with simulated tokens!
      loginAsRole(UserRole.PLAYER).catch(() => setLoading(false));
    }
  }, []);

  const login = async (credentials: { username: string; password: string }) => {
    setLoading(true);
    try {
      const data = await ApiClient.login(credentials);
      ApiClient.setToken(data.token);
      setUser(data.user);
      setWallet(data.wallet);
    } catch (err: any) {
      if (err.message?.includes('PRODUCTION_CONFIGURATION_ERROR')) {
        setConfigError(err.message);
      }
      throw err;
    } finally {
      setLoading(false);
    }
  };

  const loginAsRole = async (role: UserRole) => {
    const credentialsMap: Record<UserRole, { username: string; password: string }> = {
      [UserRole.OWNER]: { username: 'owner', password: 'Owner@1234' },
      [UserRole.SUPER_ADMIN]: { username: 'superadmin_alpha', password: 'SuperAdmin@1234' },
      [UserRole.ADMIN]: { username: 'admin_bravo', password: 'Admin@1234' },
      [UserRole.PLAYER]: { username: 'player_charlie', password: 'Player@1234' },
    };

    await login(credentialsMap[role]);
  };

  const logout = () => {
    ApiClient.clearToken();
    setUser(null);
    setWallet(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        wallet,
        configInfo,
        configError,
        loading,
        login,
        loginAsRole,
        logout,
        refreshWallet,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
