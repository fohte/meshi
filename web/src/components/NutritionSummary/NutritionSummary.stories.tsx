import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router'

import type { NutrientDefinition } from '#api/nutrient-definitions'
import { buildNutritionSummaryData } from '#components/NutritionSummary/build-nutrition-summary-data'
import { NutritionSummary } from '#components/NutritionSummary/NutritionSummary'

const DEFINITIONS: ReadonlyArray<NutrientDefinition> = [
  {
    code: 'energy_kcal',
    displayName: 'エネルギー',
    unit: 'kcal',
    isMajor: true,
    sortOrder: 1,
  },
  {
    code: 'protein_g',
    displayName: 'たんぱく質',
    unit: 'g',
    isMajor: true,
    sortOrder: 2,
  },
  {
    code: 'fat_g',
    displayName: '脂質',
    unit: 'g',
    isMajor: true,
    sortOrder: 3,
  },
  {
    code: 'carb_g',
    displayName: '炭水化物',
    unit: 'g',
    isMajor: true,
    sortOrder: 4,
  },
  {
    code: 'dietary_fiber_g',
    displayName: '食物繊維',
    unit: 'g',
    isMajor: true,
    sortOrder: 5,
  },
  {
    code: 'salt_g',
    displayName: '食塩相当量',
    unit: 'g',
    isMajor: true,
    sortOrder: 6,
  },
  {
    code: 'iron_mg',
    displayName: '鉄',
    unit: 'mg',
    isMajor: false,
    sortOrder: 7,
  },
  {
    code: 'vitamin_c_mg',
    displayName: 'ビタミン C',
    unit: 'mg',
    isMajor: false,
    sortOrder: 8,
  },
]

const meta: Meta<typeof NutritionSummary> = {
  title: 'components/NutritionSummary',
  component: NutritionSummary,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
}

export default meta

type Story = StoryObj<typeof NutritionSummary>

export const WithTargets: Story = {
  args: {
    hasEstimatedValues: true,
    data: buildNutritionSummaryData(
      {
        energy_kcal: 1820,
        protein_g: 92,
        fat_g: 55,
        carb_g: 230,
        dietary_fiber_g: 16,
        salt_g: 6.2,
        iron_mg: 6.1,
        vitamin_c_mg: 45,
      },
      DEFINITIONS,
      {
        energy_kcal: 2200,
        protein_g: 110,
        fat_g: 60,
        dietary_fiber_g: 21,
        salt_g: 7.5,
      },
    ),
  },
}

export const NoTargets: Story = {
  args: {
    hasEstimatedValues: false,
    data: buildNutritionSummaryData(
      { energy_kcal: 1500, protein_g: 60, fat_g: 40, carb_g: 200 },
      DEFINITIONS,
      null,
    ),
  },
}

export const Empty: Story = {
  args: {
    hasEstimatedValues: false,
    data: buildNutritionSummaryData({}, DEFINITIONS, null),
  },
}
