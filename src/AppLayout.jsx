import { Outlet } from 'react-router-dom'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import { useAuth } from './lib/AuthContext'

export default function AppLayout() {
  const { user, loading } = useAuth()

  // Show nothing while checking auth state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
        <div className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading...</div>
      </div>
    )
  }

  // Not logged in — show login page
  if (!user) {
    return <LoginPage />
  }

  // Logged in — show app
  return (
    <Layout>
      <Outlet />
    </Layout>
  )
}
