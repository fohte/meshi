import { describe, expect, it } from 'vitest'

import { getWeightOutlookMessage } from '#components/WeightOutlookCard/weight-outlook-message'

describe('getWeightOutlookMessage', () => {
  it.each([
    [
      'insufficient_data',
      'first_measurement_too_recent',
      null,
      63.4,
      '最近記録を始めたため、見通しを表示するにはもう少し記録が必要です。',
    ],
    [
      'insufficient_data',
      'first_measurement_too_recent',
      null,
      null,
      '体重の記録がまだありません。',
    ],
    [
      'insufficient_data',
      'too_few_measurement_days',
      null,
      63.4,
      '直近の体重記録が足りません。',
    ],
    [
      'insufficient_data',
      'measurement_gap',
      null,
      63.4,
      '体重記録に空きがあります。継続して記録すると見通しを表示できます。',
    ],
    [
      'insufficient_data',
      null,
      null,
      63.4,
      '見通しを出すには、もう少し記録が必要です。',
    ],
    [
      'no_goal',
      null,
      null,
      63.4,
      '目標体重を設定すると、到達の見通しを確認できます。',
    ],
    [
      'reached',
      null,
      null,
      63.4,
      '現在のトレンドでは、目標体重に到達しています。',
    ],
    [
      'not_approaching',
      null,
      null,
      63.4,
      '現在のトレンドでは、目標体重に近づいていません。',
    ],
    [
      'no_arrival_estimate',
      null,
      null,
      63.4,
      '予測期間内の到達時期は見積もれません。',
    ],
    [
      'arrival_estimate',
      null,
      { from: '2093-04-09', to: '2093-04-21' },
      63.4,
      '今のペースが続けば、目標体重への到達時期は 2093年4月9日〜2093年4月21日 ごろです。未検証の目安です。',
    ],
    ['arrival_estimate', null, null, 63.4, '到達時期を見積もれません。'],
  ] as const)(
    'returns the message for %s',
    (status, reason, arrivalDateRange, latestWeightKg, expected) => {
      expect(
        getWeightOutlookMessage({
          status,
          reason,
          arrivalDateRange,
          latestWeightKg,
        }),
      ).toBe(expected)
    },
  )
})
