import { createRootRoute, Outlet } from '@tanstack/react-router'
import { AuthProvider } from '../context/AuthContext'

export const Route = createRootRoute({
  component: () => (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  ),
})
