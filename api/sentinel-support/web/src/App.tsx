import { Routes, Route, Navigate } from 'react-router-dom'
import { Suspense } from 'react'

import Layout from './components/layout/Layout'
import LoadingSpinner from './components/ui/LoadingSpinner'
import Dashboard from './pages/Dashboard'
import AlertsQueue from './pages/AlertsQueue'
import CustomersList from './pages/CustomersList'
import CustomerDetails from './pages/CustomerDetails'
import Evaluations from './pages/Evaluations'
import NotFound from './pages/NotFound'

function App() {
  return (
    <div className="App min-h-screen bg-gray-50">
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/*" element={
          <Layout>
            <Suspense fallback={
              <div className="flex items-center justify-center min-h-[50vh]">
                <LoadingSpinner size="lg" />
              </div>
            }>
              <Routes>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/alerts" element={<AlertsQueue />} />
                <Route path="/customers" element={<CustomersList />} />
                <Route path="/customer/:customerId" element={<CustomerDetails />} />
                <Route path="/evals" element={<Evaluations />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Suspense>
          </Layout>
        } />
      </Routes>
    </div>
  )
}

export default App