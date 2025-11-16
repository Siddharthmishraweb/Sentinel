import { useState, useMemo, useRef } from 'react'
import { Search, RefreshCw, Clock, AlertTriangle, User, CheckCircle, XCircle } from 'lucide-react'
import { useAlerts } from '../hooks/api'
import TriageDrawer from '../components/TriageDrawer'
import { useVirtualizer } from '@tanstack/react-virtual'
// Virtualized alerts list card component
function AlertCard({ alert, onSelect, isSelected }: { alert: any; onSelect: () => void; isSelected: boolean }) {
  const priorityClasses: Record<string,string> = {
    CRITICAL: 'ring-red-300',
    HIGH: 'ring-orange-300',
    MEDIUM: 'ring-yellow-300',
    LOW: 'ring-blue-300'
  }
  const statusIcons = {
    OPEN: AlertTriangle,
    INVESTIGATING: User,
    RESOLVED: CheckCircle,
    CLOSED: XCircle
  }
  const StatusIcon = statusIcons[alert.status as keyof typeof statusIcons] || AlertTriangle
  return (
    <div
      className={`bg-white rounded-lg shadow border border-gray-200 cursor-pointer hover:shadow-md transition-shadow ${isSelected ? 'ring-2 '+(priorityClasses[alert.priority]||'ring-primary-400') : ''}`}
      onClick={onSelect}
    >
      <div className="p-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start space-x-3">
            <div className="p-2 rounded-lg bg-gray-100">
              <StatusIcon className="h-5 w-5 text-gray-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 mb-1">{alert.title || alert.description}</h3>
              <p className="text-gray-600 text-sm line-clamp-2">{alert.description}</p>
            </div>
          </div>
          <span className={`px-3 py-1 text-xs font-medium rounded-full ${
            alert.priority === 'CRITICAL' ? 'bg-red-100 text-red-800' :
            alert.priority === 'HIGH' ? 'bg-orange-100 text-orange-800' :
            alert.priority === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' : 'bg-blue-100 text-blue-800'
          }`}>{alert.priority?.toLowerCase() || 'unknown'}</span>
        </div>
        <div className="flex items-center justify-between text-sm text-gray-500">
          <div className="flex items-center space-x-4">
            <span className="flex items-center"><User className="h-4 w-4 mr-1" />Customer: {alert.customer_id}</span>
            <span className="flex items-center"><Clock className="h-4 w-4 mr-1" />{alert.created_at ? new Date(alert.created_at).toLocaleTimeString() : 'Just now'}</span>
          </div>
          {alert.assigned_agent && <span className="text-xs bg-gray-100 rounded-full px-2 py-1">Assigned: {alert.assigned_agent}</span>}
        </div>
      </div>
    </div>
  )
}
export default function AlertsQueue() {
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedAlert, setSelectedAlert] = useState<string | null>(null)
  const [showHeroTriage, setShowHeroTriage] = useState(false)
  const [filterPriority, setFilterPriority] = useState<string>('all')
  const [filterType, setFilterType] = useState<string>('all')

  const { data: alertsData, isLoading, refetch } = useAlerts()
  const alerts = alertsData?.data || []
  const selectedAlertData = alerts.find((alert: any) => alert.id === selectedAlert)

  const filteredAlerts = useMemo(() => {
    return alerts.filter((alert: any) => {
      const matchesSearch = searchTerm === '' ||
        (alert.title || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (alert.customer_id || '').toString().includes(searchTerm) ||
        (alert.description || '').toLowerCase().includes(searchTerm.toLowerCase())
      const matchesPriority = filterPriority === 'all' || alert.priority === filterPriority
      const matchesType = filterType === 'all' || alert.type === filterType
      return matchesSearch && matchesPriority && matchesType
    })
  }, [alerts, searchTerm, filterPriority, filterType])

  const priorityOptions = [
    { value: 'all', label: 'All Priorities' },
    { value: 'CRITICAL', label: 'Critical' },
    { value: 'HIGH', label: 'High' },
    { value: 'MEDIUM', label: 'Medium' },
    { value: 'LOW', label: 'Low' }
  ]

  const typeOptions = [
    { value: 'all', label: 'All Types' },
    { value: 'fraud', label: 'Fraud' },
    { value: 'account', label: 'Account' },
    { value: 'transaction', label: 'Transaction' },
    { value: 'compliance', label: 'Compliance' }
  ]

  // Virtualization only if large list (> 40 alerts)
  const shouldVirtualize = filteredAlerts.length > 40
  const parentRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? filteredAlerts.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 240,
    overscan: 8,
    enabled: shouldVirtualize
  })

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900 flex items-center">
          <AlertTriangle className="h-8 w-8 mr-3 text-red-500" />
          Alerts Queue
        </h1>
        <p className="mt-2 text-gray-600">Monitor and triage critical system alerts in real-time</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6 text-center">
          <AlertTriangle className="h-12 w-12 mx-auto text-red-500 mb-3" />
          <div className="text-3xl font-bold text-gray-900 mb-1">{alerts.filter((a: any) => a.priority === 'CRITICAL').length}</div>
          <p className="text-gray-600">Critical Alerts</p>
        </div>
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6 text-center">
          <Clock className="h-12 w-12 mx-auto text-orange-500 mb-3" />
          <div className="text-3xl font-bold text-gray-900 mb-1">{alerts.filter((a: any) => a.priority === 'HIGH').length}</div>
          <p className="text-gray-600">High Priority</p>
        </div>
        <div className="bg-white rounded-lg shadow border border-gray-200 p-6 text-center">
          <User className="h-12 w-12 mx-auto text-blue-500 mb-3" />
          <div className="text-3xl font-bold text-gray-900 mb-1">{alerts.filter((a: any) => a.assigned_agent).length}</div>
          <p className="text-gray-600">Assigned</p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-white shadow rounded-lg border border-gray-200">
        <div className="p-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0 lg:space-x-4">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-5 w-5" />
                <input
                  type="text"
                  placeholder="Search alerts..."
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent bg-white text-gray-900"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
            <div className="flex space-x-3">
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white text-gray-900"
              >
                {priorityOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 bg-white text-gray-900"
              >
                {typeOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <button
                onClick={() => refetch()}
                className="btn-secondary flex items-center space-x-2"
                disabled={isLoading}
              >
                <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Alerts list */}
      <div className="space-y-4">
        {isLoading ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[1,2,3,4].map(i => (
              <div key={i} className="bg-white rounded-lg shadow border border-gray-200 animate-pulse">
                <div className="p-6 space-y-4">
                  <div className="h-6 bg-gray-200 rounded w-3/4" />
                  <div className="h-4 bg-gray-200 rounded w-full" />
                  <div className="h-4 bg-gray-200 rounded w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : filteredAlerts.length === 0 ? (
          <div className="bg-white rounded-lg shadow border border-gray-200">
            <div className="p-12 text-center">
              <AlertTriangle className="h-16 w-16 mx-auto text-gray-400 mb-4" />
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No alerts found</h3>
              <p className="text-gray-600">{searchTerm || filterPriority !== 'all' || filterType !== 'all' ? 'Try adjusting your filters to see more alerts.' : 'All quiet! No active alerts at the moment.'}</p>
            </div>
          </div>
        ) : shouldVirtualize ? (
          <div ref={parentRef} className="h-[900px] overflow-auto" aria-label="Virtualized alerts list">
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map(vItem => {
                const alert = filteredAlerts[vItem.index]
                return (
                  <div
                    key={alert.id}
                    data-index={vItem.index}
                    ref={virtualizer.measureElement}
                    style={{ position:'absolute', top:0, left:0, width:'100%', transform:`translateY(${vItem.start}px)` }}
                  >
                    <AlertCard
                      alert={alert}
                      isSelected={selectedAlert === alert.id}
                      onSelect={() => { setSelectedAlert(alert.id); setShowHeroTriage(true) }}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {filteredAlerts.map((alert: any) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                isSelected={selectedAlert === alert.id}
                onSelect={() => { setSelectedAlert(alert.id); setShowHeroTriage(true) }}
              />
            ))}
          </div>
        )}
      </div>

      {/* AI Triage Drawer */}
      {showHeroTriage && selectedAlertData && (
        <TriageDrawer
          isOpen={showHeroTriage}
          alert={selectedAlertData}
          onClose={() => { setShowHeroTriage(false); setSelectedAlert(null) }}
        />
      )}
    </div>
  )
}