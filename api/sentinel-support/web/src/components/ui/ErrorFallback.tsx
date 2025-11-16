import { FallbackProps } from 'react-error-boundary'
import { RefreshCw, AlertTriangle, Home } from 'lucide-react'

export default function ErrorFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
        <div className="mb-6">
          <div className="mx-auto w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-4">
            <AlertTriangle className="h-8 w-8 text-red-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">
            Something went wrong
          </h1>
          <p className="text-gray-600 mb-4">
            We encountered an unexpected error. Please try refreshing the page or contact support if the problem persists.
          </p>
        </div>

        <details className="text-left mb-6">
          <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
            Technical Details
          </summary>
          <pre className="mt-2 p-3 bg-red-50 border border-red-200 rounded text-xs text-red-800 overflow-auto max-h-32">
            {error.message}
            {error.stack && `\n\n${error.stack}`}
          </pre>
        </details>

        <div className="flex gap-3 justify-center">
          <button
            onClick={resetErrorBoundary}
            className="btn btn-primary btn-md"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Try again
          </button>
          <button
            onClick={() => window.location.href = '/'}
            className="btn btn-secondary btn-md"
          >
            <Home className="h-4 w-4 mr-2" />
            Go home
          </button>
        </div>
      </div>
    </div>
  )
}