'use client'

/**
 * Error boundary minimo y reutilizable. React no captura errores de render de
 * los hijos sin un boundary de clase; sin esto, un fallo (p.ej. Excalidraw al
 * montar un embed) tumba TODO el arbol padre (el editor de la nota completo).
 * Aisla el fallo y muestra un fallback en su lugar.
 */
import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Fallback a mostrar si el hijo revienta. Puede depender de un retry(). */
  fallback: ReactNode | ((retry: () => void) => ReactNode)
  /** Callback opcional para telemetria/log. */
  onError?: (error: Error) => void
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error)
  }

  private retry = () => this.setState({ hasError: false })

  render() {
    if (this.state.hasError) {
      const { fallback } = this.props
      return typeof fallback === 'function' ? fallback(this.retry) : fallback
    }
    return this.props.children
  }
}
