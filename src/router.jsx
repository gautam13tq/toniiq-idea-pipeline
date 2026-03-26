import { createBrowserRouter } from 'react-router-dom'
import AppLayout from './AppLayout'
import App from './App'
import ConceptsPage from './pages/ConceptsPage'
import ConceptDetailPage from './pages/ConceptDetailPage'
import DiscoveryPage from './pages/DiscoveryPage'
import ScreenedPage from './pages/ScreenedPage'
import DevelopmentPage from './pages/DevelopmentPage'
import DevelopmentDetailPage from './pages/DevelopmentDetailPage'
import SupplierHubPage from './pages/SupplierHubPage'
import SupplierDetailPage from './pages/SupplierDetailPage'
import IngredientDetailPage from './pages/IngredientDetailPage'

export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { path: '/', element: <App /> },
      { path: '/screened', element: <ScreenedPage /> },
      { path: '/concepts', element: <ConceptsPage /> },
      { path: '/concepts/:conceptId', element: <ConceptDetailPage /> },
      { path: '/discovery/:candidateId', element: <DiscoveryPage /> },
      { path: '/development', element: <DevelopmentPage /> },
      { path: '/development/:projectId', element: <DevelopmentDetailPage /> },
      { path: '/suppliers', element: <SupplierHubPage /> },
      { path: '/suppliers/:supplierId', element: <SupplierDetailPage /> },
      { path: '/suppliers/ingredient/:ingredientName', element: <IngredientDetailPage /> },
    ],
  },
])
