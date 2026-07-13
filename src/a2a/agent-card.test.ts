import { describe, expect, it } from 'vitest'

import { createMeshiAgentCard } from '@/a2a/agent-card'

describe('createMeshiAgentCard', () => {
  it('declares the four intent-level skills with the given url', () => {
    const card = createMeshiAgentCard({ url: 'http://meshi:8080/a2a' })

    expect(card).toEqual({
      protocolVersion: '0.3.0',
      name: 'meshi',
      description:
        '食事の記録・照会・提案とプロフィール管理を会話的に行う個人向け栄養管理エージェント。',
      url: 'http://meshi:8080/a2a',
      version: '0.0.0',
      capabilities: { streaming: true, pushNotifications: true },
      defaultInputModes: ['text/plain'],
      defaultOutputModes: ['text/plain'],
      skills: [
        {
          id: 'record_meal',
          name: '食事記録',
          description:
            'テキスト発話または画像 (写真) から食事ログを作成する。利用者の発話 + 任意の occurred_at / timezone、または画像 + 任意の補助テキストを受け取り、内部 LLM 経由で食事ログを作成する。',
          tags: ['meal', 'record'],
          inputModes: [
            'text/plain',
            'image/jpeg',
            'image/png',
            'image/gif',
            'image/webp',
          ],
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
      ],
    })
  })
})
