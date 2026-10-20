import React, { createContext, useContext, useState, useEffect } from 'react';
import { User, Wallet, AppConfigInfo } from '../../../shared/src/types';
import { ApiClient } from '../api/client';

interface AuthContextType {
  user: User | null;
  wallet: Wallet | null;
  configInfo: AppConfigInfo | null;
  configError: string | null;
  authError: string | null;
  loading: boolean;
  login: (credentials: { username: string; password: string }) => Promise<void>;
  logout: () => void;
  refreshWallet: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function isInvalidSessionError(message: string) {
  return /AUTH_REQUIRED|INVALID_TOKEN|USER_NOT_FOUND_OR_DISABLED|Missing or invalid|Expired or invalid|User does not exist|Authentication required/i.test(message);
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [configInfo, setConfigInfo] = useState<AppConfigInfo | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
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
      setLoading(false);
      return;
    }
    try {
      const data = await ApiClient.getMe();
      if (!data?.user?.id) {
        throw new Error('The server returned an invalid session response. Please sign in again.');
      }
      setUser(data.user);
      setWallet(data.wallet);
      setAuthError(null);
    } catch (err: any) {
      const message = err?.message || 'Could not verify your session. Please try again.';
      if (message.includes('PRODUCTION_CONFIGURATION_ERROR')) setConfigError(message);

      // A transient network/database error is not proof that a saved token is invalid.
      // Only clear credentials when the API explicitly indicates an invalid session.
      if (isInvalidSessionError(message)) {
        ApiClient.clearToken();
        setUser(null);
        setWallet(null);
        setAuthError('Your session has expired. Please sign in again.');
      } else {
        setAuthError(`Could not verify your session: ${message}`);
        console.warn('Session verification failed; keeping token for retry:', message);
      }
    } finally {
      setLoading(false);
    }
  };

  const refreshWallet = async () => {
    const token = ApiClient.getToken();
    if (!token) return;
    try {
      const data = await ApiClient.getMyWallet();
      if (data?.wallet) setWallet(data.wallet);
    } catch (err: any) {
      const message = err?.message || '';
      if (isInvalidSessionError(message)) {
        ApiClient.clearToken();
        setUser(null);
        setWallet(null);
        setAuthError('Your session has expired. Please sign in again.');
        return;
      }
      setAuthError(`Could not refresh wallet: ${message}`);
      console.warn('Could not refresh wallet:', message);
    }
  };

  useEffect(() => {
    const initialize = async () => {
      try {
        const cfg = await ApiClient.getConfig();
        setConfigInfo(cfg);
      } catch (err: any) {
        if (err.message?.includes('PRODUCTION_CONFIGURATION_ERROR')) setConfigError(err.message);
      }
      const token = ApiClient.getToken();
      if (token) {
        await refreshUser();
      } else {
        setLoading(false);
      }
    };
    void initialize();
  }, []);

  const login = async (credentials: { username: string; password: string }) => {
    // `loading` controls the app's initial session bootstrap. Do not toggle it
    // during a login attempt: App may unmount Login while loading is true,
    // discarding the component's error state when authentication fails.
    setAuthError(null);
    try {
      const data = await ApiClient.login(credentials);
      if (!data?.token || !data?.user?.id) {
        throw new Error('The server returned an incomplete login response. Please try again.');
      }
      ApiClient.setToken(data.token);
      setUser(data.user);
      setWallet(data.wallet ?? null);
    } catch (err: any) {
      if (err.message?.includes('PRODUCTION_CONFIGURATION_ERROR')) {
        setConfigError(err.message);
      }
      throw err;
    }
  };

  const logout = () => {
    ApiClient.clearToken();
    setUser(null);
    setWallet(null);
    setAuthError(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        wallet,
        configInfo,
        configError,
        authError,
        loading,
        login,
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
