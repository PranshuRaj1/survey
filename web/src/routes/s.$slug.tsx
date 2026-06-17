import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/s/$slug')({
  component: Outlet,
})
