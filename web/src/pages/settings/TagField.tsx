import { useState } from 'react'

import styles from '#pages/settings/TagField.module.css'

export interface TagFieldProps {
  label: string
  tags: ReadonlyArray<string>
  onAdd: (tag: string) => void
  onRemove: (tag: string) => void
  disabled?: boolean
}

export const TagField = ({
  label,
  tags,
  onAdd,
  onRemove,
  disabled = false,
}: TagFieldProps): React.JSX.Element => {
  const [isAdding, setIsAdding] = useState(false)
  const [draft, setDraft] = useState('')

  const commitAdd = (): void => {
    const value = draft.trim()
    if (value !== '' && !tags.includes(value)) onAdd(value)
    setDraft('')
    setIsAdding(false)
  }

  return (
    <div>
      <div className={styles.label}>{label}</div>
      <div className={styles.tagRow}>
        {tags.map((tag) => (
          <span key={tag} className={styles.tag}>
            {tag}
            <button
              type="button"
              className={styles.removeButton}
              onClick={() => {
                onRemove(tag)
              }}
              disabled={disabled}
            >
              ×
            </button>
          </span>
        ))}
        {isAdding ? (
          <input
            autoFocus
            className={styles.draftInput}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value)
            }}
            onBlur={commitAdd}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitAdd()
              } else if (e.key === 'Escape') {
                setDraft('')
                setIsAdding(false)
              }
            }}
          />
        ) : (
          <button
            type="button"
            className={styles.addButton}
            onClick={() => {
              setIsAdding(true)
            }}
            disabled={disabled}
          >
            + 追加
          </button>
        )}
      </div>
    </div>
  )
}
