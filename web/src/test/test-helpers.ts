import { act } from 'react'

export const performAct = (callback: () => void): Promise<void> =>
  act(async () => {
    callback()
    await Promise.resolve()
  })

export const setInputValue = async (
  input: HTMLInputElement,
  value: string,
): Promise<void> =>
  performAct(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set?.bind(input)
    if (setter !== undefined) setter(value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
