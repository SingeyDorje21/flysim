import { Component, type ReactNode } from 'react'
import { useGameStore } from '../state/gameStore'

interface State {
  error: Error | null
}

/** Keeps the menus usable if WebGL or the scene fails to start. */
export class CanvasErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error): void {
    console.error('3D view failed:', error)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div
        role="alert"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'grid',
          placeContent: 'center',
          gap: 12,
          textAlign: 'center',
          zIndex: 50,
          background: 'var(--bg)',
        }}
      >
        <h2 style={{ margin: 0 }}>The 3D view could not start</h2>
        <p style={{ margin: 0, color: 'var(--text-dim)' }}>{this.state.error.message}</p>
        <button
          type="button"
          onClick={() => {
            this.setState({ error: null })
            useGameStore.getState().quitToMenu()
          }}
        >
          Back to menu
        </button>
      </div>
    )
  }
}
