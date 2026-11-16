import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import type { BodyWeightService } from '#domain/body-weight/body-weight-service'
import {
  BodyWeightNotFoundError,
  BodyWeightPersistenceError,
  InvalidBodyWeightValueError,
} from '#domain/body-weight/errors'
import type { BodyWeight } from '#domain/body-weight/types'
import { createMcpServer } from '#mcp'
import { jstDate } from '#test/jst-date'
import { createNullLogger } from '#test/logger'
import { createStubMcpDeps } from '#test/mcp-stubs'

const VALIDATION_ERROR_TEXT = '<schema validation error>'
const observation = <T extends object>(value: T): T => value

const toolResultSchema = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.unknown().optional(),
  content: z.array(
    z.object({ type: z.string(), text: z.string().optional() }).loose(),
  ),
})

const normalizeValidationError = (raw: unknown) => {
  const result = toolResultSchema.parse(raw)
  return {
    ...result,
    content: result.content.map((content) =>
      content.type === 'text'
        ? { ...content, text: VALIDATION_ERROR_TEXT }
        : content,
    ),
  }
}

const bodyWeight: BodyWeight = {
  id: 'body_weight_fixture_alpha',
  date: jstDate('2026-05-06'),
  measuredAt: new Date('2026-05-06T00:30:00.000Z'),
  weightKg: 73.25,
  createdAt: new Date('2026-05-06T00:31:00.000Z'),
  updatedAt: new Date('2026-05-06T00:32:00.000Z'),
}

interface Harness {
  readonly client: Client
  readonly close: () => Promise<void>
}

const start = async (
  bodyWeightService: BodyWeightService,
): Promise<Harness> => {
  const server = createMcpServer({
    ...createStubMcpDeps(),
    bodyWeightService,
    logger: createNullLogger(),
  })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'body-weight-mcp-test', version: '0.0.0' })
  await client.connect(clientTransport)
  return {
    client,
    async close() {
      await client.close()
      await server.close()
    },
  }
}

const serviceWith = (
  overrides: Partial<BodyWeightService>,
): BodyWeightService => ({
  record: () => errAsync(new BodyWeightPersistenceError('unused')),
  list: () => errAsync(new BodyWeightPersistenceError('unused')),
  update: () => errAsync(new BodyWeightPersistenceError('unused')),
  delete: () => errAsync(new BodyWeightPersistenceError('unused')),
  ...overrides,
})

describe('body weight MCP tools', () => {
  it('records a weight and leaves measuredAt undefined when the user omits the time', async () => {
    const calls: Parameters<BodyWeightService['record']>[0][] = []
    const h = await start(
      serviceWith({
        record(input) {
          calls.push(input)
          return okAsync(bodyWeight)
        },
      }),
    )
    try {
      const result = await h.client.callTool({
        name: 'record_body_weight',
        arguments: { date: '2026-05-06', weight_kg: 73.25 },
      })
      expect(observation({ calls, result })).toEqual({
        calls: [{ date: '2026-05-06', weightKg: 73.25 }],
        result: {
          content: [{ type: 'text', text: '体重を記録しました。' }],
          structuredContent: {
            body_weight_id: 'body_weight_fixture_alpha',
            date: '2026-05-06',
            measured_at: '2026-05-06T00:30:00.000Z',
            weight_kg: 73.25,
            created_at: '2026-05-06T00:31:00.000Z',
            updated_at: '2026-05-06T00:32:00.000Z',
          },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('maps record errors to structured domain errors', async () => {
    const error = new InvalidBodyWeightValueError(73.255)
    const h = await start(serviceWith({ record: () => errAsync(error) }))
    try {
      expect(
        await h.client.callTool({
          name: 'record_body_weight',
          arguments: { date: '2026-05-06', weight_kg: 73.255 },
        }),
      ).toEqual({
        content: [{ type: 'text', text: error.message }],
        isError: true,
        structuredContent: {
          error: { code: 'body_weight/invalid_weight', message: error.message },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('lists weights and passes an inclusive date range to the service', async () => {
    const calls: [string, string][] = []
    const h = await start(
      serviceWith({
        list(from, to) {
          calls.push([from, to])
          return okAsync([bodyWeight])
        },
      }),
    )
    try {
      const result = await h.client.callTool({
        name: 'list_body_weights',
        arguments: { from: '2026-05-01', to: '2026-05-06' },
      })
      expect(observation({ calls, result })).toEqual({
        calls: [['2026-05-01', '2026-05-06']],
        result: {
          content: [{ type: 'text', text: '1 件の体重記録を取得しました。' }],
          structuredContent: {
            body_weights: [
              {
                body_weight_id: 'body_weight_fixture_alpha',
                date: '2026-05-06',
                measured_at: '2026-05-06T00:30:00.000Z',
                weight_kg: 73.25,
                created_at: '2026-05-06T00:31:00.000Z',
                updated_at: '2026-05-06T00:32:00.000Z',
              },
            ],
          },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('maps list errors to structured domain errors', async () => {
    const error = new BodyWeightPersistenceError('list failed')
    const h = await start(serviceWith({ list: () => errAsync(error) }))
    try {
      expect(
        await h.client.callTool({
          name: 'list_body_weights',
          arguments: { from: '2026-05-01', to: '2026-05-06' },
        }),
      ).toEqual({
        content: [{ type: 'text', text: error.message }],
        isError: true,
        structuredContent: {
          error: {
            code: 'body_weight/persistence_failed',
            message: error.message,
          },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('updates the measurement time when measured_at is null', async () => {
    const calls: Parameters<BodyWeightService['update']>[0][] = []
    const h = await start(
      serviceWith({
        update(input) {
          calls.push(input)
          return okAsync({ ...bodyWeight, measuredAt: null, weightKg: 69 })
        },
      }),
    )
    try {
      const result = await h.client.callTool({
        name: 'update_body_weight',
        arguments: {
          body_weight_id: bodyWeight.id,
          measured_at: null,
          weight_kg: 69,
        },
      })
      expect(observation({ calls, result })).toEqual({
        calls: [{ id: bodyWeight.id, measuredAt: null, weightKg: 69 }],
        result: {
          content: [{ type: 'text', text: '体重記録を更新しました。' }],
          structuredContent: {
            body_weight_id: 'body_weight_fixture_alpha',
            date: '2026-05-06',
            measured_at: null,
            weight_kg: 69,
            created_at: '2026-05-06T00:31:00.000Z',
            updated_at: '2026-05-06T00:32:00.000Z',
          },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('maps update errors to structured domain errors', async () => {
    const error = new BodyWeightNotFoundError('body_weight_missing_alpha')
    const h = await start(serviceWith({ update: () => errAsync(error) }))
    try {
      expect(
        await h.client.callTool({
          name: 'update_body_weight',
          arguments: {
            body_weight_id: 'body_weight_missing_alpha',
            weight_kg: 69,
          },
        }),
      ).toEqual({
        content: [{ type: 'text', text: error.message }],
        isError: true,
        structuredContent: {
          error: { code: 'body_weight/not_found', message: error.message },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('deletes a weight and returns its id', async () => {
    const calls: string[] = []
    const h = await start(
      serviceWith({
        delete(id) {
          calls.push(id)
          return okAsync(undefined)
        },
      }),
    )
    try {
      const result = await h.client.callTool({
        name: 'delete_body_weight',
        arguments: { body_weight_id: bodyWeight.id },
      })
      expect(observation({ calls, result })).toEqual({
        calls: [bodyWeight.id],
        result: {
          content: [{ type: 'text', text: '体重記録を削除しました。' }],
          structuredContent: { body_weight_id: bodyWeight.id },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('maps delete errors to structured domain errors', async () => {
    const error = new BodyWeightNotFoundError('body_weight_missing_alpha')
    const h = await start(serviceWith({ delete: () => errAsync(error) }))
    try {
      expect(
        await h.client.callTool({
          name: 'delete_body_weight',
          arguments: { body_weight_id: 'body_weight_missing_alpha' },
        }),
      ).toEqual({
        content: [{ type: 'text', text: error.message }],
        isError: true,
        structuredContent: {
          error: { code: 'body_weight/not_found', message: error.message },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('rejects reversed list ranges before calling the service', async () => {
    const calls: [string, string][] = []
    const h = await start(
      serviceWith({
        list(from, to) {
          calls.push([from, to])
          return okAsync([])
        },
      }),
    )
    try {
      const result = await h.client.callTool({
        name: 'list_body_weights',
        arguments: { from: '2026-05-06', to: '2026-05-01' },
      })
      expect(
        observation({ calls, result: normalizeValidationError(result) }),
      ).toEqual({
        calls: [],
        result: {
          content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
          isError: true,
        },
      })
    } finally {
      await h.close()
    }
  })

  it('rejects updates with no fields before calling the service', async () => {
    const calls: Parameters<BodyWeightService['update']>[0][] = []
    const h = await start(
      serviceWith({
        update(input) {
          calls.push(input)
          return okAsync(bodyWeight)
        },
      }),
    )
    try {
      const result = await h.client.callTool({
        name: 'update_body_weight',
        arguments: { body_weight_id: bodyWeight.id },
      })
      expect(
        observation({ calls, result: normalizeValidationError(result) }),
      ).toEqual({
        calls: [],
        result: {
          content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
          isError: true,
        },
      })
    } finally {
      await h.close()
    }
  })

  it('registers all four body weight tools with their input fields and annotations', async () => {
    const h = await start(serviceWith({}))
    try {
      const result = await h.client.listTools()
      const tools = result.tools
        .filter((tool) => tool.name.includes('body_weight'))
        .map((tool) => {
          const schema = z
            .object({ properties: z.record(z.string(), z.unknown()) })
            .parse(tool.inputSchema)
          return {
            name: tool.name,
            properties: Object.keys(schema.properties).sort(),
            annotations: tool.annotations,
            description: tool.description,
          }
        })
        .sort((left, right) => left.name.localeCompare(right.name))
      expect(tools).toEqual([
        {
          name: 'delete_body_weight',
          properties: ['body_weight_id'],
          annotations: { readOnlyHint: false, destructiveHint: true },
          description: 'body_weight_id で指定した体重記録を削除する。',
        },
        {
          name: 'list_body_weights',
          properties: ['from', 'to'],
          annotations: { readOnlyHint: true },
          description:
            'from 以上、to 以下 (どちらも含む) の期間の体重記録を返す。',
        },
        {
          name: 'record_body_weight',
          properties: ['date', 'measured_at', 'weight_kg'],
          annotations: { readOnlyHint: false, destructiveHint: false },
          description:
            '体重を記録する。利用者が日付と体重を伝えたときに使う。measured_at は利用者が測定時刻を伝えた場合だけ指定する。',
        },
        {
          name: 'update_body_weight',
          properties: ['body_weight_id', 'date', 'measured_at', 'weight_kg'],
          annotations: { readOnlyHint: false, destructiveHint: false },
          description:
            'body_weight_id で指定した体重記録を部分更新する。measured_at に null を指定すると測定時刻を消す。',
        },
      ])
    } finally {
      await h.close()
    }
  })
})
