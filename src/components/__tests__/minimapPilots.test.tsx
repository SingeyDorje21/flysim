// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { remotePoses, useMultiplayerStore } from '../../state/multiplayerStore'
import { Minimap } from '../Minimap'

afterEach(() => {
  cleanup()
  remotePoses.clear()
  useMultiplayerStore.setState({ roster: [], myId: null })
})

describe('minimap pilots', () => {
  it('draws no other pilots in single player', () => {
    const { container } = render(<Minimap />)
    expect(container.querySelectorAll('.mm-other')).toHaveLength(0)
  })

  it('draws a dot for each other pilot in the room, marking crashed ones', () => {
    useMultiplayerStore.setState({
      myId: 'p1',
      roster: [
        { id: 'p1', name: 'Ace', aircraftId: 'trainer', slot: 0 },
        { id: 'p2', name: 'Bee', aircraftId: 'trainer', slot: 1 },
      ],
    })
    remotePoses.ingest(
      {
        t: 'snapshot',
        time: performance.now(),
        players: [
          {
            id: 'p2',
            p: { x: 500, y: 300, z: 0 },
            q: { x: 0, y: 0, z: 0, w: 1 },
            v: { x: 0, y: 0, z: 0 },
            onGround: false,
            crashed: true,
          },
        ],
      },
      performance.now(),
    )
    render(<Minimap />)
    const dot = screen.getByTestId('minimap-pilot-Bee')
    expect(dot.getAttribute('class')).toContain('crashed')
    expect(screen.queryByTestId('minimap-pilot-Ace')).toBeNull()
  })
})
