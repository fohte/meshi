import type { AgentCard, AgentSkill } from '@a2a-js/sdk'

import { SUPPORTED_IMAGE_MIME_TYPES } from '@/adapters/image/image-interpreter'

const MESHI_AGENT_NAME = 'meshi'
const MESHI_AGENT_VERSION = '0.0.0'
const MESHI_AGENT_DESCRIPTION =
  '食事の記録・照会・提案とプロフィール管理を会話的に行う個人向け栄養管理エージェント。'

// Descriptions below are carried over verbatim/near-verbatim from the MCP
// intent tools' own descriptions (mcp-tools.ts registerMeshiTools) — both
// surfaces advertise the same underlying domain-agent capability.
const SKILLS: readonly AgentSkill[] = [
  {
    id: 'record_meal',
    name: '食事記録',
    description:
      'テキスト発話または画像 (写真) から食事ログを作成する。利用者の発話 + 任意の occurred_at / timezone、または画像 + 任意の補助テキストを受け取り、内部 LLM 経由で食事ログを作成する。',
    tags: ['meal', 'record'],
    inputModes: ['text/plain', ...SUPPORTED_IMAGE_MIME_TYPES],
  },
  {
    id: 'query_meals',
    name: '食事照会',
    description: '自然言語クエリ (+ 任意の期間) から食事履歴を集計する。',
    tags: ['meal', 'query'],
  },
  {
    id: 'recommend_meal',
    name: '食事提案',
    description:
      '任意の追加条件からプロファイル + 履歴ベースの食事レコメンドを返す。',
    tags: ['meal', 'recommend'],
  },
  {
    id: 'manage_profile',
    name: 'プロフィール管理',
    description:
      'プロファイル (好み・嫌い・アレルギー・制約・目標栄養素) を取得または部分更新する。',
    tags: ['profile'],
  },
]

export interface CreateMeshiAgentCardOptions {
  // The A2A JSON-RPC endpoint's externally-reachable URL (mountA2aRoutes
  // serves it at POST /a2a), e.g. http://meshi:8080/a2a.
  readonly url: string
}

export const createMeshiAgentCard = (
  options: CreateMeshiAgentCardOptions,
): AgentCard => ({
  protocolVersion: '0.3.0',
  name: MESHI_AGENT_NAME,
  description: MESHI_AGENT_DESCRIPTION,
  url: options.url,
  version: MESHI_AGENT_VERSION,
  capabilities: { streaming: true, pushNotifications: true },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [...SKILLS],
})
