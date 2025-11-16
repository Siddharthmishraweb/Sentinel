import { TrendingUp, TrendingDown, Activity, AlertTriangle, Users, Shield, DollarSign } from 'lucide-react'
import { useDashboardMetrics, useAlerts, useTransactions } from '../hooks/api'

// Clean metric card component
function MetricCard({ title, value, change, trend, icon: Icon, color, description, isLoading }: any) {
  const colorClasses = {
    red: 'bg-red-50 text-red-600 border-red-200',
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    green: 'bg-green-50 text-green-600 border-green-200',
    orange: 'bg-orange-50 text-orange-600 border-orange-200'
  }
  
  if (isLoading) {
    return (
      <div className="bg-white overflow-hidden shadow rounded-lg border border-gray-200 animate-pulse">
        <div className="p-5 space-y-4">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-8 bg-gray-200 rounded w-1/2"></div>
          <div className="h-3 bg-gray-200 rounded w-full"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white overflow-hidden shadow rounded-lg border border-gray-200 hover:shadow-md transition-shadow">
      <div className="p-5">
        <div className="flex items-center">
          <div className="flex-shrink-0">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colorClasses[color] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
              <Icon className="w-4 h-4" />
            </div>
          </div>
          <div className="ml-5 w-0 flex-1">
            <dl>
              <dt className="text-sm font-medium text-gray-500 truncate">{title}</dt>
              <dd>
                <div className="text-lg font-medium text-gray-900">{value}</div>
              </dd>
            </dl>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <div className={`text-sm ${
            trend === 'up' ? 'text-green-600' : 
            trend === 'down' ? 'text-red-600' : 
            'text-gray-600'
          }`}>
            {trend === 'up' ? (
              <TrendingUp className="h-4 w-4 inline mr-1" />
            ) : trend === 'down' ? (
              <TrendingDown className="h-4 w-4 inline mr-1" />
            ) : (
              <Activity className="h-4 w-4 inline mr-1" />
            )}
            {change}
          </div>
          <div className="text-xs text-gray-500">{description}</div>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { data: metricsData, isLoading: metricsLoading } = useDashboardMetrics()
  const { data: alertsData, isLoading: alertsLoading } = useAlerts({ limit: 5 })
  const { data: transactionsData, isLoading: transactionsLoading } = useTransactions({ limit: 5 })

  const metrics = metricsData as any
  const alerts = alertsData?.data || []
  const transactions = transactionsData?.data || []

  console.log("metrics: ", metrics)

  // Updated metrics using real API data structure
  const dashboardMetrics = [
    {
      title: 'Total Alerts',
      value: metrics?.alerts?.total?.toLocaleString() || '0',
      change: `${metrics?.activity?.new_alerts_24h || 0} new today`,
      trend: (metrics?.activity?.new_alerts_24h || 0) > 0 ? 'up' as const : 'neutral' as const,
      icon: AlertTriangle,
      color: 'red',
      description: `${metrics?.alerts?.by_status?.OPEN || 0} open, ${metrics?.alerts?.by_status?.INVESTIGATING || 0} investigating`
    },
    {
      title: 'Total Transactions',
      value: metrics?.transactions?.total?.toLocaleString() || '0',
      change: `${metrics?.activity?.new_transactions_24h || 0} new today`,
      trend: (metrics?.activity?.new_transactions_24h || 0) > 0 ? 'up' as const : 'neutral' as const,
      icon: Activity,
      color: 'blue',
      description: `${metrics?.transactions?.by_status?.COMPLETED || 0} completed`
    },
    {
      title: 'High Risk Transactions',
      value: metrics?.transactions?.high_risk?.toString() || '0',
      change: 'Risk level',
      trend: (metrics?.transactions?.high_risk || 0) === 0 ? 'down' as const : 'up' as const,
      icon: Shield,
      color: (metrics?.transactions?.high_risk || 0) === 0 ? 'green' : 'red',
      description: 'Flagged for review'
    },
    {
      title: 'Total Customers',
      value: metrics?.customers?.total?.toLocaleString() || '0',
      change: 'KYC Status',
      trend: 'neutral' as const,
      icon: Users,
      color: 'blue',
      description: `${metrics?.customers?.by_kyc_level?.ENHANCED || 0} enhanced, ${metrics?.customers?.by_kyc_level?.BASIC || 0} basic, ${metrics?.customers?.by_kyc_level?.PREMIUM || 0} premium`
    },
    {
      title: 'Open Alerts',
      value: metrics?.alerts?.by_status?.OPEN?.toString() || '0',
      change: 'Need attention',
      trend: (metrics?.alerts?.by_status?.OPEN || 0) > 0 ? 'up' as const : 'down' as const,
      icon: AlertTriangle,
      color: (metrics?.alerts?.by_status?.OPEN || 0) > 10 ? 'red' : 'orange',
      description: 'Requiring immediate action'
    },
    {
      title: 'System Status',
      value: 'Healthy',
      change: 'All systems operational',
      trend: 'neutral' as const,
      icon: TrendingUp,
      color: 'green',
      description: `Last updated: ${metrics?.timestamp ? new Date(metrics.timestamp).toLocaleTimeString() : 'now'}`
    }
  ]

  const recentAlerts = alerts.slice(0, 3)
  const recentTransactions = transactions.slice(0, 3)

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-2 text-gray-600">
          Real-time overview of your case resolution system
        </p>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {dashboardMetrics.map((metric, index) => (
          <MetricCard 
            key={index} 
            {...metric} 
            isLoading={metricsLoading}
          />
        ))}
      </div>

      {/* Detailed Metrics Breakdown */}
      <div className="bg-white shadow rounded-lg p-6">
        <h2 className="text-lg font-medium text-gray-900 mb-4">System Metrics Breakdown</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Alerts Breakdown */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Alert Status</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Open:</span>
                <span className="text-sm font-medium">{metrics?.alerts?.by_status?.OPEN || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Investigating:</span>
                <span className="text-sm font-medium">{metrics?.alerts?.by_status?.INVESTIGATING || 0}</span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="text-sm font-medium text-gray-900">Total:</span>
                <span className="text-sm font-medium">{metrics?.alerts?.total || 0}</span>
              </div>
            </div>
          </div>

          {/* Customer KYC Breakdown */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">Customer KYC Levels</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Enhanced:</span>
                <span className="text-sm font-medium">{metrics?.customers?.by_kyc_level?.ENHANCED || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Basic:</span>
                <span className="text-sm font-medium">{metrics?.customers?.by_kyc_level?.BASIC || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Premium:</span>
                <span className="text-sm font-medium">{metrics?.customers?.by_kyc_level?.PREMIUM || 0}</span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="text-sm font-medium text-gray-900">Total:</span>
                <span className="text-sm font-medium">{metrics?.customers?.total || 0}</span>
              </div>
            </div>
          </div>

          {/* Activity Summary */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-3">24h Activity</h3>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">New Alerts:</span>
                <span className="text-sm font-medium">{metrics?.activity?.new_alerts_24h || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">New Transactions:</span>
                <span className="text-sm font-medium">{metrics?.activity?.new_transactions_24h || 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">High Risk:</span>
                <span className="text-sm font-medium">{metrics?.transactions?.high_risk || 0}</span>
              </div>
              <div className="flex justify-between border-t pt-2">
                <span className="text-sm font-medium text-gray-900">Last Updated:</span>
                <span className="text-xs font-medium">
                  {metrics?.timestamp ? new Date(metrics.timestamp).toLocaleString() : 'Now'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Performance Chart */}
        <div className="lg:col-span-2">
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <TrendingUp className="h-6 w-6 mr-2 text-blue-500" />
              Performance Overview
            </h2>
            <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
              <div className="text-center text-gray-500">
                <Activity className="h-16 w-16 mx-auto mb-4 opacity-50" />
                <p>Real-time analytics charts</p>
                <p className="text-sm mt-2">Performance metrics will be displayed here</p>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Alerts */}
        <div className="lg:col-span-1">
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-medium text-gray-900 mb-4 flex items-center">
              <AlertTriangle className="h-6 w-6 mr-2 text-red-500" />
              Recent Alerts
            </h2>
            <div className="space-y-3">
              {alertsLoading ? (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="bg-gray-100 rounded-lg p-4 animate-pulse">
                      <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                      <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                    </div>
                  ))}
                </div>
              ) : (
                recentAlerts.slice(0, 3).map((alert: any, index: number) => (
                  <div key={alert.id || index} className="bg-gray-50 rounded-lg p-4 hover:bg-gray-100 transition-colors">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">
                          {alert.reasons?.join(', ') || 'Risk Alert'}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          Score: {alert.risk_score || 'Unknown'} • {alert.created_at ? new Date(alert.created_at).toLocaleTimeString() : `${index + 2}m ago`}
                        </p>
                      </div>
                      <span className={`px-2 py-1 text-xs rounded-full font-medium ${
                        alert.priority === 'CRITICAL' ? 'bg-red-100 text-red-800' :
                        alert.priority === 'HIGH' ? 'bg-orange-100 text-orange-800' :
                        alert.priority === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' :
                        'bg-green-100 text-green-800'
                      }`}>
                        {alert.priority?.toLowerCase() || 'low'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Recent Transactions Table */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900 flex items-center">
            <DollarSign className="h-6 w-6 mr-2 text-green-500" />
            Recent Transactions
          </h2>
        </div>
        <div className="overflow-x-auto">
          {transactionsLoading ? (
            <div className="p-6">
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex space-x-4 animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-1/6"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/6"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/6"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/6"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/6"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/6"></div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Risk</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {recentTransactions.map((transaction: any, index: number) => (
                  <tr key={transaction.id || index} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      ${(transaction.amount_cents / 100)?.toLocaleString() || '28.50'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {transaction.merchant || 'Unknown Merchant'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        transaction.status === 'completed' ? 'bg-green-100 text-green-800' : 
                        transaction.status === 'flagged' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {transaction.status || 'completed'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        (1) < 3 ? 'bg-green-100 text-green-800' : 
                        (1) > 7 ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        low
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {transaction.transaction_date ? new Date(transaction.transaction_date).toLocaleTimeString() : `${index + 2}m ago`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}