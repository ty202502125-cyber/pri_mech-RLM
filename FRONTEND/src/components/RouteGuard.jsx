import { Navigate, useLocation } from 'react-router-dom'

export default function RouteGuard({ user, role, children }) {
  const loc = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  if (role && user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin' : '/account'} replace />
  return children
}

/* ── Booking page ─────────────────────────────────────────── */
