import type { StockStatus } from '#api/stock'
import type {
  ReceiveStockDeliveryInput,
  RegisterStockDeliveryInput,
} from '#api/stock-deliveries'

export type StockDeliveryEditorMode = 'create' | 'edit' | 'cancel' | 'receive'

export type PlannedDelivery = StockStatus['plannedDeliveries'][number]
export type StockItem = StockStatus['stockItems'][number]

interface StockDeliveryDraftItem {
  readonly foodMasterId: string
  readonly quantity: string
}

export interface StockDeliveryDraft {
  readonly sourceRef: string
  readonly expectedDate: string
  readonly changeDeadline: string
  readonly receivedDate: string
  readonly items: ReadonlyArray<StockDeliveryDraftItem>
}

export interface StockDeliveryEditorProps {
  readonly mode: StockDeliveryEditorMode
  readonly delivery: PlannedDelivery | null
  readonly isSubmitting: boolean
  readonly error?: string | undefined
  readonly onClose: () => void
  readonly onRegister: (input: RegisterStockDeliveryInput) => void
  readonly onReceive: (
    deliveryId: string,
    input: ReceiveStockDeliveryInput,
  ) => void
}

export interface StockDeliveryEditorViewProps extends Omit<
  StockDeliveryEditorProps,
  'onRegister' | 'onReceive'
> {
  readonly stockItems: ReadonlyArray<StockItem>
  readonly draft: StockDeliveryDraft
  readonly isConfirming: boolean
  readonly validationError?: string | undefined
  readonly onDraftChange: (update: Partial<StockDeliveryDraft>) => void
  readonly onItemChange: (
    index: number,
    update: Partial<StockDeliveryDraftItem>,
  ) => void
  readonly onAddItem: () => void
  readonly onRemoveItem: (index: number) => void
  readonly onFormSubmit: (event: React.SubmitEvent<HTMLFormElement>) => void
  readonly onConfirmationBack: () => void
  readonly onConfirmationConfirm: () => void
}
