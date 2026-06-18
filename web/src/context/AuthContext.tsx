import React, { createContext, useContext, useEffect, useState } from 'react'
import { apiRequest } from '../lib/api'

interface User {
  id: string
  email: string
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  awaitSession: () => Promise<User | null>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(true)

  const sessionPromiseRef = React.useRef<Promise<User | null> | null>(null)
  const resolveSessionRef = React.useRef<((user: User | null) => void) | null>(null)

  if (!sessionPromiseRef.current) {
    sessionPromiseRef.current = new Promise<User | null>((resolve) => {
      resolveSessionRef.current = resolve
    })
  }

  useEffect(() => {
    async function restoreSession() {
      let restoredUser: User | null = null
      try {
        const res = await apiRequest<{ user: User }>('/api/auth/me')
        setUser(res.user)
        restoredUser = res.user
      } catch (err) {
        console.error('Session restoration failed:', err)
        setUser(null)
      } finally {
        setIsLoading(false)
        if (resolveSessionRef.current) {
          resolveSessionRef.current(restoredUser)
        }
      }
    }
    restoreSession()
  }, [])

  const awaitSession = React.useCallback(async () => {
    if (!isLoading) {
      return user
    }
    return sessionPromiseRef.current!
  }, [isLoading, user])

  const login = async (email: string, password: string) => {
    setIsLoading(true)
    try {
      const res = await apiRequest<{ user: User }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      sessionPromiseRef.current = Promise.resolve(res.user)
      setUser(res.user)
      setIsLoading(false)
    } catch (err) {
      setIsLoading(false)
      throw err
    }
  }

  const signup = async (email: string, password: string) => {
    setIsLoading(true)
    try {
      const res = await apiRequest<{ user: User }>('/api/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      sessionPromiseRef.current = Promise.resolve(res.user)
      setUser(res.user)
      setIsLoading(false)
    } catch (err) {
      setIsLoading(false)
      throw err
    }
  }

  const logout = async () => {
    setIsLoading(true)
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' })
    } catch (err) {
      console.error('Logout request failed:', err)
    } finally {
      sessionPromiseRef.current = Promise.resolve(null)
      setUser(null)
      setIsLoading(false)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        login,
        signup,
        logout,
        awaitSession,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
