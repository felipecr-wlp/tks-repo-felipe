'use client'

import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode; fallback?: ReactNode }

interface State { hasError: boolean }

export class FlowErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    // Solo capturar errores de DOM reconciliation (React 18 + @xyflow/react)
    if (error.name === 'NotFoundError' || error.message?.includes('insertBefore')) {
      return { hasError: true }
    }
    throw error
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex flex-col items-center justify-center h-full gap-4 p-8">
          <p className="text-sm text-muted-foreground">Ocurrió un error al cargar el editor.</p>
          <button
            onClick={() => { this.setState({ hasError: false }); window.location.reload() }}
            className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm hover:bg-primary/90"
          >
            Reintentar
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
