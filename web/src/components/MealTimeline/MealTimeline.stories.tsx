import type { Meta, StoryObj } from '@storybook/react-vite'

import type { DayDetailEntry } from '#api/day-detail'
import type { MealPhoto } from '#api/meal-photos'
import type { MealPlan } from '#api/meal-plans'
import { MealPhotoGallery } from '#components/MealPhotoGallery/MealPhotoGallery'
import { MealSetSaveForm } from '#components/MealSetSaveForm/MealSetSaveForm'
import { buildMealTimelineGroups } from '#components/MealTimeline/build-meal-timeline-groups'
import { MealTimeline } from '#components/MealTimeline/MealTimeline'

const ENTRIES: ReadonlyArray<DayDetailEntry> = [
  {
    id: 'l1',
    foodMasterId: 'rice',
    foodName: '白米',
    eatenDate: '2026-07-29',
    mealType: 'breakfast',
    quantity: 150,
    kcal: 234,
    isEstimated: false,
    nutritionStatus: 'confirmed',
    nutritionVersion: {
      versionNo: 1,
      changeKind: 'initial',
      source: 'web_search',
      isEstimated: false,
      checkedOn: '2026-07-20',
      effectiveFrom: null,
    },
    nutritionVersionOrigin: 'recorded',
    nutritionVersionDifferences: [],
  },
  {
    id: 'l2',
    foodMasterId: 'udon',
    foodName: 'うどん',
    eatenDate: '2026-07-29',
    mealType: 'lunch',
    quantity: 1,
    kcal: 300,
    isEstimated: false,
    nutritionStatus: 'confirmed',
    nutritionVersion: {
      versionNo: 1,
      changeKind: 'initial',
      source: 'web_search',
      isEstimated: false,
      checkedOn: '2026-07-20',
      effectiveFrom: null,
    },
    nutritionVersionOrigin: 'recorded',
    nutritionVersionDifferences: [],
  },
  {
    id: 'l3',
    foodMasterId: 'mystery_stew',
    foodName: 'なぞのシチュー',
    eatenDate: '2026-07-29',
    mealType: 'dinner',
    quantity: 1,
    kcal: 480,
    isEstimated: true,
    nutritionStatus: 'estimated',
    nutritionVersion: {
      versionNo: 7,
      changeKind: 'initial',
      source: 'model_estimate',
      isEstimated: true,
      checkedOn: null,
      effectiveFrom: null,
    },
    nutritionVersionOrigin: 'recorded',
    nutritionVersionDifferences: [],
  },
]

const UNKNOWN_ENTRY: DayDetailEntry = {
  id: 'l4',
  foodMasterId: 'unknown-food',
  foodName: '不明なメニュー',
  eatenDate: '2026-07-29',
  mealType: 'dinner',
  quantity: 1,
  kcal: null,
  isEstimated: false,
  nutritionStatus: 'unknown',
  nutritionVersion: null,
  nutritionVersionOrigin: 'recorded',
  nutritionVersionDifferences: [],
}

const meta: Meta<typeof MealTimeline> = {
  title: 'components/MealTimeline',
  component: MealTimeline,
}

export default meta

type Story = StoryObj<typeof MealTimeline>

export const Default: Story = {
  name: '一日の食事記録を時間帯ごとに表示しています',
  args: { groups: buildMealTimelineGroups(ENTRIES, []) },
}

export const Empty: Story = {
  name: '食事記録がない日の空のタイムラインです',
  args: { groups: buildMealTimelineGroups([], []) },
}

export const WithSkipsAndUnrecorded: Story = {
  name: '昼食がスキップされた日のタイムラインです',
  args: {
    groups: buildMealTimelineGroups(
      ENTRIES.filter((entry) => entry.mealType === 'breakfast'),
      ['lunch'],
    ),
  },
}

export const WithUnknownNutrition: Story = {
  name: '夕食に栄養値不明の食品が含まれています',
  args: { groups: buildMealTimelineGroups([...ENTRIES, UNKNOWN_ENTRY], []) },
}

const ENTRY_WITH_DIFFERENT_VERSION: DayDetailEntry = {
  id: 'l6',
  foodMasterId: 'versioned-food',
  foodName: 'バージョン差のあるメニュー',
  eatenDate: '2026-07-29',
  mealType: 'lunch',
  quantity: 1,
  kcal: 260,
  isEstimated: false,
  nutritionStatus: 'confirmed',
  nutritionVersion: {
    versionNo: 48,
    changeKind: 'initial',
    source: 'web_search',
    isEstimated: false,
    checkedOn: '2026-07-20',
    effectiveFrom: null,
  },
  nutritionVersionOrigin: 'recorded',
  nutritionVersionDifferences: [
    {
      versionNo: 49,
      changeKind: 'product_update',
      source: 'web_search',
      isEstimated: false,
      checkedOn: '2026-07-22',
      effectiveFrom: null,
    },
  ],
}

export const WithDifferentNutritionVersion: Story = {
  name: '昼食に栄養値の異なるバージョンがある食品を含んでいます',
  args: {
    groups: buildMealTimelineGroups([ENTRY_WITH_DIFFERENT_VERSION], []),
  },
}

const ENTRY_WITHOUT_KCAL: DayDetailEntry = {
  id: 'l5',
  foodMasterId: 'meal-without-kcal',
  foodName: 'エネルギー値が登録されていない食品',
  eatenDate: '2026-07-29',
  mealType: 'snack',
  quantity: 1,
  kcal: null,
  isEstimated: false,
  nutritionStatus: 'confirmed',
  nutritionVersion: {
    versionNo: 1,
    changeKind: 'initial',
    source: 'web_search',
    isEstimated: false,
    checkedOn: '2026-07-20',
    effectiveFrom: null,
  },
  nutritionVersionOrigin: 'recorded',
  nutritionVersionDifferences: [],
}

const MEAL_PHOTO: MealPhoto = {
  id: 'meal_photo_one',
  date: '2026-07-29',
  mealType: 'breakfast',
  contentType: 'image/jpeg',
  createdAt: '2026-07-29T03:00:01.000Z',
  contentUrl:
    'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"%3E%3Crect width="120" height="120" fill="%232a2a2a"/%3E%3Ccircle cx="60" cy="60" r="32" fill="%23ef4444"/%3E%3C/svg%3E',
}

export const WithoutKcalValue: Story = {
  name: 'エネルギー値が登録されていない食品を含んでいます',
  args: {
    groups: buildMealTimelineGroups([...ENTRIES, ENTRY_WITHOUT_KCAL], []),
  },
}

export const WithMealPhoto: Story = {
  name: '朝食の見出しの下に写真を並べています',
  args: {
    groups: buildMealTimelineGroups(ENTRIES, []),
    renderMealPhotos: (mealType) =>
      mealType === 'breakfast' ? (
        <MealPhotoGallery
          mealName="朝食"
          photos={[MEAL_PHOTO]}
          onUpload={() => undefined}
          onPhotoClick={() => undefined}
          onClosePreview={() => undefined}
          onRequestDelete={() => undefined}
          onCancelDeleteConfirmation={() => undefined}
          onDeletePhoto={() => undefined}
        />
      ) : null,
  },
}

const PLANNED_MEAL: MealPlan = {
  id: 'plan_fixture_001',
  date: '2026-07-29',
  mealType: 'dinner',
  reason: '作業後に食べる予定',
  status: 'planned',
  items: [
    {
      foodMasterId: 'fixture_food_a',
      foodName: '架空食品 A',
      quantity: 1.5,
      energyKcalPerUnit: 130,
    },
  ],
}

export const WithMealPlan: Story = {
  name: '夕食の予定に品目と変更・取り消し操作を表示しています',
  args: {
    dateKind: 'today',
    groups: buildMealTimelineGroups([], [], [PLANNED_MEAL]),
    onEditPlan: () => undefined,
    onCancelPlan: () => undefined,
  },
}

export const PlanCancellationFailed: Story = {
  name: '夕食の予定を取り消せずエラーを表示しています',
  args: {
    dateKind: 'today',
    groups: buildMealTimelineGroups([], [], [PLANNED_MEAL]),
    planActionError: {
      planId: PLANNED_MEAL.id,
      message: 'この予定は取り消せません。',
    },
  },
}

export const FutureWithoutPlans: Story = {
  name: '未来日の予定がない食事枠を表示しています',
  args: {
    dateKind: 'future',
    groups: buildMealTimelineGroups([], []),
    onCreatePlan: () => undefined,
  },
}

export const MealSetSaveFormOpen: Story = {
  name: '朝食をマイセットとして保存するフォームを表示しています',
  args: {
    groups: buildMealTimelineGroups(ENTRIES, []),
    saveMealSetFormMealType: 'breakfast',
    onToggleMealSetSave: () => undefined,
    renderMealSetSaveForm: (mealType) =>
      mealType === 'breakfast' ? (
        <MealSetSaveForm
          id="meal-set-save-breakfast"
          mealLabel="朝食"
          name="朝の定番"
          onNameChange={() => undefined}
          onSave={() => undefined}
          onCancel={() => undefined}
        />
      ) : null,
  },
}
