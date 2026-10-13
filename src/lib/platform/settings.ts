import 'server-only'

/**
 * The platform's own settings — the three trial lengths — read in one place.
 *
 * MASTERPLAN.md §4.3 names the trials; 20260811000091 made them a table so the founder can
 * change them without a deployment, and this is the reading half of it. The writing half is
 * `public.founder_set_trial_days`, a definer function, because `platform_settings` holds no
 * write grant for a browser at all.
 *
 * THREE READERS, ONE ROW. The signup screen quotes these before anybody agrees to them, the
 * founder panel edits them, and `public.bootstrap_center` reads the same row inside the
 * database — so the number promised on a page and the days actually granted are one row
 * rather than two constants that agree until somebody changes one.
 *
 * A FAILED READ IS ZERO DAYS AND NOT AN ERROR. The caller is a screen deciding whether to
 * promise a trial, and the honest answer to "we could not read how long the trial is" is not
 * to promise one. `bootstrap_center` takes the same reading from the same row — no number, no
 * trial — so a screen and a grant cannot disagree about a missing row.
 */
export type PlatformSettings = {
  teacherTrialDays: number
  centerTrialDays: number
  institutionTrialDays: number
}

export const NO_TRIAL: PlatformSettings = {
  teacherTrialDays: 0,
  centerTrialDays: 0,
  institutionTrialDays: 0,
}

/** A whole, non-negative day count, or zero for anything that is not one. */
function days(value: number | null | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

export async function readPlatformSettings(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>,
): Promise<PlatformSettings> {
  const { data, error } = await supabase
    .from('platform_settings')
    .select('teacher_trial_days, center_trial_days, institution_trial_days')
    .maybeSingle()

  if (error || !data) return NO_TRIAL

  return {
    teacherTrialDays: days(data.teacher_trial_days),
    centerTrialDays: days(data.center_trial_days),
    institutionTrialDays: days(data.institution_trial_days),
  }
}
