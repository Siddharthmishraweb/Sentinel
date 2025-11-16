import { NavLink, useLocation } from 'react-router-dom'
import { 
  BarChart3, 
  AlertTriangle, 
  Users, 
  CheckCircle2, 
  X,
  Shield,
  Activity
} from 'lucide-react'
import { cn } from '../../utils/cn'

interface SidebarProps {
  onClose?: () => void
}

const navigation = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: BarChart3,
    description: 'Overview and metrics'
  },
  {
    name: 'Alerts Queue',
    href: '/alerts',
    icon: AlertTriangle,
    description: 'Active cases requiring attention',
    badge: 12 // Active alerts count
  },
  {
    name: 'Customers',
    href: '/customers',
    icon: Users,
    description: 'Customer search and management'
  },
  {
    name: 'Evaluations',
    href: '/evals',
    icon: CheckCircle2,
    description: 'Model performance testing'
  }
]

export default function Sidebar({ onClose }: SidebarProps) {
  const location = useLocation()

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white border-r border-gray-200">
      {/* Logo and close button */}
      <div className="flex items-center h-16 flex-shrink-0 px-4 bg-white border-b border-gray-200">
        <div className="flex items-center space-x-3">
          <div className="flex-shrink-0">
            <div className="w-8 h-8 bg-gradient-to-br from-primary-600 to-primary-700 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Sentinel</h1>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Support</p>
          </div>
        </div>
        {onClose && (
          <button
            type="button"
            className="ml-auto md:hidden rounded-md p-2 inline-flex items-center justify-center text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500"
            onClick={onClose}
          >
            <span className="sr-only">Close sidebar</span>
            <X className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        <nav className="flex-1 px-2 py-4 space-y-1">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href
            return (
              <NavLink
                key={item.name}
                to={item.href}
                className={cn(
                  'group flex items-center px-2 py-2 text-sm font-medium rounded-md transition-colors',
                  isActive
                    ? 'bg-primary-50 border-r-2 border-primary-500 text-primary-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )}
              >
                <item.icon
                  className={cn(
                    'mr-3 flex-shrink-0 h-5 w-5',
                    isActive ? 'text-primary-500' : 'text-gray-400 group-hover:text-gray-500'
                  )}
                />
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span>{item.name}</span>
                    {item.badge && (
                      <span className={cn(
                        'ml-2 px-2 py-1 text-xs rounded-full',
                        isActive 
                          ? 'bg-primary-100 text-primary-700'
                          : 'bg-gray-100 text-gray-600 group-hover:bg-gray-200'
                      )}>
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <p className={cn(
                    'text-xs mt-1',
                    isActive ? 'text-primary-600' : 'text-gray-500'
                  )}>
                    {item.description}
                  </p>
                </div>
              </NavLink>
            )
          })}
        </nav>

        {/* Status section */}
        <div className="flex-shrink-0 border-t border-gray-200 p-4">
          <div className="flex items-center space-x-3">
            <div className="flex-shrink-0">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900">System Status</p>
              <div className="flex items-center space-x-2">
                <Activity className="w-3 h-3 text-green-500" />
                <p className="text-xs text-green-600">All systems operational</p>
              </div>
            </div>
          </div>

          {/* Quick stats */}
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-gray-500">Active Cases</div>
              <div className="font-semibold text-gray-900">23</div>
            </div>
            <div className="bg-gray-50 rounded-lg p-2">
              <div className="text-gray-500">Avg Response</div>
              <div className="font-semibold text-gray-900">1.2m</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}