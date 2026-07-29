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
          <TagField
            label="好きな食べ物"
            tags={profile.likes}
            onAdd={(tag) => {
              patchMutation.mutate({ likes: [...profile.likes, tag] })
            }}
            onRemove={(tag) => {
              patchMutation.mutate({
                likes: profile.likes.filter((t) => t !== tag),
              })
            }}
            disabled={patchMutation.isPending}
          />
          <TagField
            label="嫌いな食べ物"
            tags={profile.dislikes}
            onAdd={(tag) => {
              patchMutation.mutate({ dislikes: [...profile.dislikes, tag] })
            }}
            onRemove={(tag) => {
              patchMutation.mutate({
                dislikes: profile.dislikes.filter((t) => t !== tag),
              })
            }}
            disabled={patchMutation.isPending}
          />
          <TagField
            label="アレルギー"
            tags={profile.allergies}
            onAdd={(tag) => {
              patchMutation.mutate({ allergies: [...profile.allergies, tag] })
            }}
            onRemove={(tag) => {
              patchMutation.mutate({
                allergies: profile.allergies.filter((t) => t !== tag),
              })
            }}
            disabled={patchMutation.isPending}
          />
          <TagField
            label="制約"
            tags={profile.constraints}
            onAdd={(tag) => {
              patchMutation.mutate({
                constraints: [...profile.constraints, tag],
              })
            }}
            onRemove={(tag) => {
              patchMutation.mutate({
                constraints: profile.constraints.filter((t) => t !== tag),
              })
            }}
            disabled={patchMutation.isPending}
          />
        </div>
      </section>

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
