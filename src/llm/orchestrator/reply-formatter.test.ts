import { describe, expect, it } from 'vitest'

import { createTemplateReplyFormatter } from '@/llm/orchestrator/reply-formatter'

describe('createTemplateReplyFormatter', () => {
  const formatter = createTemplateReplyFormatter()

  describe('formatMealRecord', () => {
    it('summarizes a successful record with nutrition lines', () => {
      const text = formatter.formatMealRecord({
        recorded: [
          {
            mealLogId: 'log_1',
            foodMasterId: 'fm_rice',
            nutrition: { energy_kcal: 252, protein_g: 3.8 },
            isEstimated: false,
          },
        ],
        candidates: [],
        hasEstimatedValues: false,
        finalText: 'ignored',
        error: null,
      })

      expect(text).toEqual(
        ['記録しました (1 件)。', '- fm_rice: 252 kcal / P 3.8g'].join('\n'),
      )
    })

    it('adds an estimated-values note when has_estimated_values is true', () => {
      const text = formatter.formatMealRecord({
        recorded: [
          {
            mealLogId: 'log_1',
            foodMasterId: 'fm_curry',
            nutrition: { energy_kcal: 600 },
            isEstimated: true,
          },
        ],
        candidates: [],
        hasEstimatedValues: true,
        finalText: '',
        error: null,
      })

      expect(text).toEqual(
        [
          '記録しました (1 件)。',
          '- fm_curry: 600 kcal [推測値]',
          '※ 推測値が含まれています。値は目安としてご確認ください。',
        ].join('\n'),
      )
    })

    it('omits the nutrition tail when no displayable nutrient is available', () => {
      const text = formatter.formatMealRecord({
        recorded: [
          {
            mealLogId: 'log_1',
            foodMasterId: 'fm_water',
            nutrition: {},
            isEstimated: false,
          },
        ],
        candidates: [],
        hasEstimatedValues: false,
        finalText: '',
        error: null,
      })

      expect(text).toEqual(['記録しました (1 件)。', '- fm_water'].join('\n'))
    })

    it('lists candidates when nothing was recorded', () => {
      const text = formatter.formatMealRecord({
        recorded: [],
        candidates: [
          {
            foodMasterId: 'fm_apple',
            compositionCode: null,
            name: 'りんご',
            isEstimated: false,
            score: 0.9,
            reason: '名前一致',
          },
          {
            foodMasterId: null,
            compositionCode: 'C1',
            name: '青りんご',
            isEstimated: true,
            score: 0.5,
            reason: '推測補完',
          },
        ],
        hasEstimatedValues: false,
        finalText: '',
        error: null,
      })

      expect(text).toEqual(
        [
          '食品を一意に特定できませんでした。次の候補から選んで、もう一度入力してください。',
          '- りんご: 名前一致',
          '- 青りんご (推測値): 推測補完',
        ].join('\n'),
      )
    })

    it('emits a recoverable hint when interpretation fails', () => {
      const text = formatter.formatMealRecord({
        recorded: [],
        candidates: [],
        hasEstimatedValues: false,
        finalText: '',
        error: {
          kind: 'interpretation_failed',
          message: 'image decode failed',
        },
      })

      expect(text).toEqual(
        [
          '画像を解釈できませんでした。',
          '明るい場所で撮り直すか、テキストで食事内容を入力してください。',
          '詳細: image decode failed',
        ].join('\n'),
      )
    })

    it('explains divergence aborts', () => {
      const text = formatter.formatMealRecord({
        recorded: [],
        candidates: [],
        hasEstimatedValues: false,
        finalText: '',
        error: { kind: 'divergence_detected', message: 'dup tool call' },
      })

      expect(text).toEqual(
        [
          '内部処理で同じ操作が繰り返されたため中断しました。',
          '入力を変えてもう一度試してください。',
        ].join('\n'),
      )
    })

    it('explains max-turn aborts', () => {
      const text = formatter.formatMealRecord({
        recorded: [],
        candidates: [],
        hasEstimatedValues: false,
        finalText: '',
        error: { kind: 'max_turns_exceeded', message: 'too many turns' },
      })

      expect(text).toEqual(
        [
          '処理が長くなったため中断しました。',
          '入力を分けるか、もう少し短い表現で試してください。',
        ].join('\n'),
      )
    })

    it('falls back to a generic hint when nothing was recorded or proposed', () => {
      const text = formatter.formatMealRecord({
        recorded: [],
        candidates: [],
        hasEstimatedValues: false,
        finalText: '',
        error: null,
      })

      expect(text).toEqual(
        '記録できませんでした。食品名と量がわかる形でもう一度入力してください。',
      )
    })
  })

  describe('formatMealHistory', () => {
    it('summarizes an aggregate and notes estimated values', () => {
      const text = formatter.formatMealHistory({
        aggregate: {
          totals: { energy_kcal: 1800, protein_g: 70 },
          perDay: [
            { date: '2026-06-17', totals: { energy_kcal: 900 } },
            { date: '2026-06-18', totals: { energy_kcal: 900 } },
          ],
          entries: [
            {
              mealLogId: 'log_1',
              foodMasterId: 'fm_1',
              eatenAtIso: '2026-06-17T12:00:00Z',
              quantity: 1,
              unit: '杯',
              note: null,
            },
          ],
          hasEstimatedValues: true,
        },
        finalText: '',
        error: null,
      })

      expect(text).toEqual(
        [
          '集計結果:',
          '- 合計: 1800 kcal / P 70g',
          '- 期間内の日数: 2 日',
          '- 記録件数: 1 件',
          '※ 集計には推測値が含まれています。値は目安としてご確認ください。',
        ].join('\n'),
      )
    })

    it('falls back to the final text when no aggregate is available', () => {
      const text = formatter.formatMealHistory({
        aggregate: null,
        finalText: '該当する記録がありませんでした。',
        error: null,
      })

      expect(text).toEqual('該当する記録がありませんでした。')
    })

    it('emits an error reply when interpretation fails', () => {
      const text = formatter.formatMealHistory({
        aggregate: null,
        finalText: '',
        error: { kind: 'max_turns_exceeded', message: 'too many turns' },
      })

      expect(text).toEqual(
        [
          '処理が長くなったため中断しました。',
          '入力を分けるか、もう少し短い表現で試してください。',
        ].join('\n'),
      )
    })
  })

  describe('formatRecommend', () => {
    it('returns the final text on success', () => {
      const text = formatter.formatRecommend({
        finalText: 'サラダはいかがでしょう。',
        error: null,
      })

      expect(text).toEqual('サラダはいかがでしょう。')
    })

    it('returns the error reply when the loop diverges', () => {
      const text = formatter.formatRecommend({
        finalText: '',
        error: { kind: 'divergence_detected', message: 'dup tool call' },
      })

      expect(text).toEqual(
        [
          '内部処理で同じ操作が繰り返されたため中断しました。',
          '入力を変えてもう一度試してください。',
        ].join('\n'),
      )
    })

    it('falls back to a hint when the loop returns empty text', () => {
      const text = formatter.formatRecommend({
        finalText: '',
        error: null,
      })

      expect(text).toEqual(
        'おすすめを提案できませんでした。条件を変えて試してください。',
      )
    })
  })
})
