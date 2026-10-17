import { Card, LinkButton } from '@/components/ui'
import type { SetupStep, SetupStepId } from '@/lib/setup'
import type { Dictionary } from '@/lib/i18n'

/**
 * Where each step sends somebody, kept here rather than in lib/setup.ts.
 *
 * That module decides what state the centre is in and stays free of routes, so it can
 * be tested without a router. This is the other half of the same decision.
 *
 * Two of them are the roster. That is not an oversight: the roster is where names are
 * added and it is also where the no-batch count and the per-row labels live, so
 * "add students" and "enrol them" genuinely are the same door with different work
 * behind it.
 *
 * `as const satisfies` rather than an annotation, because `typedRoutes` checks a
 * `Link`'s href against the real route table and a widened `string` does not pass.
 * A path typed here that no longer exists fails the build.
 */
const HREF = {
  students: '/settings/students',
  batches: '/settings/batches/new',
  enrolments: '/settings/students',
  attendance: '/teach',
} as const satisfies Record<SetupStepId, string>

/**
 * The four things a centre has to do before any of this product does anything.
 *
 * WHY IT IS ON THE DASHBOARD and not in a settings screen. Nobody opens a screen to
 * find out whether they need to open it — the same reason the reminder door and the
 * at-risk card are here. And the specific failure it prevents happens on the dashboard:
 * an owner who has pasted their register lands on ৳0 outstanding, 0 batches marked and
 * nobody at risk, every figure honest and every figure useless, with nothing on screen
 * saying which of four steps is missing.
 *
 * ONE BUTTON, NOT FOUR. All four steps are listed, because an owner deciding whether
 * this is worth an evening needs to see how much is left — but only the first
 * unfinished one carries its reason and its link. Four buttons would be a to-do list to
 * plan; one is an instruction to follow. `setupSteps` picks it, in dependency order, so
 * nobody is ever asked to enrol students into a batch that does not exist yet.
 *
 * AND IT ENDS. Nothing is stored about having dismissed it: `setupSteps` returns null
 * once all four are true, so the card simply stops appearing. Which also means it comes
 * back if a centre closes its last batch over a winter break — correctly, because in
 * that week they really cannot take a register.
 *
 * A server component, so it takes the dictionary group directly and the `Dictionary`
 * type rather than `T` — see the same note on AttendanceRates.
 */
export function SetupCard({
  steps,
  t,
}: {
  steps: SetupStep[]
  t: Dictionary['dashboard']['setup']
}) {
  return (
    <Card className="border-brand-200">
      <h2 className="font-semibold text-ink">{t.title}</h2>
      <p className="mt-1 text-sm text-ink-soft">{t.body}</p>

      <ol className="mt-4 flex flex-col gap-3">
        {steps.map((step) => {
          const copy = t.steps[step.id]
          return (
            <li key={step.id} className="flex items-start gap-3">
              {/* The tick carries a word as well as a shape. A green ✓ against a grey
                  ring is the same colour-alone reading the attendance bands refuse,
                  and the ring has no accessible name of its own. */}
              <span
                aria-hidden="true"
                className={
                  step.done
                    ? 'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-present text-xs font-bold text-white'
                    : 'mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-line'
                }
              >
                {step.done ? '✓' : ''}
              </span>
              <div className="min-w-0">
                <p
                  className={
                    step.done
                      ? 'text-sm text-ink-faint line-through'
                      : 'font-medium text-ink'
                  }
                >
                  {copy.label}
                  {step.done && <span className="sr-only"> — {t.done}</span>}
                </p>
                {/* Only the step being asked for explains itself. On every other row
                    the reason is either already understood or not yet relevant, and
                    four explanations is a page rather than a card. */}
                {step.next && (
                  <>
                    <p className="mt-0.5 text-sm text-ink-soft">{copy.why}</p>
                    <LinkButton href={HREF[step.id]} className="mt-2">
                      {copy.action}
                    </LinkButton>
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </Card>
  )
}
