import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { GoalWeightSection } from '#pages/settings/GoalWeightSection'
import { performAct, setInputValue } from '#test/test-helpers'

afterEach(() => {
  vi.unstubAllGlobals()
})

const setup = async (
  goalWeightKg: number | null,
  events: Array<string>,
): Promise<{ container: HTMLDivElement; root: Root }> => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)

  await performAct(() => {
    root.render(
      <GoalWeightSection
        goalWeightKg={goalWeightKg}
        onSave={(value) => {
          events.push(`save:${String(value)}`)
        }}
        onClear={() => {
          events.push('clear')
        }}
      />,
    )
  })

  return { container, root }
}

const cleanup = async (
  container: HTMLDivElement,
  root: Root,
): Promise<void> => {
  await performAct(() => {
    root.unmount()
  })
  container.remove()
}

const readValidationOutput = (
  container: HTMLElement,
  events: ReadonlyArray<string>,
) => ({
  saveDisabled: container.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  )?.disabled,
  error: container.querySelector('[role="alert"]')?.textContent,
  events,
})

describe('GoalWeightSection', () => {
  it('saves an entered goal weight', async () => {
    const events: Array<string> = []
    const { container, root } = await setup(null, events)

    try {
      const input = container.querySelector<HTMLInputElement>('#goal-weight-kg')
      if (input !== null) await setInputValue(input, '64.25')
      await performAct(() => {
        container.querySelector<HTMLFormElement>('form')?.requestSubmit()
      })

      expect(events).toEqual(['save:64.25'])
    } finally {
      await cleanup(container, root)
    }
  })

  it('clears a saved goal weight', async () => {
    const events: Array<string> = []
    const { container, root } = await setup(64.25, events)

    try {
      await performAct(() => {
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent === '削除')
          ?.click()
      })

      expect(events).toEqual(['clear'])
    } finally {
      await cleanup(container, root)
    }
  })

  it('rejects values outside the supported range or precision', async () => {
    const events: Array<string> = []
    const { container, root } = await setup(null, events)

    try {
      const input = container.querySelector<HTMLInputElement>('#goal-weight-kg')
      if (input !== null) await setInputValue(input, '19.999')

      expect(readValidationOutput(container, events)).toEqual({
        saveDisabled: true,
        error: '20〜300 kg の範囲で、小数点以下 2 桁まで入力してください。',
        events: [],
      })
    } finally {
      await cleanup(container, root)
    }
  })
})
