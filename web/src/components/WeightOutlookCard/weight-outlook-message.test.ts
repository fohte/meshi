import { describe, expect, it } from 'vitest'

import { getWeightOutlookMessage } from '#components/WeightOutlookCard/weight-outlook-message'

describe('getWeightOutlookMessage', () => {
  it.each([
    [
      'insufficient_data',
      'first_measurement_too_recent',
      null,
      '記録を始めたばかりです。もう少し続けると見通しを表示できます。',
    ],
    [
      'insufficient_data',
      'too_few_measurement_days',
      null,
      '直近 4 週間の記録がまだ十分ではありません。',
    ],
    [
      'insufficient_data',
      'measurement_gap',
      null,
      '直近 4 週間の記録に空きがあります。週 2 日以上の記録がそろうと見通しを表示できます。',
    ],
    [
      'no_goal',
      null,
      null,
      '目標体重を設定すると、到達の見通しを確認できます。',
    ],
    ['reached', null, null, '現在のトレンドでは、目標体重に到達しています。'],
    [
      'not_approaching',
      null,
      null,
      '現在のトレンドでは、目標体重に近づいていません。',
    ],
    [
      'no_arrival_estimate',
      null,
      null,
      '今のペースでは 12 週間以内の到達時期を見積もれません。',
    ],
    [
      'arrival_estimate',
      null,
      { from: '2093-04-09', to: '2093-04-21' },
      '今のペースが続けば、目標体重への到達時期は 2093年4月9日〜2093年4月21日 ごろです。未検証の目安です。',
    ],
  ] as const)(
    'returns the message for %s',
    (status, reason, arrivalDateRange, expected) => {
      expect(
        getWeightOutlookMessage({ status, reason, arrivalDateRange }),
      ).toBe(expected)
    },
  )
})
