import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiRequest } from '../lib/api';

interface User {
  id: string;
  email: string;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('decodego_token'));
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    async function restoreSession() {
      if (token) {
        try {
          const res = await apiRequest<{ user: User }>('/api/auth/me');
          setUser(res.user);
        } catch (err) {
          console.error('Session restoration failed:', err);
          localStorage.removeItem('decodego_token');
          setToken(null);
          setUser(null);
        }
      }
      setIsLoading(false);
    }
    restoreSession();
  }, [token]);

  const login = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem('decodego_token', res.token);
      setToken(res.token);
      setUser(res.user);
    } catch (err) {
      setIsLoading(false);
      throw err;
    }
  };

  const signup = async (email: string, password: string) => {
    setIsLoading(true);
    try {
      const res = await apiRequest<{ token: string; user: User }>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem('decodego_token', res.token);
      setToken(res.token);
      setUser(res.user);
    } catch (err) {
      setIsLoading(false);
      throw err;
    }
  };

  const logout = async () => {
    setIsLoading(true);
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout request failed:', err);
    } finally {
      localStorage.removeItem('decodego_token');
      setToken(null);
      setUser(null);
      setIsLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!user,
        login,
        signup,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
