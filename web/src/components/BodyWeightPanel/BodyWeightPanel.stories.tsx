import type { Meta, StoryObj } from '@storybook/react-vite'

import type { BodyWeight } from '#api/body-weights'
import { BodyWeightPanel } from '#components/BodyWeightPanel/BodyWeightPanel'

const record: BodyWeight = {
  id: 'weight_demo_alpha',
  date: '2031-04-12',
  measuredAt: '2031-04-12T00:20:00.000Z',
  weightKg: 63.4,
  createdAt: '2031-04-12T00:20:00.000Z',
  updatedAt: '2031-04-12T00:20:00.000Z',
}

const meta = {
  title: 'Components/BodyWeightPanel',
  component: BodyWeightPanel,
  args: {
    records: [],
    loadState: 'loaded',
    onRetry: () => undefined,
    period: 'week',
    rangeLabel: '2031-04-06 – 2031-04-12',
    canGoForward: false,
    onPeriodChange: () => undefined,
    onPreviousPeriod: () => undefined,
    onNextPeriod: () => undefined,
    draft: { date: '2031-04-12', weightKg: '', measuredTime: '' },
    editingId: null,
    onDraftChange: () => undefined,
    onSave: () => undefined,
    onCancelEdit: () => undefined,
    isSaving: false,
    deleteTarget: null,
    onRequestDelete: () => undefined,
    onCancelDelete: () => undefined,
    onConfirmDelete: () => undefined,
    isDeleting: false,
    onEdit: () => undefined,
  },
} satisfies Meta<typeof BodyWeightPanel>

export default meta
type Story = StoryObj<typeof meta>

export const Empty = {
  name: 'the selected period has no records',
} satisfies Story

export const Populated = {
  name: 'the list shows the newest measurements first',
  args: {
    records: [record],
  },
} satisfies Story

export const Editing = {
  name: 'the form is editing an existing measurement',
  args: {
    records: [record],
    editingId: record.id,
    draft: { date: record.date, weightKg: '63.4', measuredTime: '09:20' },
  },
} satisfies Story

export const ConfirmingDelete = {
  name: 'the user is confirming measurement deletion',
  args: {
    records: [record],
    deleteTarget: record,
  },
} satisfies Story

export const DeleteError = {
  name: 'the server rejected the requested deletion',
  args: {
    records: [record],
    deleteTarget: record,
    deleteError: '記録を削除できませんでした',
  },
} satisfies Story

export const Deleting = {
  name: 'the measurement is being deleted',
  args: {
    records: [record],
    deleteTarget: record,
    isDeleting: true,
  },
} satisfies Story

export const Saving = {
  name: 'the measurement is being saved',
  args: {
    draft: { date: '2031-04-12', weightKg: '63.4', measuredTime: '09:20' },
    isSaving: true,
  },
} satisfies Story

export const SaveError = {
  name: 'the server rejected the measurement',
  args: {
    draft: { date: '2031-04-12', weightKg: '301', measuredTime: '' },
    saveError: 'weightKg must be between 20 and 300 kg',
  },
} satisfies Story

export const Loading = {
  name: 'the measurement list is loading',
  args: {
    loadState: 'loading',
  },
} satisfies Story

export const LoadError = {
  name: 'the measurement list could not be loaded',
  args: {
    loadState: 'error',
    loadError: '記録を読み込めませんでした',
  },
} satisfies Story
