import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  fetchNutrientDefinitions,
  type NutrientDefinition,
} from '#api/nutrient-definitions'
import {
  fetchUserProfile,
  patchUserProfile,
  type UserProfile,
  type UserProfilePatch,
} from '#api/profile'
import { toPromise } from '#api/to-promise'
import { NutritionTargetsSection } from '#pages/settings/NutritionTargetsSection'
import { TagField } from '#pages/settings/TagField'
import styles from '#pages/SettingsPage.module.css'

const PROFILE_QUERY_KEY = ['profile']
const NUTRIENT_DEFINITIONS_QUERY_KEY = ['nutrient-definitions']

interface TagFieldSpec {
  key: 'likes' | 'dislikes' | 'allergies' | 'constraints'
  label: string
}

const TAG_FIELDS: ReadonlyArray<TagFieldSpec> = [
  { key: 'likes', label: '好きな食べ物' },
  { key: 'dislikes', label: '嫌いな食べ物' },
  { key: 'allergies', label: 'アレルギー' },
  { key: 'constraints', label: '制約' },
]

export const SettingsPage = (): React.JSX.Element => {
  const profileQuery = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: () => toPromise(fetchUserProfile()),
  })
  const nutrientDefinitionsQuery = useQuery({
    queryKey: NUTRIENT_DEFINITIONS_QUERY_KEY,
    queryFn: () => toPromise(fetchNutrientDefinitions()),
  })

  const queryClient = useQueryClient()
  const patchMutation = useMutation({
    mutationFn: (patch: UserProfilePatch) => toPromise(patchUserProfile(patch)),
    onSuccess: (profile: UserProfile) => {
      queryClient.setQueryData(PROFILE_QUERY_KEY, profile)
    },
    onError: (error) => {
      console.error('failed to update profile:', error)
    },
  })

  if (profileQuery.isPending || nutrientDefinitionsQuery.isPending) {
    return (
      <div>
        <Heading />
        <p className={styles.status}>読み込み中...</p>
      </div>
    )
  }

  if (profileQuery.isError || nutrientDefinitionsQuery.isError) {
    return (
      <div>
        <Heading />
        <p className={styles.status}>設定の読み込みに失敗しました。</p>
        <button
          type="button"
          className={styles.retryButton}
          onClick={() => {
            void profileQuery.refetch()
            void nutrientDefinitionsQuery.refetch()
          }}
        >
          再試行
        </button>
      </div>
    )
  }

  const profile = profileQuery.data
  const definitions: ReadonlyArray<NutrientDefinition> =
    nutrientDefinitionsQuery.data

  return (
    <div>
      <Heading />

      <section className={styles.section}>
        <SectionHeading label="プロフィール" />
        <div className={styles.fieldList}>
          {TAG_FIELDS.map(({ key, label }) => (
            <TagField
              key={key}
              label={label}
              tags={profile[key]}
              onAdd={(tag) => {
                patchMutation.mutate({ [key]: [...profile[key], tag] })
              }}
              onRemove={(tag) => {
                patchMutation.mutate({
                  [key]: profile[key].filter((t) => t !== tag),
                })
              }}
              disabled={patchMutation.isPending}
            />
          ))}
        </div>
      </section>

      {patchMutation.isError ? (
        <p className={styles.status}>
          保存に失敗しました。もう一度お試しください。
        </p>
      ) : null}

      <section>
        <SectionHeading label="栄養目標 (1 日あたり)" />
        <NutritionTargetsSection
          definitions={definitions}
          dailyTargets={profile.dailyTargets}
          onCommit={(code, value) => {
            patchMutation.mutate({ dailyTargets: { [code]: value } })
          }}
          disabled={patchMutation.isPending}
        />
      </section>
    </div>
  )
}

const Heading = (): React.JSX.Element => (
  <h1 className={styles.heading}>
    <span className={styles.hash}>#</span>設定
  </h1>
)

const SectionHeading = ({ label }: { label: string }): React.JSX.Element => (
  <div className={styles.sectionHeading}>
    <span className={styles.sectionHash}>##</span>
    <span className={styles.sectionLabel}>{label}</span>
  </div>
)
