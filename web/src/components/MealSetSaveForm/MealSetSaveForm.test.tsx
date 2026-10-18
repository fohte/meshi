import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { MealSetSaveForm } from '#components/MealSetSaveForm/MealSetSaveForm'
import { performAct, setInputValue } from '#test/test-helpers'

afterEach(() => {
  vi.unstubAllGlobals()
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
  it('submits the entered name', async () => {
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
      if (input !== null) await setInputValue(input, 'テストセット_001')
      await performAct(render)
      await performAct(() => {
        container
          .querySelector<HTMLFormElement>('form')
          ?.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
          )
      })
      expect(readSubmissionOutput(name, events)).toEqual({
        name: 'テストセット_001',
        events: ['name:テストセット_001', 'save:テストセット_001'],
      })
    } finally {
      await performAct(() => {
        root.unmount()
      })
      container.remove()
    }
  })

  it('cancels the form', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root: Root = createRoot(container)
    const events: Array<string> = []

    try {
      await performAct(() => {
        root.render(
          <MealSetSaveForm
            id="meal-set-save-breakfast"
            mealLabel="朝食"
            name=""
            onNameChange={() => undefined}
            onSave={() => undefined}
            onCancel={() => {
              events.push('cancel')
            }}
          />,
        )
      })
      await performAct(() => {
        Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent === 'キャンセル')
          ?.click()
      })

      expect(events).toEqual(['cancel'])
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
