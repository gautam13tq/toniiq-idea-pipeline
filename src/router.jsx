import { createBrowserRouter, Navigate } from 'react-router-dom'
import AppLayout from './AppLayout'
import InboxPage from './pages/InboxPage'
import ResearchPage from './pages/ResearchPage'
import EvaluationPage from './pages/EvaluationPage'
import ArchivePage from './pages/ArchivePage'
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
      { path: '/', element: <Navigate to="/inbox" replace /> },

      // 5 lifecycle state pages
      { path: '/inbox', element: <InboxPage /> },
      { path: '/research', element: <ResearchPage /> },
      { path: '/evaluation', element: <EvaluationPage /> },
      { path: '/development', element: <DevelopmentPage /> },
      { path: '/archive', element: <ArchivePage /> },

      // Deep views
      { path: '/development/:projectId', element: <DevelopmentDetailPage /> },
      { path: '/concepts', element: <ConceptsPage /> },
      { path: '/concepts/:conceptId', element: <ConceptDetailPage /> },
      { path: '/discovery/:candidateId', element: <DiscoveryPage /> },

      // Legacy redirects
      { path: '/screened', element: <Navigate to="/research" replace /> },

      // Supplier hub (still accessible via URL, hidden from primary nav)
      { path: '/suppliers', element: <SupplierHubPage /> },
      { path: '/suppliers/:supplierId', element: <SupplierDetailPage /> },
      { path: '/suppliers/ingredient/:ingredientName', element: <IngredientDetailPage /> },
    ],
  },
])
