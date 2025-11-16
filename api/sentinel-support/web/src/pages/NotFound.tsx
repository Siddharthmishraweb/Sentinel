import { Home, ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10 text-center">
          <div className="mb-6">
            <div className="mx-auto w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <span className="text-4xl font-bold text-gray-400">404</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">
              Page not found
            </h1>
            <p className="text-gray-600">
              Sorry, we couldn't find the page you're looking for.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/dashboard" className="btn btn-primary btn-md">
              <Home className="h-4 w-4 mr-2" />
              Go to Dashboard
            </Link>
            <button
              onClick={() => window.history.back()}
              className="btn btn-secondary btn-md"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Go back
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}