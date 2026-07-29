import styles from '#pages/PagePlaceholder.module.css'

export interface PagePlaceholderProps {
  title: string
  description: string
}

export const PagePlaceholder = ({
  title,
  description,
}: PagePlaceholderProps): React.JSX.Element => (
  <div>
    <h1 className={styles.heading}>
      <span className={styles.hash}>#</span>
      <span className={styles.title}>{title}</span>
    </h1>
    <p className={styles.description}>{description}</p>
  </div>
)
