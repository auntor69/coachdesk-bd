/**
 * The handful of primitives every screen shares.
 *
 * Deliberately small and unabstracted — a design system is a thing you extract
 * after you have five screens, not before you have one. What is here exists
 * because getting it wrong breaks the product on a real phone: tap targets
 * below 48px, text under 16px (which makes iOS zoom on focus), and buttons that
 * give no feedback on a slow connection.
 */
import Link from 'next/link'
import type { Route } from 'next'
import type { ComponentProps, ReactNode } from 'react'

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'ghost'
  | 'danger'
  /** A forward action that is not the screen's only one: the brand-tinted outline. */
  | 'tinted'

type ButtonProps = ComponentProps<'button'> & {
  variant?: ButtonVariant
  full?: boolean
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl px-5 min-h-tap '
  + 'font-semibold transition-colors disabled:opacity-50 '
  + 'disabled:cursor-not-allowed active:scale-[0.99]'

/*
 * TWO OF EVERYTHING: A `<button>` AND A LINK.
 *
 * The link flavour exists because a navigation action and a form action look the same to a
 * reader and are not the same element — and twelve screens had noticed, each writing the
 * same classes by hand around a `<Link>`. They had drifted in the three ways hand-copies
 * always do: `px-4` against this file's `px-5`, so a link sat four pixels narrower than the
 * button beside it; no `active:scale`, so half the controls in the product answered a tap
 * and half did not; and no `disabled:` pair, which nobody noticed because a link is never
 * disabled — until somebody adds one.
 *
 * `buttonClass` is the seam both halves share, so the base can only be edited once. It is
 * exported because a few places genuinely need neither: the fee register's print button,
 * which is a `<button>` with an `onClick`, and the radio-cards in the batch and centre
 * forms, which are labels.
 */
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'bg-white text-ink border-2 border-line hover:border-brand-300',
  ghost: 'text-brand-700 hover:bg-brand-50',
  danger: 'bg-absent text-white hover:brightness-95',
  tinted: 'border-2 border-brand-500 bg-brand-50 font-medium text-brand-800 hover:bg-brand-100',
}

/** The shared class string, so a `<button>` and a `<Link>` cannot drift apart. */
export function buttonClass(
  variant: ButtonVariant = 'primary',
  full = false,
  className = '',
): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${full ? 'w-full' : ''} ${className}`
}

export function Button({
  variant = 'primary',
  full,
  className = '',
  ...props
}: ButtonProps) {
  return <button className={buttonClass(variant, full, className)} {...props} />
}

/**
 * A navigation action wearing the button styles.
 *
 * Generic over the route string for the reason `PageHeader`'s crumb is: bare `Route`
 * resolves its dynamic branch against `string`, which is `never`, so it would admit
 * `/fees` and reject `/fees/${id}` — and half the links that need this are sub-screens of
 * a dynamic route. Inferring from the href lets both through while a path matching no
 * route at all still fails the build.
 */
export function LinkButton<RouteType extends string>({
  href,
  variant = 'primary',
  full = false,
  className = '',
  children,
  prefetch,
  ...props
}: Omit<ComponentProps<'a'>, 'href' | 'className' | 'children'> & {
  href: Route<RouteType>
  variant?: ButtonVariant
  full?: boolean
  className?: string
  children: ReactNode
  /** Next's own, kept because a link to a live queue may not want to prefetch it. */
  prefetch?: boolean
}) {
  return (
    <Link href={href} prefetch={prefetch} className={buttonClass(variant, full, className)} {...props}>
      {children}
    </Link>
  )
}

type FieldProps = ComponentProps<'input'> & {
  label: string
  hint?: string
  error?: string
}

export function Field({ label, hint, error, id, className = '', ...props }: FieldProps) {
  const inputId = id ?? props.name
  const errorId = error ? `${inputId}-error` : undefined
  const hintId = hint ? `${inputId}-hint` : undefined

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="font-medium text-ink">
        {label}
      </label>
      {hint && (
        <span id={hintId} className="text-sm text-ink-soft">
          {hint}
        </span>
      )}
      <input
        id={inputId}
        // text-base is load-bearing: iOS Safari zooms the whole page when a
        // focused input is under 16px, and the layout never recovers.
        // The `disabled:` trio is here rather than at each call site because read-only is a
        // first-class state in this product (§4.4): a centre whose balance has run out is
        // looking at forms it cannot write, and an input that greys to the browser's default
        // looks like a rendering fault next to one that greys to this sheet's own surface.
        className={`min-h-tap rounded-xl border-2 bg-white px-4 text-base
          outline-none transition-colors placeholder:text-ink-faint
          focus:border-brand-500 disabled:cursor-not-allowed disabled:bg-surface-alt
          disabled:text-ink-soft ${error ? 'border-absent' : 'border-line'} ${className}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={[errorId, hintId].filter(Boolean).join(' ') || undefined}
        {...props}
      />
      {error && (
        <span id={errorId} role="alert" className="text-sm font-medium text-absent">
          {error}
        </span>
      )}
    </div>
  )
}

export function Card({
  children,
  className = '',
  id,
}: {
  children: ReactNode
  className?: string
  /** For an in-page anchor — a `#pay` link somewhere above scrolling to this card. */
  id?: string
}) {
  return (
    <div
      id={id}
      className={`rounded-2xl border border-line bg-white p-5 shadow-sm ${className}`}
    >
      {children}
    </div>
  )
}

const ALERT_TONES = {
  error: 'border-absent/30 bg-absent/5 text-absent',
  // Amber, because some banners are a question rather than a failure — "this
  // number already has an account, is it the right person?" is not an error, and
  // red trains people to dismiss it without reading.
  warn: 'border-late/40 bg-late/5 text-late',
  ok: 'border-brand-300 bg-brand-50 text-brand-800',
} as const

/** Full-width banner. role="alert" so a screen reader announces it. */
export function Alert({
  children,
  tone = 'error',
}: {
  children: ReactNode
  tone?: keyof typeof ALERT_TONES
}) {
  return (
    <div
      role="alert"
      className={`rounded-xl border-2 px-4 py-3 font-medium ${ALERT_TONES[tone]}`}
    >
      {children}
    </div>
  )
}

export function Logo({
  className = '',
  tone = 'brand',
}: {
  className?: string
  /**
   * `inverse` for the brand panel that fills the left half of a desktop `/login` and
   * `/signup` — the wordmark sits on `brand-700` there, where `text-brand-800` is a green
   * on a green. Two tones and not a colour prop: a logo tinted by hand at each call site is
   * how a product ends up with two wordmarks a shade apart.
   */
  tone?: 'brand' | 'inverse'
}) {
  return (
    <span className={`inline-flex items-center gap-2 font-bold ${className}`}>
      <span
        aria-hidden
        className={`grid h-9 w-9 place-items-center rounded-xl text-lg ${
          tone === 'inverse' ? 'bg-white text-brand-700' : 'bg-brand-600 text-white'
        }`}
      >
        ক
      </span>
      <span className={tone === 'inverse' ? 'text-white' : 'text-brand-800'}>
        CoachDesk
      </span>
    </span>
  )
}
