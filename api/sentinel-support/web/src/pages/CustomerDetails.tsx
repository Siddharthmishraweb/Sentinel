import { useParams } from 'react-router-dom'
import { User, CreditCard, AlertTriangle, Activity } from 'lucide-react'
import { useCustomer, useTransactions, useCustomerInsightsSummary, useCustomerStats } from '../hooks/api'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useRef } from 'react'

export default function CustomerDetails() {
  const { customerId } = useParams()
  const customerIdNum = customerId ? parseInt(customerId, 10) : 0
  
  const { data: customer, isLoading: customerLoading, error: customerError } = useCustomer(customerIdNum)
  const { data: transactionsData, isLoading: transactionsLoading } = useTransactions({
    customer_id: customerIdNum,
    limit: 5
  })
  const { data: insightsSummary, isLoading: insightsLoading } = useCustomerInsightsSummary(customerIdNum, 90)
  const { data: customerStats, isLoading: statsLoading, error: statsError } = useCustomerStats(customerIdNum)

  const transactions = transactionsData?.data || []
  const tableParentRef = useRef<HTMLDivElement | null>(null)
  const shouldVirtualize = transactions.length > 100
  const rowVirtualizer = shouldVirtualize ? useVirtualizer({
    count: transactions.length,
    getScrollElement: () => tableParentRef.current,
    estimateSize: () => 52,
    overscan: 10
  }) : null

  if (customerLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading customer details...</p>
          </div>
        </div>
      </div>
    )
  }

  if (customerError || !customer) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="text-red-600 mb-4">
              <AlertTriangle className="h-12 w-12 mx-auto" />
            </div>
            <p className="text-gray-600">Customer not found or failed to load.</p>
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
            <User className="h-8 w-8 mr-3 text-blue-500" />
            Customer Details
          </h1>
          <p className="mt-2 text-gray-600">
            Customer ID: {customerId}
          </p>
        </div>
      </div>

      {/* Customer Info Card */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Customer Information</h2>
        </div>
        <div className="px-6 py-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Personal Details</h3>
              <dl className="mt-2 space-y-2">
                <div>
                  <dt className="text-sm font-medium text-gray-900">Full Name</dt>
                  <dd className="text-sm text-gray-600">{customer?.first_name} {customer?.last_name}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-900">Email</dt>
                  <dd className="text-sm text-gray-600">{customer?.email}</dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-900">Phone</dt>
                  <dd className="text-sm text-gray-600">{customer?.phone || 'N/A'}</dd>
                </div>
              </dl>
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Account Status</h3>
              <dl className="mt-2 space-y-2">
                <div>
                  <dt className="text-sm font-medium text-gray-900">Status</dt>
                  <dd className="text-sm">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${customer?.kyc_status === 'verified' ? 'bg-green-100 text-green-800' : customer?.kyc_status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                      {customer?.kyc_status === 'verified' ? 'Active' : customer?.kyc_status}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-900">Risk Level</dt>
                  <dd className="text-sm">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${customer?.risk_profile === 'low' ? 'bg-green-100 text-green-800' : customer?.risk_profile === 'medium' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'}`}>
                      {customer?.risk_profile?.charAt(0).toUpperCase() + customer?.risk_profile?.slice(1)}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-900">Customer Since</dt>
                  <dd className="text-sm text-gray-600">{customer?.created_at ? new Date(customer.created_at).toLocaleDateString() : '—'}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Stats (Dynamic) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <CreditCard className="h-8 w-8 text-blue-500" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Active Cards</p>
              <p className="text-2xl font-bold text-gray-900">
                {statsLoading ? '…' : statsError ? '—' : customerStats?.stats.active_cards ?? '0'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <Activity className="h-8 w-8 text-green-500" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Transactions</p>
              <p className="text-2xl font-bold text-gray-900">
                {statsLoading ? '…' : statsError ? '—' : customerStats?.stats.transaction_count ?? '0'}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <AlertTriangle className="h-8 w-8 text-red-500" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Open Alerts</p>
              <p className="text-2xl font-bold text-gray-900">
                {statsLoading ? '…' : statsError ? '—' : customerStats?.stats.open_alerts ?? '0'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Insights Summary */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-medium text-gray-900">Spending Insights (90d)</h2>
          {insightsLoading && <span className="text-xs text-gray-500">Loading...</span>}
        </div>
        {insightsSummary?.summary ? (
          <div className="px-6 py-4 space-y-6">
            {insightsSummary.summary.categories && insightsSummary.summary.categories.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Category Mix</h3>
                <div className="space-y-2">
                  {insightsSummary.summary.categories.slice(0,6).map(cat => (
                    <div key={cat.name} className="flex items-center justify-between text-sm">
                      <span>{cat.name}</span>
                      <div className="flex items-center space-x-2 w-2/3">
                        <div className="flex-1 h-2 bg-gray-100 rounded">
                          <div className="h-2 bg-primary-500 rounded" style={{ width: `${Math.min(cat.percentage,100)}%` }} />
                        </div>
                        <span className="w-12 text-right tabular-nums">{cat.percentage.toFixed(1)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {insightsSummary.summary.merchants && insightsSummary.summary.merchants.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Top Merchants</h3>
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 uppercase">
                      <th className="py-1 pr-4 text-left">Merchant</th>
                      <th className="py-1 pr-4 text-right">Spend</th>
                      <th className="py-1 pr-4 text-right">Txns</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {insightsSummary.summary.merchants.slice(0,5).map(m => (
                      <tr key={m.name}>
                        <td className="py-1 pr-4">{m.name}</td>
                        <td className="py-1 pr-4 text-right">${(m.total_spend/100).toFixed(2)}</td>
                        <td className="py-1 pr-4 text-right">{m.transaction_count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {insightsSummary.summary.anomalies && insightsSummary.summary.anomalies.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Recent Anomalies</h3>
                <ul className="space-y-1 text-sm">
                  {insightsSummary.summary.anomalies.slice(0,5).map(a => (
                    <li key={a.detected_at} className="flex items-start space-x-2">
                      <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5" />
                      <span>{a.type}: {a.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {insightsSummary.summary.totals && (
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Total Spend</p>
                  <p className="font-semibold">${(insightsSummary.summary.totals.total_spend/100).toFixed(2)}</p>
                </div>
                <div>
                  <p className="text-gray-500">Transactions</p>
                  <p className="font-semibold">{insightsSummary.summary.totals.transaction_count}</p>
                </div>
                <div>
                  <p className="text-gray-500">Avg Ticket</p>
                  <p className="font-semibold">${(insightsSummary.summary.totals.average_ticket/100).toFixed(2)}</p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="px-6 py-8 text-sm text-gray-500">{insightsLoading ? 'Loading insights...' : 'No insights available.'}</div>
        )}
      </div>

      {/* Recent Transactions */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Recent Transactions</h2>
        </div>
        <div ref={tableParentRef} className={shouldVirtualize ? 'max-h-[600px] overflow-auto' : ''}>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Merchant</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            {transactionsLoading ? (
              <tbody>
                <tr><td colSpan={4} className="px-6 py-4 text-center text-sm text-gray-500">Loading transactions...</td></tr>
              </tbody>
            ) : transactions.length === 0 ? (
              <tbody>
                <tr><td colSpan={4} className="px-6 py-4 text-center text-sm text-gray-500">No transactions found.</td></tr>
              </tbody>
            ) : shouldVirtualize && rowVirtualizer ? (
              <tbody style={{ position:'relative', height: rowVirtualizer.getTotalSize() }}>
                {rowVirtualizer.getVirtualItems().map(vRow => {
                  const tx = transactions[vRow.index]
                  return (
                    <tr
                      key={tx.id}
                      data-index={vRow.index}
                      ref={rowVirtualizer.measureElement}
                      style={{ position:'absolute', top:0, left:0, width:'100%', transform:`translateY(${vRow.start}px)` }}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{new Date(tx.transaction_date).toLocaleDateString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{tx.merchant}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{tx.currency} {(tx.amount_cents/100).toFixed(2)}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          tx.status === 'completed' ? 'bg-green-100 text-green-800' : tx.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                        }`}>{tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            ) : (
              <tbody className="bg-white divide-y divide-gray-200">
                {transactions.map(tx => (
                  <tr key={tx.id}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{new Date(tx.transaction_date).toLocaleDateString()}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{tx.merchant}</td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{tx.currency} {(tx.amount_cents/100).toFixed(2)}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        tx.status === 'completed' ? 'bg-green-100 text-green-800' : tx.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                      }`}>{tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}