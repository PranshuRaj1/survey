import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useAuth } from '../context/AuthContext'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  const { isAuthenticated, isLoading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (!isLoading) {
      if (isAuthenticated) {
        navigate({ to: '/dashboard', replace: true })
      } else {
        navigate({ to: '/login', replace: true })
      }
    }
  }, [isAuthenticated, isLoading, navigate])

  return (
    <div className="flex h-screen items-center justify-center bg-background font-label-lg text-label-lg uppercase">
      Loading...
    </div>
  )
}
