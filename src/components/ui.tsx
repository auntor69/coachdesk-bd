/**
 * The handful of primitives every screen shares.
 *
 * Deliberately small and unabstracted — a design system is a thing you extract
 * after you have five screens, not before you have one. What is here exists
 * because getting it wrong breaks the product on a real phone: tap targets
 * below 48px, text under 16px (which makes iOS zoom on focus), and buttons that
 * give no feedback on a slow connection.
 */
import type { ComponentProps, ReactNode } from 'react'

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  full?: boolean
}

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 rounded-xl px-5 min-h-tap '
  + 'font-semibold transition-colors disabled:opacity-50 '
  + 'disabled:cursor-not-allowed active:scale-[0.99]'

const BUTTON_VARIANTS = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700',
  secondary: 'bg-white text-ink border-2 border-line hover:border-brand-300',
  ghost: 'text-brand-700 hover:bg-brand-50',
  danger: 'bg-absent text-white hover:brightness-95',
}

export function Button({
  variant = 'primary',
  full,
  className = '',
  ...props
}: ButtonProps) {
  return (
    <button
      className={`${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${full ? 'w-full' : ''} ${className}`}
      {...props}
    />
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
        className={`min-h-tap rounded-xl border-2 bg-white px-4 text-base
          outline-none transition-colors placeholder:text-ink-faint
          focus:border-brand-500 ${error ? 'border-absent' : 'border-line'} ${className}`}
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
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
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

export function Logo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-bold ${className}`}>
      <span
        aria-hidden
        className="grid h-9 w-9 place-items-center rounded-xl bg-brand-600
          text-lg text-white"
      >
        ক
      </span>
      <span className="text-brand-800">CoachDesk</span>
    </span>
  )
}
