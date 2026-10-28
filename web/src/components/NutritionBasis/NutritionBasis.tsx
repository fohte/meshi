import type { NutritionVersion, NutritionVersionOrigin } from '#api/day-detail'
import { SOURCE_LABELS } from '#api/foods'
import styles from '#components/NutritionBasis/NutritionBasis.module.css'

const CHANGE_KIND_LABELS: Record<NutritionVersion['changeKind'], string> = {
  initial: '初回登録',
  product_update: '商品アップデート',
  correction: '訂正',
}

const ORIGIN_LABELS: Record<NutritionVersionOrigin, string> = {
  recorded: '記録した時点の現行バージョン',
  migrated: 'バージョン管理の導入前から参照していた値。記録時の値かは不明',
  filled: '栄養値が不明だったため、補完時に割り当て',
  reassigned: '手動で差し替え',
}

export interface NutritionBasisProps {
  readonly nutritionVersion: NutritionVersion | null
  readonly nutritionVersionOrigin: NutritionVersionOrigin
  readonly nutritionVersionDifferences: ReadonlyArray<NutritionVersion>
}

const formatDate = (date: string | null): string => date ?? '不明'

export const NutritionBasis = ({
  nutritionVersion,
  nutritionVersionOrigin,
  nutritionVersionDifferences,
}: NutritionBasisProps): React.JSX.Element => (
  <section className={styles.basis} aria-labelledby="nutrition-basis-title">
    <h3 id="nutrition-basis-title" className={styles.title}>
      栄養の根拠
    </h3>
    {nutritionVersion === null ? (
      <p className={styles.unknownVersion}>
        このログの採用バージョンは不明です
      </p>
    ) : (
      <>
        <dl className={styles.details}>
          <div className={styles.row}>
            <dt>バージョン</dt>
            <dd>
              v{nutritionVersion.versionNo} ·{' '}
              {CHANGE_KIND_LABELS[nutritionVersion.changeKind]}
            </dd>
          </div>
          <div className={styles.row}>
            <dt>値の出所</dt>
            <dd>
              {SOURCE_LABELS[nutritionVersion.source]} (
              {nutritionVersion.isEstimated ? '推定値' : '推定値ではない'})
            </dd>
          </div>
          <div className={styles.row}>
            <dt>確認日</dt>
            <dd
              className={
                nutritionVersion.checkedOn === null
                  ? styles.unknownValue
                  : undefined
              }
            >
              {formatDate(nutritionVersion.checkedOn)}
            </dd>
          </div>
          <div className={styles.row}>
            <dt>適用開始日</dt>
            <dd
              className={
                nutritionVersion.effectiveFrom === null
                  ? styles.unknownValue
                  : undefined
              }
            >
              {formatDate(nutritionVersion.effectiveFrom)}
            </dd>
          </div>
          <div
            className={[
              styles.row ?? '',
              nutritionVersionOrigin === 'migrated' ||
              nutritionVersionOrigin === 'filled'
                ? (styles.uncertainOrigin ?? '')
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <dt>採用の経緯</dt>
            <dd>{ORIGIN_LABELS[nutritionVersionOrigin]}</dd>
          </div>
        </dl>

        {nutritionVersionDifferences.length > 0 && (
          <div className={styles.differences}>
            <p className={styles.differencesHeading}>
              ≠ 値の違うバージョンがあり、食べた商品がどれかは確認していません
            </p>
            <ul className={styles.differencesList}>
              {nutritionVersionDifferences.map((version) => (
                <li key={version.versionNo}>
                  v{version.versionNo} ·{' '}
                  {CHANGE_KIND_LABELS[version.changeKind]} ·{' '}
                  {SOURCE_LABELS[version.source]} · 確認日{' '}
                  <span
                    className={
                      version.checkedOn === null
                        ? styles.unknownValue
                        : undefined
                    }
                  >
                    {formatDate(version.checkedOn)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>
    )}
  </section>
)
