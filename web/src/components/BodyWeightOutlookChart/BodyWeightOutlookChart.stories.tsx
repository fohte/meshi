import type { Meta, StoryObj } from '@storybook/react-vite'

import type { WeightOutlook } from '#api/weight-outlook'
import { BodyWeightOutlookChart } from '#components/BodyWeightOutlookChart/BodyWeightOutlookChart'

const makeOutlook = (
  status: WeightOutlook['status'],
  reason: WeightOutlook['reason'] = null,
  arrivalDateRange: WeightOutlook['arrivalDateRange'] = null,
  empty = false,
): WeightOutlook => ({
  asOf: '2093-04-12',
  points: empty
    ? []
    : [
        { date: '2093-04-05', weightKg: 64.1 },
        { date: '2093-04-08', weightKg: 63.8 },
        { date: '2093-04-12', weightKg: 63.4 },
      ],
  latestWeightKg: empty ? null : 63.4,
  goalWeightKg: status === 'no_goal' ? null : 60,
  trend:
    status === 'insufficient_data'
      ? null
      : {
          slopeKgPerDay: -0.02,
          slopeKgPerWeek: -0.14,
          points: [
            {
              date: '2093-04-05',
              weightKg: 64.1,
              lowerKg: 63.8,
              upperKg: 64.4,
            },
            {
              date: '2093-04-12',
              weightKg: 63.4,
              lowerKg: 63.1,
              upperKg: 63.7,
            },
            {
              date: '2093-05-12',
              weightKg: 62.8,
              lowerKg: 61.9,
              upperKg: 63.6,
            },
            {
              date: '2093-07-05',
              weightKg: 61.7,
              lowerKg: 59.7,
              upperKg: 63.8,
            },
          ],
        },
  status,
  reason,
  arrivalDateRange,
})

const meta = {
  title: 'Components/BodyWeightOutlookChart',
  component: BodyWeightOutlookChart,
  args: {
    state: 'loaded',
    outlook: makeOutlook('arrival_estimate', null, {
      from: '2093-06-16',
      to: '2093-06-27',
    }),
    onRetry: () => undefined,
  },
} satisfies Meta<typeof BodyWeightOutlookChart>

export default meta
type Story = StoryObj<typeof meta>

export const ArrivalEstimate = {
  name: 'the chart shows a trend band and an estimated arrival range',
} satisfies Story

export const InsufficientData = {
  name: 'the chart shows why more measurements are needed',
  args: {
    outlook: makeOutlook('insufficient_data', 'too_few_measurement_days'),
  },
} satisfies Story

export const RecentStart = {
  name: 'the chart explains that recording began recently',
  args: {
    outlook: makeOutlook('insufficient_data', 'first_measurement_too_recent'),
  },
} satisfies Story

export const MeasurementGap = {
  name: 'the chart explains that recent measurements have a gap',
  args: {
    outlook: makeOutlook('insufficient_data', 'measurement_gap'),
  },
} satisfies Story

export const NoGoal = {
  name: 'the chart shows a trend before a goal is set',
  args: { outlook: makeOutlook('no_goal') },
} satisfies Story

export const Reached = {
  name: 'the chart shows that the current trend has reached the goal',
  args: { outlook: makeOutlook('reached') },
} satisfies Story

export const NotApproaching = {
  name: 'the chart shows a trend moving away from the goal',
  args: { outlook: makeOutlook('not_approaching') },
} satisfies Story

export const NoArrivalEstimate = {
  name: 'the chart shows a trend without an arrival estimate',
  args: { outlook: makeOutlook('no_arrival_estimate') },
} satisfies Story

export const NoMeasurements = {
  name: 'the chart prompts the user to record a first measurement',
  args: {
    outlook: makeOutlook(
      'insufficient_data',
      'first_measurement_too_recent',
      null,
      true,
    ),
  },
} satisfies Story

export const Loading = {
  name: 'the chart is loading the weight outlook',
  args: { state: 'loading', outlook: undefined },
} satisfies Story

export const LoadError = {
  name: 'the chart could not load the weight outlook',
  args: { state: 'error', outlook: undefined },
} satisfies Story
