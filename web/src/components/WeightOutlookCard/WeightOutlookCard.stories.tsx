import type { Meta, StoryObj } from '@storybook/react-vite'

import type { WeightOutlook } from '#api/weight-outlook'
import { WeightOutlookCard } from '#components/WeightOutlookCard/WeightOutlookCard'

const makeOutlook = (
  status: WeightOutlook['status'],
  reason: WeightOutlook['reason'] = null,
  arrivalDateRange: WeightOutlook['arrivalDateRange'] = null,
): WeightOutlook => ({
  asOf: '2093-04-12',
  points: [{ date: '2093-04-12', weightKg: 63.4 }],
  latestWeightKg: 63.4,
  goalWeightKg: 60,
  trend:
    status === 'insufficient_data'
      ? null
      : {
          slopeKgPerDay: -0.02,
          slopeKgPerWeek: -0.14,
          points: [
            {
              date: '2093-04-12',
              weightKg: 63.4,
              lowerKg: 63.1,
              upperKg: 63.7,
            },
          ],
        },
  status,
  reason,
  arrivalDateRange,
})

const meta = {
  title: 'Components/WeightOutlookCard',
  component: WeightOutlookCard,
  args: {
    state: 'loaded',
    outlook: makeOutlook('arrival_estimate', null, {
      from: '2093-05-01',
      to: '2093-05-12',
    }),
    onRetry: () => undefined,
  },
} satisfies Meta<typeof WeightOutlookCard>

export default meta
type Story = StoryObj<typeof meta>

export const ArrivalEstimate = {
  name: 'the goal arrival range is shown as an unverified estimate',
} satisfies Story

export const InsufficientData = {
  name: 'there are too few recent measurement days',
  args: {
    outlook: makeOutlook('insufficient_data', 'too_few_measurement_days'),
  },
} satisfies Story

export const FirstMeasurementIsRecent = {
  name: 'the first measurement was recorded recently',
  args: {
    outlook: makeOutlook('insufficient_data', 'first_measurement_too_recent'),
  },
} satisfies Story

export const MeasurementsHaveGaps = {
  name: 'recent measurements have gaps between weeks',
  args: {
    outlook: makeOutlook('insufficient_data', 'measurement_gap'),
  },
} satisfies Story

export const NoGoal = {
  name: 'no goal weight has been set',
  args: { outlook: makeOutlook('no_goal') },
} satisfies Story

export const Reached = {
  name: 'the recent trend has reached the goal weight',
  args: { outlook: makeOutlook('reached') },
} satisfies Story

export const NotApproaching = {
  name: 'the recent trend is not approaching the goal weight',
  args: { outlook: makeOutlook('not_approaching') },
} satisfies Story

export const NoArrivalEstimate = {
  name: 'the goal arrival is outside the forecast period',
  args: { outlook: makeOutlook('no_arrival_estimate') },
} satisfies Story

export const Loading = {
  name: 'the outlook is loading',
  args: { state: 'loading', outlook: undefined },
} satisfies Story

export const LoadError = {
  name: 'the outlook could not be loaded',
  args: { state: 'error', outlook: undefined },
} satisfies Story
