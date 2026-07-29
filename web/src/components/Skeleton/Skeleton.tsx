import styles from '#components/Skeleton/Skeleton.module.css'

export interface SkeletonProps {
  readonly height?: number | string
  readonly width?: number | string
}

export const Skeleton = ({
  height = 16,
  width = '100%',
}: SkeletonProps): React.JSX.Element => (
  <div className={styles.skeleton} style={{ height, width }} />
)
