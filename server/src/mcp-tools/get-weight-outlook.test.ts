import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { BodyWeightPersistenceError } from '#domain/body-weight/errors'
import type { WeightOutlook } from '#domain/weight-outlook/weight-outlook-calculator'
import type { WeightOutlookService } from '#domain/weight-outlook/weight-outlook-service'
import { createMcpServer } from '#mcp'
import { jstDate } from '#test/jst-date'
import { createStubMcpDeps } from '#test/mcp-stubs'

const outlook: WeightOutlook = {
  asOf: jstDate('2026-05-28'),
  points: [{ date: jstDate('2026-05-28'), weightKg: 73.25 }],
  latestWeightKg: 73.25,
  goalWeightKg: 68,
  trend: {
    slopeKgPerDay: -0.05,
    slopeKgPerWeek: -0.35,
    points: [
      {
        date: jstDate('2026-05-28'),
        weightKg: 73.25,
        lowerKg: 72.8,
        upperKg: 73.7,
      },
    ],
  },
  status: 'arrival_estimate',
  reason: null,
  arrivalDateRange: {
    from: jstDate('2026-07-01'),
    to: jstDate('2026-07-20'),
  },
}

interface Harness {
  readonly client: Client
  readonly close: () => Promise<void>
}

const start = async (
  weightOutlookService: WeightOutlookService,
): Promise<Harness> => {
  const server = createMcpServer({
    ...createStubMcpDeps(),
    weightOutlookService,
  })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({
    name: 'weight-outlook-mcp-test',
    version: '0.0.0',
  })
  await client.connect(clientTransport)
  return {
    client,
    async close() {
      await client.close()
      await server.close()
    },
  }
}

const serviceWith = (value: WeightOutlook): WeightOutlookService => ({
  get: () => okAsync(value),
})

const expectedStructuredContent = {
  as_of: '2026-05-28',
  points: [{ date: '2026-05-28', weight_kg: 73.25 }],
  latest_weight_kg: 73.25,
  goal_weight_kg: 68,
  trend: {
    slope_kg_per_day: -0.05,
    slope_kg_per_week: -0.35,
    points: [
      {
        date: '2026-05-28',
        weight_kg: 73.25,
        lower_kg: 72.8,
        upper_kg: 73.7,
      },
    ],
  },
  status: 'arrival_estimate',
  reason: null,
  arrival_date_range: { from: '2026-07-01', to: '2026-07-20' },
}

const statusCases: ReadonlyArray<{
  readonly name: string
  readonly status: WeightOutlook['status']
  readonly reason: WeightOutlook['reason']
  readonly arrivalDateRange: WeightOutlook['arrivalDateRange']
  readonly noMeasurements?: boolean
  readonly text: string
}> = [
  {
    name: 'reached goal',
    status: 'reached',
    reason: null,
    arrivalDateRange: null,
    text: '推定トレンドでは目標体重に到達しています。',
  },
  {
    name: 'not approaching goal',
    status: 'not_approaching',
    reason: null,
    arrivalDateRange: null,
    text: '現在の傾向では目標体重に近づいていません。',
  },
  {
    name: 'arrival cannot be estimated',
    status: 'no_arrival_estimate',
    reason: null,
    arrivalDateRange: null,
    text: '現在の傾向から 12 週以内の到達時期を推定できません。',
  },
  {
    name: 'goal is unset',
    status: 'no_goal',
    reason: null,
    arrivalDateRange: null,
    text: '目標体重が未設定のため、到達時期を出せません。',
  },
  {
    name: 'insufficient data because there are no records',
    status: 'insufficient_data',
    reason: 'first_measurement_too_recent',
    arrivalDateRange: null,
    noMeasurements: true,
    text: '体重記録がないか、記録を始めてから 28 日未満のため、見通しを出せません。',
  },
  {
    name: 'insufficient data because there are too few measurement days',
    status: 'insufficient_data',
    reason: 'too_few_measurement_days',
    arrivalDateRange: null,
    text: '直近 28 日の測定日が 16 日未満のため、見通しを出せません。',
  },
  {
    name: 'insufficient data because of a measurement gap',
    status: 'insufficient_data',
    reason: 'measurement_gap',
    arrivalDateRange: null,
    text: '直近 28 日に週 2 日以上の測定がない週があるため、見通しを出せません。',
  },
]

describe.each(statusCases)('get_weight_outlook: $name', (testCase) => {
  it('returns the complete snake_case outlook and status text', async () => {
    const resultOutlook: WeightOutlook = {
      ...outlook,
      ...(testCase.noMeasurements === true
        ? { points: [], latestWeightKg: null }
        : {}),
      ...(testCase.status === 'insufficient_data' ? { trend: null } : {}),
      ...(testCase.status === 'no_goal' ? { goalWeightKg: null } : {}),
      status: testCase.status,
      reason: testCase.reason,
      arrivalDateRange: testCase.arrivalDateRange,
    }
    const h = await start(serviceWith(resultOutlook))
    try {
      const result = await h.client.callTool({
        name: 'get_weight_outlook',
        arguments: {},
      })
      expect(result).toEqual({
        content: [{ type: 'text', text: testCase.text }],
        structuredContent: {
          ...expectedStructuredContent,
          ...(testCase.noMeasurements === true
            ? { points: [], latest_weight_kg: null }
            : {}),
          ...(testCase.status === 'insufficient_data' ? { trend: null } : {}),
          ...(testCase.status === 'no_goal' ? { goal_weight_kg: null } : {}),
          status: testCase.status,
          reason: testCase.reason,
          arrival_date_range: null,
        },
      })
    } finally {
      await h.close()
    }
  })
})

describe('get_weight_outlook arrival estimate', () => {
  it('returns the complete snake_case outlook and marks the dates as unvalidated', async () => {
    const h = await start(serviceWith(outlook))
    try {
      const result = await h.client.callTool({
        name: 'get_weight_outlook',
        arguments: {},
      })
      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: '今のペースが続けば、目標体重への到達時期は 2026-07-01 から 2026-07-20 頃です。未検証の目安です。',
          },
        ],
        structuredContent: {
          as_of: '2026-05-28',
          points: [{ date: '2026-05-28', weight_kg: 73.25 }],
          latest_weight_kg: 73.25,
          goal_weight_kg: 68,
          trend: {
            slope_kg_per_day: -0.05,
            slope_kg_per_week: -0.35,
            points: [
              {
                date: '2026-05-28',
                weight_kg: 73.25,
                lower_kg: 72.8,
                upper_kg: 73.7,
              },
            ],
          },
          status: 'arrival_estimate',
          reason: null,
          arrival_date_range: {
            from: '2026-07-01',
            to: '2026-07-20',
          },
        },
      })
    } finally {
      await h.close()
    }
  })
})

describe('get_weight_outlook annotations', () => {
  it('marks the tool as read-only', async () => {
    const h = await start(serviceWith(outlook))
    try {
      const result = await h.client.listTools()
      const tool = result.tools.find(
        ({ name }) => name === 'get_weight_outlook',
      )
      expect(tool?.annotations).toEqual({ readOnlyHint: true })
    } finally {
      await h.close()
    }
  })
})

describe('get_weight_outlook service errors', () => {
  it('returns the standard MCP error result when the service fails', async () => {
    const error = new BodyWeightPersistenceError('weight history unavailable')
    const h = await start({ get: () => errAsync(error) })
    try {
      const result = await h.client.callTool({
        name: 'get_weight_outlook',
        arguments: {},
      })
      expect(result).toEqual({
        content: [{ type: 'text', text: error.message }],
        isError: true,
      })
    } finally {
      await h.close()
    }
  })
})
