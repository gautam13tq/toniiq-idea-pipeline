import { createBrowserRouter, Navigate } from 'react-router-dom'
import AppLayout from './AppLayout'
import DiscoverHubPage from './pages/DiscoverHubPage'
import PipelinePage from './pages/PipelinePage'
import DevelopmentPage from './pages/DevelopmentPage'
import DevelopmentDetailPage from './pages/DevelopmentDetailPage'
import ConceptDetailPage from './pages/ConceptDetailPage'
import DiscoveryPage from './pages/DiscoveryPage'
import ConceptsPage from './pages/ConceptsPage'
import SupplierHubPage from './pages/SupplierHubPage'
import SupplierDetailPage from './pages/SupplierDetailPage'
import IngredientDetailPage from './pages/IngredientDetailPage'

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <Navigate to="/pipeline" replace /> },

      // Hub pages
      { path: '/discover', element: <Navigate to="/discover/shortlist" replace /> },
      { path: '/discover/:tab', element: <DiscoverHubPage /> },
      { path: '/pipeline', element: <Navigate to="/pipeline/decide" replace /> },
      { path: '/pipeline/:tab', element: <PipelinePage /> },

      // Development (unchanged)
      { path: '/development', element: <DevelopmentPage /> },

      // Deep views
      { path: '/development/:projectId', element: <DevelopmentDetailPage /> },
      { path: '/concepts', element: <ConceptsPage /> },
      { path: '/concepts/:conceptId', element: <ConceptDetailPage /> },
      { path: '/discovery/:candidateId', element: <DiscoveryPage /> },

      // Legacy redirects
      { path: '/today', element: <Navigate to="/pipeline" replace /> },
      { path: '/inbox', element: <Navigate to="/discover/signals" replace /> },
      { path: '/market', element: <Navigate to="/discover/picks" replace /> },
      { path: '/category-atlas', element: <Navigate to="/discover/categories" replace /> },
      { path: '/opportunities', element: <Navigate to="/discover/shortlist" replace /> },
      { path: '/research', element: <Navigate to="/pipeline/research" replace /> },
      { path: '/evaluation', element: <Navigate to="/pipeline/decide" replace /> },
      { path: '/archive', element: <Navigate to="/pipeline/archive" replace /> },
      { path: '/screened', element: <Navigate to="/pipeline/research" replace /> },

      // Supplier hub (still accessible via URL, hidden from primary nav)
      { path: '/suppliers', element: <SupplierHubPage /> },
      { path: '/suppliers/:supplierId', element: <SupplierDetailPage /> },
      { path: '/suppliers/ingredient/:ingredientName', element: <IngredientDetailPage /> },
    ],
  },
])
