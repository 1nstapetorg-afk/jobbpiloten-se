'use client'

import React from 'react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="max-w-md w-full bg-white rounded-xl shadow-sm border border-slate-200 p-6 text-center">
            <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">⚠️</span>
            </div>
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Något gick fel</h2>
            <p className="text-sm text-slate-600 mb-4">
              Vi ber om ursäkt för problemet. Försök ladda om sidan.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm hover:bg-slate-800"
            >
              Ladda om sidan
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}