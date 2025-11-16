import { CheckCircle2, Play, BarChart3 } from 'lucide-react'
import { useEvaluations, useRunEvaluation } from '../hooks/api'

export default function Evaluations() {
  const { data, isLoading, error } = useEvaluations()
  const runEvaluationMutation = useRunEvaluation()

  const evaluations = data?.evaluations || []
  const summary = data?.summary || {
    totalEvaluations: 0,
    averageScore: 0,
    activeTests: 0
  }

  const handleRunEvaluation = async (evaluationId: number) => {
    try {
      await runEvaluationMutation.mutateAsync(evaluationId)
    } catch (error) {
      console.error('Failed to run evaluation:', error)
    }
  }

  const handleRunNewEvaluation = async () => {
    if (evaluations.length === 0) {
      alert('No evaluations available to run')
      return
    }

    // Find the most suitable evaluation to run:
    // 1. First try to find a pending evaluation
    // 2. Otherwise, run the first completed evaluation again
    // 3. As fallback, run the first available evaluation
    const pendingEval = evaluations.find(e => e.status === 'pending')
    const completedEval = evaluations.find(e => e.status === 'completed')
    const targetEval = pendingEval || completedEval || evaluations[0]

    if (targetEval) {
      try {
        console.log(`Running evaluation: ${targetEval.name}`)
        await handleRunEvaluation(targetEval.id)
      } catch (error) {
        console.error('Failed to run evaluation:', error)
        alert(`Failed to run evaluation: ${error instanceof Error ? error.message : 'Unknown error'}`)
      }
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-100 text-green-800'
      case 'running':
        return 'bg-blue-100 text-blue-800'
      case 'pending':
        return 'bg-yellow-100 text-yellow-800'
      default:
        return 'bg-gray-100 text-gray-800'
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading evaluations...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="text-red-600 mb-4">
              <svg className="h-12 w-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.464 0L4.35 15.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <p className="text-gray-600">Failed to load evaluations. Please try again.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center">
            <CheckCircle2 className="h-8 w-8 mr-3 text-green-500" />
            Model Evaluations
          </h1>
          <p className="mt-2 text-gray-600">
            Test and validate AI model performance
          </p>
        </div>
        <button 
          className="btn btn-primary btn-md"
          onClick={handleRunNewEvaluation}
          disabled={runEvaluationMutation.isPending}
        >
          <Play className="h-4 w-4 mr-2" />
          {runEvaluationMutation.isPending ? 'Running...' : 'Run New Evaluation'}
        </button>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
              </div>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-900">Total Evaluations</p>
              <p className="text-2xl font-bold text-gray-900">{summary.totalEvaluations}</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-blue-600" />
              </div>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-900">Average Score</p>
              <p className="text-2xl font-bold text-gray-900">{summary.averageScore}%</p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                <Play className="w-4 h-4 text-amber-600" />
              </div>
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-900">Active Tests</p>
              <p className="text-2xl font-bold text-gray-900">{summary.activeTests}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Evaluations List */}
      <div className="bg-white shadow rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Recent Evaluations</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Evaluation
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Score
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Test Cases
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Last Run
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {evaluations.map((evaluation) => (
                <tr key={evaluation.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {evaluation.name}
                      </div>
                      <div className="text-sm text-gray-500">
                        {evaluation.description}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusBadge(evaluation.status)}`}>
                      {evaluation.status.charAt(0).toUpperCase() + evaluation.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {evaluation.score ? `${evaluation.score}%` : '-'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {evaluation.testCases}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {evaluation.lastRun}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <button className="text-primary-600 hover:text-primary-900 mr-4">
                      View Results
                    </button>
                    <button 
                      className="text-gray-600 hover:text-gray-900 disabled:opacity-50"
                      onClick={() => handleRunEvaluation(evaluation.id)}
                      disabled={runEvaluationMutation.isPending}
                    >
                      {runEvaluationMutation.isPending ? 'Running...' : 'Run Again'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Recent Test Results */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Performance Trends</h2>
        </div>
        <div className="px-6 py-4">
          <div className="h-64 flex items-center justify-center bg-gray-50 rounded-lg">
            <div className="text-center">
              <BarChart3 className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-gray-900 mb-2">
                Performance Chart
              </h3>
              <p className="text-gray-600">
                Charts and graphs showing model performance over time would be displayed here.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}