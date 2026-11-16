import type { Meta, StoryObj } from '@storybook/react-vite'

import { BodyCompositionForm } from '#components/BodyCompositionForm/BodyCompositionForm'

const meta = {
  title: 'Components/BodyCompositionForm',
  component: BodyCompositionForm,
  args: {
    draft: {
      date: '2031-04-12',
      measuredTime: '',
      device: 'Example Scale Z',
      bodyFatPercent: '',
      muscleMassKg: '',
      skeletalMusclePercent: '',
    },
    editingId: null,
    onDraftChange: () => undefined,
    onSave: () => undefined,
    onCancelEdit: () => undefined,
    isSaving: false,
  },
} satisfies Meta<typeof BodyCompositionForm>

export default meta
type Story = StoryObj<typeof meta>

export const Empty = {
  name: 'the form is ready for a body composition measurement',
} satisfies Story

export const Editing = {
  name: 'the form is editing a partial measurement',
  args: {
    editingId: 'composition_demo_one',
    draft: {
      date: '2031-04-12',
      measuredTime: '07:20',
      device: 'Example Scale Z',
      bodyFatPercent: '24.5',
      muscleMassKg: '',
      skeletalMusclePercent: '31.2',
    },
  },
} satisfies Story

export const Saving = {
  name: 'the measurement is being saved',
  args: {
    draft: {
      date: '2031-04-12',
      measuredTime: '',
      device: 'Example Scale Z',
      bodyFatPercent: '24.5',
      muscleMassKg: '48.6',
      skeletalMusclePercent: '',
    },
    isSaving: true,
  },
} satisfies Story

export const SaveError = {
  name: 'the server rejected the measurement',
  args: {
    draft: {
      date: '2031-04-12',
      measuredTime: '',
      device: 'Example Scale Z',
      bodyFatPercent: '80',
      muscleMassKg: '',
      skeletalMusclePercent: '',
    },
    saveError: 'bodyFatPercent must be between 1 and 75',
  },
} satisfies Story
