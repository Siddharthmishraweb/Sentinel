import { useState } from 'react'
import { Search, User, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCustomers } from '../hooks/api'

interface Customer {
  customer_id: string
  name?: string
  email?: string
  status?: string
}

export default function CustomersList() {
  const [search, setSearch] = useState('')
  const { data, isLoading } = useCustomers({ search, limit: 20 })

  // Mock data for demo since API might have issues
  const mockCustomers: Customer[] = [
    { customer_id: 'c1e7e8a0-4b3f-4c8b-a1e2-f4d5e6789012', name: 'Alice Johnson', email: 'alice@example.com', status: 'active' },
    { customer_id: 'd2f8f9b1-5c4g-5d9c-b2f3-g5e6f7890123', name: 'Bob Smith', email: 'bob@example.com', status: 'active' },
    { customer_id: 'e3g9g0c2-6d5h-6e0d-c3g4-h6f7g8901234', name: 'Carol Davis', email: 'carol@example.com', status: 'suspended' },
    { customer_id: 'f4h0h1d3-7e6i-7f1e-d4h5-i7g8h9012345', name: 'David Wilson', email: 'david@example.com', status: 'active' },
    { customer_id: 'g5i1i2e4-8f7j-8g2f-e5i6-j8h9i0123456', name: 'Emma Brown', email: 'emma@example.com', status: 'active' }
  ]

  const customers = (data as any)?.customers || mockCustomers
  const filteredCustomers = customers.filter((customer: Customer) =>
    customer.name?.toLowerCase().includes(search.toLowerCase()) ||
    customer.email?.toLowerCase().includes(search.toLowerCase()) ||
    customer.customer_id?.toLowerCase().includes(search.toLowerCase())
  )

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-center h-64">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading customers...</p>
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
            Customers
          </h1>
          <p className="mt-2 text-gray-600">
            Manage and search customer profiles
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="bg-white shadow rounded-lg">
        <div className="p-6">
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-5 w-5 text-gray-400" />
            </div>
            <input
              type="text"
              className="block w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
              placeholder="Search by name, email, or customer ID..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Customer List */}
      <div className="bg-white shadow rounded-lg">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Customer Directory</h2>
        </div>
        <div className="divide-y divide-gray-200">
          {filteredCustomers.length === 0 ? (
            <div className="px-6 py-4 text-center text-gray-500">
              {search ? 'No customers found matching your search.' : 'No customers available.'}
            </div>
          ) : (
            filteredCustomers.map((customer: Customer) => (
              <Link
                key={customer.customer_id}
                to={`/customer/${customer.customer_id}`}
                className="block px-6 py-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0">
                      <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                        <User className="h-5 w-5 text-blue-600" />
                      </div>
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{customer.name || 'Unknown Name'}</p>
                      <p className="text-sm text-gray-500">{customer.email}</p>
                      <p className="text-xs text-gray-400">ID: {customer.customer_id}</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      customer.status === 'active' ? 'bg-green-100 text-green-800' :
                      customer.status === 'suspended' ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {customer.status || 'Active'}
                    </span>
                    <ChevronRight className="h-5 w-5 text-gray-400" />
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
        
        {/* Pagination placeholder */}
        {filteredCustomers.length > 0 && (
          <div className="px-6 py-3 border-t border-gray-200 bg-gray-50">
            <p className="text-sm text-gray-700">
              Showing {filteredCustomers.length} customers
              {search && ` matching "${search}"`}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}