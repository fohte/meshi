import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  type BodyCompositionService,
  createBodyCompositionService,
} from '#domain/body-composition/body-composition-service'
import { createDrizzleBodyCompositionRepository } from '#domain/body-composition/drizzle-body-composition-repository'
import {
  BodyCompositionNotFoundError,
  BodyCompositionNoValuesError,
  BodyCompositionPersistenceError,
  InvalidBodyCompositionValueError,
} from '#domain/body-composition/errors'
import type { BodyComposition } from '#domain/body-composition/types'
import type { Logger } from '#logger'
import { createMcpServer } from '#mcp'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { jstDate } from '#test/jst-date'
import { createNullLogger } from '#test/logger'
import { createStubMcpDeps } from '#test/mcp-stubs'

const VALIDATION_ERROR_TEXT = '<schema validation error>'
const bodyCompositionGuidance =
  '体脂肪率は体重に占める脂肪の割合 (%)。筋肉量はタニタの定義で、骨格筋・平滑筋・心筋とそれらに含まれる水分の重さ (kg)。骨格筋率は体重に占める骨格筋の割合 (%) で、平滑筋・心筋を含まない。体組成計の表示にある項目だけを記録し、名前の近い別指標を当てはめない。特に骨格筋量 (kg) や除脂肪量を muscle_mass_kg に入れない。機器名は利用者に確認し、前回と同じ機器なら list_body_compositions で前回の表記を確かめて揃える。体重は record_body_weight で別に記録し、同じ報告に体重があれば両方を呼ぶ。値は体組成計の推定値で真値ではない。'
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

const bodyComposition: BodyComposition = {
  id: 'body_composition_fixture_alpha',
  date: jstDate('2026-10-12'),
  measuredAt: new Date('2026-10-12T01:30:00.000Z'),
  device: 'Example Scale A',
  bodyFatPercent: 22.5,
  muscleMassKg: 48.75,
  skeletalMusclePercent: null,
  createdAt: new Date('2026-10-12T01:31:00.000Z'),
  updatedAt: new Date('2026-10-12T01:32:00.000Z'),
}

interface Harness {
  readonly client: Client
  readonly close: () => Promise<void>
}

const start = async (
  bodyCompositionService: BodyCompositionService,
  logger: Logger = createNullLogger(),
): Promise<Harness> => {
  const server = createMcpServer({
    ...createStubMcpDeps(),
    bodyCompositionService,
    logger,
  })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({
    name: 'body-composition-mcp-test',
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

const serviceWith = (
  overrides: Partial<BodyCompositionService>,
): BodyCompositionService => ({
  record: () => errAsync(new BodyCompositionPersistenceError('unused')),
  list: () => errAsync(new BodyCompositionPersistenceError('unused')),
  update: () => errAsync(new BodyCompositionPersistenceError('unused')),
  delete: () => errAsync(new BodyCompositionPersistenceError('unused')),
  ...overrides,
})

describe('body composition MCP tools', () => {
  it('records body fat alone and returns the other values as null', async () => {
    const calls: Parameters<BodyCompositionService['record']>[0][] = []
    const h = await start(
      serviceWith({
        record(input) {
          calls.push(input)
          return okAsync({
            ...bodyComposition,
            bodyFatPercent: 22.5,
            muscleMassKg: null,
            skeletalMusclePercent: null,
          })
        },
      }),
    )
    try {
      const result = await h.client.callTool({
        name: 'record_body_composition',
        arguments: {
          date: '2026-10-12',
          device: 'Example Scale A',
          body_fat_percent: 22.5,
        },
      })
      expect(observation({ calls, result })).toEqual({
        calls: [
          {
            date: '2026-10-12',
            device: 'Example Scale A',
            bodyFatPercent: 22.5,
          },
        ],
        result: {
          content: [{ type: 'text', text: '体組成を記録しました。' }],
          structuredContent: {
            body_composition_id: 'body_composition_fixture_alpha',
            date: '2026-10-12',
            measured_at: '2026-10-12T01:30:00.000Z',
            device: 'Example Scale A',
            body_fat_percent: 22.5,
            muscle_mass_kg: null,
            skeletal_muscle_percent: null,
            created_at: '2026-10-12T01:31:00.000Z',
            updated_at: '2026-10-12T01:32:00.000Z',
          },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('records multiple values and converts measured_at to a Date', async () => {
    const calls: Parameters<BodyCompositionService['record']>[0][] = []
    const h = await start(
      serviceWith({
        record(input) {
          calls.push(input)
          return okAsync({ ...bodyComposition, skeletalMusclePercent: 35.25 })
        },
      }),
    )
    try {
      const result = await h.client.callTool({
        name: 'record_body_composition',
        arguments: {
          date: '2026-10-12',
          device: 'Example Scale A',
          measured_at: '2026-10-12T10:30:00+09:00',
          body_fat_percent: 22.5,
          muscle_mass_kg: 48.75,
          skeletal_muscle_percent: 35.25,
        },
      })
      expect(observation({ calls, result })).toEqual({
        calls: [
          {
            date: '2026-10-12',
            device: 'Example Scale A',
            measuredAt: new Date('2026-10-12T01:30:00.000Z'),
            bodyFatPercent: 22.5,
            muscleMassKg: 48.75,
            skeletalMusclePercent: 35.25,
          },
        ],
        result: {
          content: [{ type: 'text', text: '体組成を記録しました。' }],
          structuredContent: {
            body_composition_id: 'body_composition_fixture_alpha',
            date: '2026-10-12',
            measured_at: '2026-10-12T01:30:00.000Z',
            device: 'Example Scale A',
            body_fat_percent: 22.5,
            muscle_mass_kg: 48.75,
            skeletal_muscle_percent: 35.25,
            created_at: '2026-10-12T01:31:00.000Z',
            updated_at: '2026-10-12T01:32:00.000Z',
          },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('records body composition with a second-precision measurement time', async () => {
    const calls: Parameters<BodyCompositionService['record']>[0][] = []
    const measuredAt = new Date('2026-10-12T01:30:45.000Z')
    const h = await start(
      serviceWith({
        record(input) {
          calls.push(input)
          return okAsync({ ...bodyComposition, measuredAt })
        },
      }),
    )
    try {
      const result = await h.client.callTool({
        name: 'record_body_composition',
        arguments: {
          date: '2026-10-12',
          device: 'Example Scale A',
          measured_at: '2026-10-12T10:30:45+09:00',
          body_fat_percent: 22.5,
        },
      })
      expect(observation({ calls, result })).toEqual({
        calls: [
          {
            date: '2026-10-12',
            device: 'Example Scale A',
            measuredAt,
            bodyFatPercent: 22.5,
          },
        ],
        result: {
          content: [{ type: 'text', text: '体組成を記録しました。' }],
          structuredContent: {
            body_composition_id: 'body_composition_fixture_alpha',
            date: '2026-10-12',
            measured_at: '2026-10-12T01:30:45.000Z',
            device: 'Example Scale A',
            body_fat_percent: 22.5,
            muscle_mass_kg: 48.75,
            skeletal_muscle_percent: null,
            created_at: '2026-10-12T01:31:00.000Z',
            updated_at: '2026-10-12T01:32:00.000Z',
          },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('maps invalid values to structured domain errors', async () => {
    const error = new InvalidBodyCompositionValueError('bodyFatPercent', 0.5)
    const logs: {
      readonly event: string
      readonly payload: Readonly<Record<string, unknown>>
    }[] = []
    const h = await start(serviceWith({ record: () => errAsync(error) }), {
      log(event, payload) {
        logs.push({ event, payload: payload ?? {} })
      },
    })
    try {
      expect(
        observation({
          logs,
          result: await h.client.callTool({
            name: 'record_body_composition',
            arguments: {
              date: '2026-10-12',
              device: 'Example Scale A',
              body_fat_percent: 0.5,
            },
          }),
        }),
      ).toEqual({
        logs: [
          {
            event: 'meshi.tool_called',
            payload: { tool: 'record_body_composition' },
          },
          {
            event: 'meshi.tool_failed',
            payload: {
              tool: 'record_body_composition',
              code: 'body_composition/invalid_value',
              message: 'body_composition/invalid_value',
            },
          },
        ],
        result: {
          content: [{ type: 'text', text: error.message }],
          isError: true,
          structuredContent: {
            error: {
              code: 'body_composition/invalid_value',
              message: error.message,
            },
          },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('rejects recording without a measurement value before calling the service', async () => {
    const calls: Parameters<BodyCompositionService['record']>[0][] = []
    const h = await start(
      serviceWith({
        record(input) {
          calls.push(input)
          return okAsync(bodyComposition)
        },
      }),
    )
    try {
      const result = await h.client.callTool({
        name: 'record_body_composition',
        arguments: { date: '2026-10-12', device: 'Example Scale A' },
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

  it('lists records and passes the inclusive date range to the service', async () => {
    const calls: [string, string][] = []
    const h = await start(
      serviceWith({
        list(from, to) {
          calls.push([from, to])
          return okAsync([bodyComposition])
        },
      }),
    )
    try {
      const result = await h.client.callTool({
        name: 'list_body_compositions',
        arguments: { from: '2026-10-01', to: '2026-10-12' },
      })
      expect(observation({ calls, result })).toEqual({
        calls: [['2026-10-01', '2026-10-12']],
        result: {
          content: [{ type: 'text', text: '1 件の体組成記録を取得しました。' }],
          structuredContent: {
            body_compositions: [
              {
                body_composition_id: 'body_composition_fixture_alpha',
                date: '2026-10-12',
                measured_at: '2026-10-12T01:30:00.000Z',
                device: 'Example Scale A',
                body_fat_percent: 22.5,
                muscle_mass_kg: 48.75,
                skeletal_muscle_percent: null,
                created_at: '2026-10-12T01:31:00.000Z',
                updated_at: '2026-10-12T01:32:00.000Z',
              },
            ],
          },
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
        name: 'list_body_compositions',
        arguments: { from: '2026-10-12', to: '2026-10-01' },
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

  it('clears nullable fields when correcting a record', async () => {
    const calls: Parameters<BodyCompositionService['update']>[0][] = []
    const h = await start(
      serviceWith({
        update(input) {
          calls.push(input)
          return okAsync({
            ...bodyComposition,
            measuredAt: null,
            bodyFatPercent: null,
            muscleMassKg: 50,
          })
        },
      }),
    )
    try {
      const result = await h.client.callTool({
        name: 'update_body_composition',
        arguments: {
          body_composition_id: bodyComposition.id,
          measured_at: null,
          body_fat_percent: null,
          muscle_mass_kg: 50,
        },
      })
      expect(observation({ calls, result })).toEqual({
        calls: [
          {
            id: bodyComposition.id,
            measuredAt: null,
            bodyFatPercent: null,
            muscleMassKg: 50,
          },
        ],
        result: {
          content: [{ type: 'text', text: '体組成記録を更新しました。' }],
          structuredContent: {
            body_composition_id: 'body_composition_fixture_alpha',
            date: '2026-10-12',
            measured_at: null,
            device: 'Example Scale A',
            body_fat_percent: null,
            muscle_mass_kg: 50,
            skeletal_muscle_percent: null,
            created_at: '2026-10-12T01:31:00.000Z',
            updated_at: '2026-10-12T01:32:00.000Z',
          },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('updates body composition with a minute-precision measurement time', async () => {
    const calls: Parameters<BodyCompositionService['update']>[0][] = []
    const measuredAt = new Date('2026-10-12T01:30:00.000Z')
    const h = await start(
      serviceWith({
        update(input) {
          calls.push(input)
          return okAsync({ ...bodyComposition, measuredAt })
        },
      }),
    )
    try {
      const result = await h.client.callTool({
        name: 'update_body_composition',
        arguments: {
          body_composition_id: bodyComposition.id,
          measured_at: '2026-10-12T10:30+09:00',
        },
      })
      expect(observation({ calls, result })).toEqual({
        calls: [{ id: bodyComposition.id, measuredAt }],
        result: {
          content: [{ type: 'text', text: '体組成記録を更新しました。' }],
          structuredContent: {
            body_composition_id: 'body_composition_fixture_alpha',
            date: '2026-10-12',
            measured_at: '2026-10-12T01:30:00.000Z',
            device: 'Example Scale A',
            body_fat_percent: 22.5,
            muscle_mass_kg: 48.75,
            skeletal_muscle_percent: null,
            created_at: '2026-10-12T01:31:00.000Z',
            updated_at: '2026-10-12T01:32:00.000Z',
          },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('maps missing record IDs to structured not-found errors', async () => {
    const error = new BodyCompositionNotFoundError(
      'body_composition_missing_alpha',
    )
    const h = await start(serviceWith({ update: () => errAsync(error) }))
    try {
      expect(
        await h.client.callTool({
          name: 'update_body_composition',
          arguments: {
            body_composition_id: 'body_composition_missing_alpha',
            body_fat_percent: 22,
          },
        }),
      ).toEqual({
        content: [{ type: 'text', text: error.message }],
        isError: true,
        structuredContent: {
          error: { code: 'body_composition/not_found', message: error.message },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('rejects an update that clears every measurement value', async () => {
    const calls: Parameters<BodyCompositionService['update']>[0][] = []
    const h = await start(
      serviceWith({
        update(input) {
          calls.push(input)
          return errAsync(new BodyCompositionNoValuesError())
        },
      }),
    )
    try {
      const result = await h.client.callTool({
        name: 'update_body_composition',
        arguments: {
          body_composition_id: bodyComposition.id,
          body_fat_percent: null,
          muscle_mass_kg: null,
          skeletal_muscle_percent: null,
        },
      })
      expect(observation({ calls, result })).toEqual({
        calls: [
          {
            id: bodyComposition.id,
            bodyFatPercent: null,
            muscleMassKg: null,
            skeletalMusclePercent: null,
          },
        ],
        result: {
          content: [
            {
              type: 'text',
              text: 'at least one body composition value is required',
            },
          ],
          isError: true,
          structuredContent: {
            error: {
              code: 'body_composition/no_values',
              message: 'at least one body composition value is required',
            },
          },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('rejects updates with no fields before calling the service', async () => {
    const calls: Parameters<BodyCompositionService['update']>[0][] = []
    const h = await start(
      serviceWith({
        update(input) {
          calls.push(input)
          return okAsync(bodyComposition)
        },
      }),
    )
    try {
      const result = await h.client.callTool({
        name: 'update_body_composition',
        arguments: { body_composition_id: bodyComposition.id },
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

  it('deletes a record and returns its ID', async () => {
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
        name: 'delete_body_composition',
        arguments: { body_composition_id: bodyComposition.id },
      })
      expect(observation({ calls, result })).toEqual({
        calls: [bodyComposition.id],
        result: {
          content: [{ type: 'text', text: '体組成記録を削除しました。' }],
          structuredContent: {
            body_composition_id: bodyComposition.id,
          },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('maps deleting a missing record to a structured not-found error', async () => {
    const error = new BodyCompositionNotFoundError(
      'body_composition_missing_alpha',
    )
    const h = await start(serviceWith({ delete: () => errAsync(error) }))
    try {
      expect(
        await h.client.callTool({
          name: 'delete_body_composition',
          arguments: { body_composition_id: 'body_composition_missing_alpha' },
        }),
      ).toEqual({
        content: [{ type: 'text', text: error.message }],
        isError: true,
        structuredContent: {
          error: { code: 'body_composition/not_found', message: error.message },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('documents the distinct metrics and device naming rules in every tool', async () => {
    const h = await start(serviceWith({}))
    try {
      const result = await h.client.listTools()
      const descriptions = Object.fromEntries(
        result.tools
          .filter((tool) => tool.name.includes('body_composition'))
          .map((tool) => [tool.name, tool.description]),
      )
      expect(descriptions).toEqual({
        delete_body_composition: `body_composition_id で指定した体組成記録を削除する。${bodyCompositionGuidance}`,
        list_body_compositions: `from 以上、to 以下 (どちらも含む) の期間の体組成記録を返す。${bodyCompositionGuidance}`,
        record_body_composition: `体組成計の測定値を記録する。date と device は必須で、3 項目のうち少なくとも 1 つを指定する。${bodyCompositionGuidance}`,
        update_body_composition: `body_composition_id で指定した体組成記録を部分更新する。measured_at と各測定値は null で消せる。${bodyCompositionGuidance}`,
      })
    } finally {
      await h.close()
    }
  })

  it('exposes metric definitions in arguments and marks deletion destructive', async () => {
    const h = await start(serviceWith({}))
    try {
      const result = await h.client.listTools()
      const tools = result.tools
        .filter((tool) => tool.name.includes('body_composition'))
        .map((tool) => {
          const schema = z
            .object({ properties: z.record(z.string(), z.unknown()) })
            .parse(tool.inputSchema)
          const properties = Object.fromEntries(
            Object.entries(schema.properties).map(([name, property]) => [
              name,
              z
                .object({ description: z.string().optional() })
                .loose()
                .parse(property).description,
            ]),
          )
          return {
            name: tool.name,
            annotations: tool.annotations,
            properties,
          }
        })
        .sort((left, right) => left.name.localeCompare(right.name))
      expect(tools).toEqual([
        {
          name: 'delete_body_composition',
          annotations: { readOnlyHint: false, destructiveHint: true },
          properties: {
            body_composition_id: '削除する体組成記録の ID',
          },
        },
        {
          name: 'list_body_compositions',
          annotations: { readOnlyHint: true },
          properties: {
            from: '期間の開始日 (JST、含む。YYYY-MM-DD)',
            to: '期間の終了日 (JST、含む。YYYY-MM-DD)',
          },
        },
        {
          name: 'record_body_composition',
          annotations: { readOnlyHint: false, destructiveHint: false },
          properties: {
            date: '測定日 (JST、YYYY-MM-DD)',
            device:
              '測定した体組成計の機器名。利用者に確認し、以前と同じ機器なら list_body_compositions で前回の表記を確かめて揃える。',
            measured_at:
              '利用者が伝えた測定日時 (オフセット付き ISO 8601)。不明なら省略',
            body_fat_percent: '体脂肪率 (%)。体重に占める脂肪の割合。',
            muscle_mass_kg:
              '筋肉量 (kg)。タニタの定義で、骨格筋・平滑筋・心筋と、それらに含まれる水分の重さ。骨格筋量 (kg) や除脂肪量ではない。',
            skeletal_muscle_percent:
              '骨格筋率 (%)。体重に占める骨格筋の割合。平滑筋・心筋を含まない。骨格筋量 (kg) ではない。',
          },
        },
        {
          name: 'update_body_composition',
          annotations: { readOnlyHint: false, destructiveHint: false },
          properties: {
            body_composition_id: '訂正する体組成記録の ID',
            date: '測定日 (JST、YYYY-MM-DD)',
            measured_at: '測定日時。null を指定すると時刻を消す',
            device:
              '測定した体組成計の機器名。利用者に確認し、以前と同じ機器なら list_body_compositions で前回の表記を確かめて揃える。',
            body_fat_percent:
              '体脂肪率 (%)。体重に占める脂肪の割合。 null を指定すると値を消す。',
            muscle_mass_kg:
              '筋肉量 (kg)。タニタの定義で、骨格筋・平滑筋・心筋と、それらに含まれる水分の重さ。骨格筋量 (kg) や除脂肪量ではない。 null を指定すると値を消す。',
            skeletal_muscle_percent:
              '骨格筋率 (%)。体重に占める骨格筋の割合。平滑筋・心筋を含まない。骨格筋量 (kg) ではない。 null を指定すると値を消す。',
          },
        },
      ])
    } finally {
      await h.close()
    }
  })
})

describeIfDb('body composition MCP duplicate submission', () => {
  const getTx = setupDrizzleTx()

  it('returns the existing measurement without creating a duplicate row', async () => {
    const service = createBodyCompositionService({
      repository: createDrizzleBodyCompositionRepository(getTx()),
      idGenerator: () => 'body_composition_fixture_retry',
      now: () => new Date('2026-10-13T00:00:00.000Z'),
    })
    const h = await start(service)
    try {
      const args = {
        date: '2026-10-12',
        device: 'Example Scale A',
        body_fat_percent: 22.5,
        muscle_mass_kg: 48.75,
      }
      const first = await h.client.callTool({
        name: 'record_body_composition',
        arguments: args,
      })
      const retry = await h.client.callTool({
        name: 'record_body_composition',
        arguments: args,
      })
      const rows = await service
        .list(jstDate('2026-10-12'), jstDate('2026-10-12'))
        .map((measurements) =>
          measurements.map((row) => ({
            ...row,
            createdAt: '<timestamp>',
            updatedAt: '<timestamp>',
          })),
        )
        .unwrapOr([])
      const normalizeTimestamps = (raw: unknown) => {
        const parsed = z
          .object({
            content: z.array(
              z
                .object({ type: z.string(), text: z.string().optional() })
                .loose(),
            ),
            structuredContent: z
              .object({ created_at: z.string(), updated_at: z.string() })
              .loose(),
          })
          .parse(raw)
        return {
          ...parsed,
          structuredContent: {
            ...parsed.structuredContent,
            created_at: '<timestamp>',
            updated_at: '<timestamp>',
          },
        }
      }
      expect(
        observation({
          first: normalizeTimestamps(first),
          retry: normalizeTimestamps(retry),
          rows,
        }),
      ).toEqual({
        first: {
          content: [{ type: 'text', text: '体組成を記録しました。' }],
          structuredContent: {
            body_composition_id: 'body_composition_fixture_retry',
            date: '2026-10-12',
            measured_at: null,
            device: 'Example Scale A',
            body_fat_percent: 22.5,
            muscle_mass_kg: 48.75,
            skeletal_muscle_percent: null,
            created_at: '<timestamp>',
            updated_at: '<timestamp>',
          },
        },
        retry: {
          content: [{ type: 'text', text: '体組成を記録しました。' }],
          structuredContent: {
            body_composition_id: 'body_composition_fixture_retry',
            date: '2026-10-12',
            measured_at: null,
            device: 'Example Scale A',
            body_fat_percent: 22.5,
            muscle_mass_kg: 48.75,
            skeletal_muscle_percent: null,
            created_at: '<timestamp>',
            updated_at: '<timestamp>',
          },
        },
        rows: [
          {
            id: 'body_composition_fixture_retry',
            date: '2026-10-12',
            measuredAt: null,
            device: 'Example Scale A',
            bodyFatPercent: 22.5,
            muscleMassKg: 48.75,
            skeletalMusclePercent: null,
            createdAt: '<timestamp>',
            updatedAt: '<timestamp>',
          },
        ],
      })
    } finally {
      await h.close()
    }
  })
})
