import type { Meta, StoryObj } from '@storybook/react-vite'

import { RecordDeleteDialog } from '#components/RecordDeleteDialog/RecordDeleteDialog'

const meta = {
  title: 'Components/RecordDeleteDialog',
  component: RecordDeleteDialog,
  args: {
    title: '記録を削除しますか?',
    message: '選択した記録を削除します。',
    confirmLabel: '削除する',
    pendingLabel: '削除中...',
    confirmAriaLabel: '記録を削除',
    isPending: false,
    onCancel: () => undefined,
    onConfirm: () => undefined,
  },
} satisfies Meta<typeof RecordDeleteDialog>

export default meta
type Story = StoryObj<typeof meta>

export const Confirming = {
  name: 'the user is confirming a record deletion',
} satisfies Story

export const Deleting = {
  name: 'the record is being deleted',
  args: { isPending: true },
} satisfies Story

export const DeleteError = {
  name: 'the server rejected the deletion',
  args: { error: '記録を削除できませんでした' },
} satisfies Story
