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
 * AND A FOURTH NUMBER ARRIVED BESIDE THEM (20260811000098): the roster a trial may hold.
 * It is not a price — nothing about it appears on a bill — which is exactly why it is here
 * and not in `price_versions`, where §11.10 keeps the reviewed figures. See
 * `trialRosterCeiling`: the reader passes it on as null when it cannot be read, and the
 * fence refuses on null rather than treating it as no bound.
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
  /**
   * How many active students a trial may hold before it has to be funded, or null when the
   * row could not be read.
   *
   * NULL IS NOT ZERO, and the difference is the whole of this field's meaning: zero is the
   * founder's own "no bound", and a read that failed is a policy nobody can state — so the
   * fence refuses on null and opens on zero (`trialRosterRefusal` in plans.ts, `CD006` in the
   * database as `app.guard_trial_roster`, 20260811000098). Reading a failed query as "no
   * bound" is the one direction that would open the last dimension a free account can grow.
   */
  trialRosterCeiling: number | null
}

/**
 * The roster a trial may hold when the row cannot be read, for the one screen that has to
 * draw a number.
 *
 * THE DATABASE OWNS THIS FIGURE and this is a mirror of its default — 20260811000098 adds
 * `platform_settings.trial_roster_ceiling` with `default 500`, one `MAX_IMPORT_ROWS` paste —
 * kept for the founder's own card, which would otherwise print "null" into a box the founder
 * is about to save, and for nothing else. It is deliberately NOT
 * read by the fence: `trialRosterCeiling` is null when the read failed, `trialRosterRefusal`
 * refuses on null, and a fallback number there would be a policy this file invented rather
 * than the one on the row. tests/trial-roster.test.ts holds the two defaults together.
 */
export const DEFAULT_TRIAL_ROSTER_CEILING = 500

export const NO_TRIAL: PlatformSettings = {
  teacherTrialDays: 0,
  centerTrialDays: 0,
  institutionTrialDays: 0,
  trialRosterCeiling: null,
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
    .select(
      'teacher_trial_days, center_trial_days, institution_trial_days, trial_roster_ceiling',
    )
    .maybeSingle()

  if (error || !data) return NO_TRIAL

  return {
    teacherTrialDays: days(data.teacher_trial_days),
    centerTrialDays: days(data.center_trial_days),
    institutionTrialDays: days(data.institution_trial_days),
    // `null` for anything that is not a whole, non-negative count — including a null, which
    // is a column nobody has written rather than a bound of nothing. See the type's own note.
    trialRosterCeiling:
      typeof data.trial_roster_ceiling === 'number' &&
      Number.isFinite(data.trial_roster_ceiling) &&
      data.trial_roster_ceiling >= 0
        ? Math.floor(data.trial_roster_ceiling)
        : null,
  }
}
