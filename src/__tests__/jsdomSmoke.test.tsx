// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

afterEach(cleanup)

it('renders a React element under jsdom', () => {
  render(<button type="button">Fly</button>)
  expect(screen.getByRole('button', { name: 'Fly' })).toBeTruthy()
  expect(document.body.textContent).toContain('Fly')
})
