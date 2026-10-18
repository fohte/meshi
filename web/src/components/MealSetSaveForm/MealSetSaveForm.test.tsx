import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MealSetSaveForm } from '#components/MealSetSaveForm/MealSetSaveForm'

afterEach(() => {
  vi.unstubAllGlobals()
})

const performAct = (callback: () => void): Promise<void> =>
  act(async () => {
    callback()
    await Promise.resolve()
  })

const setName = async (input: HTMLInputElement, value: string): Promise<void> =>
  performAct(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set?.bind(input)
    if (setter !== undefined) setter(value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

const readFormErrorOutput = (container: HTMLElement) => ({
  title: container.querySelector('h3')?.textContent,
  error: container.querySelector('[role="alert"]')?.textContent,
  status: container.querySelector('[role="status"]')?.textContent,
  saveDisabled: container.querySelector<HTMLButtonElement>(
    'button[type="submit"]',
  )?.disabled,
})

const readSubmissionOutput = (name: string, events: ReadonlyArray<string>) => ({
  name,
  events,
})

describe('MealSetSaveForm', () => {
  it('submits the entered name and cancels the form', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const events: Array<string> = []
    let name = ''
    const render = (): void => {
      root.render(
        <MealSetSaveForm
          id="meal-set-save-breakfast"
          mealLabel="朝食"
          name={name}
          onNameChange={(value) => {
            name = value
            events.push(`name:${value}`)
          }}
          onSave={() => {
            events.push(`save:${name}`)
          }}
          onCancel={() => {
            events.push('cancel')
          }}
        />,
      )
    }

    try {
      await performAct(render)
      const input = container.querySelector<HTMLInputElement>(
        '#meal-set-save-breakfast-name',
      )
      if (input !== null) await setName(input, 'テストセット_001')
      await performAct(render)
      await performAct(() => {
        container
          .querySelector<HTMLFormElement>('form')
          ?.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
          )
      })
      await performAct(() => {
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent === 'キャンセル')
          ?.click()
      })

      expect(readSubmissionOutput(name, events)).toEqual({
        name: 'テストセット_001',
        events: ['name:テストセット_001', 'save:テストセット_001', 'cancel'],
      })
    } finally {
      await performAct(() => {
        root.unmount()
      })
      container.remove()
    }
  })

  it('shows the API error reason', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root: Root = createRoot(container)

    try {
      await performAct(() => {
        root.render(
          <MealSetSaveForm
            id="meal-set-save-breakfast"
            mealLabel="朝食"
            name="テストセット_001"
            error="meal_set with name already exists: テストセット_001"
            onNameChange={() => undefined}
            onSave={() => undefined}
            onCancel={() => undefined}
          />,
        )
      })

      expect(readFormErrorOutput(container)).toEqual({
        title: '朝食をマイセットとして保存',
        error:
          '保存できませんでした: meal_set with name already exists: テストセット_001',
        status: undefined,
        saveDisabled: false,
      })
    } finally {
      await performAct(() => {
        root.unmount()
      })
      container.remove()
    }
  })
})
