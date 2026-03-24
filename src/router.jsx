import { createBrowserRouter } from 'react-router-dom'
import AppLayout from './AppLayout'
import App from './App'
import ConceptsPage from './pages/ConceptsPage'
import ConceptDetailPage from './pages/ConceptDetailPage'
import DiscoveryPage from './pages/DiscoveryPage'
import ScreenedPage from './pages/ScreenedPage'

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <App /> },
      { path: '/screened', element: <ScreenedPage /> },
      { path: '/concepts', element: <ConceptsPage /> },
      { path: '/concepts/:conceptId', element: <ConceptDetailPage /> },
      { path: '/discovery/:candidateId', element: <DiscoveryPage /> },
    ],
  },
])
