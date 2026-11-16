import type { WeightOutlook } from '#api/weight-outlook'

const formatDate = (date: string): string => {
  const [year, month, day] = date.split('-')
  return [
    Number(year).toString(),
    '年',
    Number(month).toString(),
    '月',
    Number(day).toString(),
    '日',
  ].join('')
}

export const getWeightOutlookMessage = (
  outlook: Pick<WeightOutlook, 'status' | 'reason' | 'arrivalDateRange'>,
): string => {
  switch (outlook.status) {
    case 'insufficient_data':
      switch (outlook.reason) {
        case 'first_measurement_too_recent':
          return '記録を始めたばかりです。もう少し続けると見通しを表示できます。'
        case 'too_few_measurement_days':
          return '直近 4 週間の記録がまだ十分ではありません。'
        case 'measurement_gap':
          return '直近 4 週間の記録に空きがあります。週 2 日以上の記録がそろうと見通しを表示できます。'
        case null:
          return '見通しを出すには、もう少し記録が必要です。'
      }
    case 'no_goal':
      return '目標体重を設定すると、到達の見通しを確認できます。'
    case 'reached':
      return '現在のトレンドでは、目標体重に到達しています。'
    case 'not_approaching':
      return '現在のトレンドでは、目標体重に近づいていません。'
    case 'no_arrival_estimate':
      return '今のペースでは 12 週間以内の到達時期を見積もれません。'
    case 'arrival_estimate':
      if (outlook.arrivalDateRange === null) {
        return '到達時期を見積もれません。'
      }
      return `今のペースが続けば、目標体重への到達時期は ${formatDate(outlook.arrivalDateRange.from)}〜${formatDate(outlook.arrivalDateRange.to)} ごろです。未検証の目安です。`
  }
}
