import { createBrowserRouter } from 'react-router-dom'
import App from './App'
import ConceptsPage from './pages/ConceptsPage'
import ConceptDetailPage from './pages/ConceptDetailPage'
import DiscoveryPage from './pages/DiscoveryPage'

export const router = createBrowserRouter([
  {
    path: '/',
    element: <App />,
  },
  {
    path: '/concepts',
    element: <ConceptsPage />,
  },
  {
    path: '/concepts/:conceptId',
    element: <ConceptDetailPage />,
  },
  {
    path: '/discovery/:candidateId',
    element: <DiscoveryPage />,
  },
])
