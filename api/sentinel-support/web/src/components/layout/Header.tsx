import { Menu, Bell, Search, User, LogOut } from 'lucide-react'
import { useState } from 'react'

interface HeaderProps {
  onMenuClick: () => void
}

export default function Header({ onMenuClick }: HeaderProps) {
  const [showNotifications, setShowNotifications] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)

  return (
    <div className="relative z-10 flex-shrink-0 flex h-16 bg-white shadow border-b border-gray-200">
      {/* Mobile menu button */}
      <button
        type="button"
        className="px-4 border-r border-gray-200 text-gray-500 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 md:hidden"
        onClick={onMenuClick}
      >
        <span className="sr-only">Open sidebar</span>
        <Menu className="h-6 w-6" />
      </button>

      <div className="flex-1 px-4 flex justify-between items-center">
        {/* Search bar */}
        <div className="flex-1 flex">
          <div className="w-full flex md:ml-0">
            <label htmlFor="search-field" className="sr-only">
              Search
            </label>
            <div className="relative w-full text-gray-400 focus-within:text-gray-600">
              <div className="absolute inset-y-0 left-0 flex items-center pointer-events-none">
                <Search className="h-5 w-5" />
              </div>
              <input
                id="search-field"
                className="block w-full h-full pl-8 pr-3 py-2 border-transparent bg-transparent text-gray-900 placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-0 focus:border-transparent"
                placeholder="Search transactions, customers, alerts..."
                type="search"
                name="search"
              />
            </div>
          </div>
        </div>

        {/* Right side */}
        <div className="ml-4 flex items-center md:ml-6 space-x-2">
          {/* Notifications */}
          <div className="relative">
            <button
              type="button"
              className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors"
              onClick={() => setShowNotifications(!showNotifications)}
            >
              <span className="sr-only">View notifications</span>
              <Bell className="h-5 w-5" />
              {/* Notification badge */}
              <span className="absolute -top-1 -right-1 h-4 w-4 bg-red-500 rounded-full flex items-center justify-center">
                <span className="text-xs font-medium text-white">3</span>
              </span>
            </button>

            {/* Notifications dropdown */}
            {showNotifications && (
              <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl ring-1 ring-black/5 focus:outline-none z-50">
                <div className="p-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-900">Notifications</h3>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <div className="p-4 text-sm text-gray-700 border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <div className="font-medium">High-risk transaction detected</div>
                    <div className="text-gray-500 mt-1">Customer ID: 12345 - $5,000 transfer</div>
                    <div className="text-xs text-gray-400 mt-2">2 minutes ago</div>
                  </div>
                  <div className="p-4 text-sm text-gray-700 border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <div className="font-medium">Card fraud alert</div>
                    <div className="text-gray-500 mt-1">Multiple failed attempts detected</div>
                    <div className="text-xs text-gray-400 mt-2">5 minutes ago</div>
                  </div>
                  <div className="p-4 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
                    <div className="font-medium">System maintenance scheduled</div>
                    <div className="text-gray-500 mt-1">Downtime: 2AM - 4AM EST</div>
                    <div className="text-xs text-gray-400 mt-2">1 hour ago</div>
                  </div>
                </div>
                <div className="p-4 border-t border-gray-200/50 dark:border-gray-700/50">
                  <button className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-500 dark:hover:text-primary-300 font-medium transition-colors">
                    View all notifications
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* User menu */}
          <div className="relative">
            <div>
              <button
                type="button"
                className="max-w-xs rounded-full flex items-center text-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 hover:bg-gray-100 transition-colors p-1"
                onClick={() => setShowUserMenu(!showUserMenu)}
              >
                <span className="sr-only">Open user menu</span>
                <div className="h-8 w-8 rounded-full bg-primary-500 flex items-center justify-center">
                  <User className="h-4 w-4 text-white" />
                </div>
                <span className="ml-2 text-sm font-medium text-gray-700 hidden md:block">
                  Sarah Chen
                </span>
              </button>
            </div>

            {/* User dropdown */}
            {showUserMenu && (
              <div className="origin-top-right absolute right-0 mt-2 w-48 rounded-xl shadow-xl bg-white ring-1 ring-black/5 focus:outline-none z-50">
                <div className="py-1">
                  <div className="px-4 py-3 text-sm text-gray-700 border-b border-gray-100">
                    <div className="font-medium">Sarah Chen</div>
                    <div className="text-gray-500">Senior Agent</div>
                  </div>
                  <button className="group flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 w-full text-left transition-colors">
                    <User className="mr-3 h-4 w-4 text-gray-400 group-hover:text-gray-500" />
                    Your Profile
                  </button>
                  <button className="group flex items-center px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 w-full text-left transition-colors">
                    <LogOut className="mr-3 h-4 w-4 text-gray-400 group-hover:text-gray-500" />
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}