import type { Meta, StoryObj } from '@storybook/react-vite'

import { NutritionBasis } from '#components/NutritionBasis/NutritionBasis'

const meta: Meta<typeof NutritionBasis> = {
  title: 'components/NutritionBasis',
  component: NutritionBasis,
}

export default meta

type Story = StoryObj<typeof NutritionBasis>

export const NotEstimated: Story = {
  name: '登録時の栄養値が推定値ではありません',
  args: {
    nutritionVersion: {
      versionNo: 42,
      changeKind: 'initial',
      source: 'web_search',
      isEstimated: false,
      checkedOn: '2026-10-01',
      effectiveFrom: '2026-09-15',
    },
    nutritionVersionOrigin: 'recorded',
    nutritionVersionDifferences: [],
  },
}

export const Estimated: Story = {
  name: '登録時の栄養値が推定値です',
  args: {
    nutritionVersion: {
      versionNo: 43,
      changeKind: 'initial',
      source: 'composition_table_estimate',
      isEstimated: true,
      checkedOn: '2026-10-02',
      effectiveFrom: null,
    },
    nutritionVersionOrigin: 'recorded',
    nutritionVersionDifferences: [],
  },
}

export const MigratedWithUnknownDates: Story = {
  name: '移行前からの記録で確認日と適用開始日が不明です',
  args: {
    nutritionVersion: {
      versionNo: 44,
      changeKind: 'initial',
      source: 'user_input',
      isEstimated: false,
      checkedOn: null,
      effectiveFrom: null,
    },
    nutritionVersionOrigin: 'migrated',
    nutritionVersionDifferences: [],
  },
}

export const WithDifferentVersions: Story = {
  name: '食べた商品を確認していない値違いのバージョンがあります',
  args: {
    nutritionVersion: {
      versionNo: 45,
      changeKind: 'correction',
      source: 'web_search',
      isEstimated: false,
      checkedOn: '2026-10-03',
      effectiveFrom: '2026-10-01',
    },
    nutritionVersionOrigin: 'recorded',
    nutritionVersionDifferences: [
      {
        versionNo: 46,
        changeKind: 'product_update',
        source: 'model_estimate',
        isEstimated: true,
        checkedOn: null,
        effectiveFrom: null,
      },
    ],
  },
}

export const Filled: Story = {
  name: '不明だった栄養値を補完したときにバージョンを割り当てています',
  args: {
    nutritionVersion: {
      versionNo: 47,
      changeKind: 'product_update',
      source: 'user_input',
      isEstimated: false,
      checkedOn: '2026-10-04',
      effectiveFrom: null,
    },
    nutritionVersionOrigin: 'filled',
    nutritionVersionDifferences: [],
  },
}

export const Reassigned: Story = {
  name: '採用バージョンが手動で差し替えられています',
  args: {
    nutritionVersion: {
      versionNo: 48,
      changeKind: 'correction',
      source: 'web_search',
      isEstimated: false,
      checkedOn: '2026-10-05',
      effectiveFrom: '2026-10-01',
    },
    nutritionVersionOrigin: 'reassigned',
    nutritionVersionDifferences: [],
  },
}

export const VersionUnknown: Story = {
  name: '採用バージョンが不明です',
  args: {
    nutritionVersion: null,
    nutritionVersionOrigin: 'migrated',
    nutritionVersionDifferences: [],
  },
}
