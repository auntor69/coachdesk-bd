'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

export type LangMode = 'both' | 'bn' | 'en'

const LangContext = createContext<{ mode: LangMode; setMode: (m: LangMode) => void }>({
  mode: 'both',
  setMode: () => {},
})

export function PolicyLangProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<LangMode>('both')
  return (
    <LangContext.Provider value={{ mode, setMode }}>
      {children}
    </LangContext.Provider>
  )
}

export function usePolicyLang() {
  return useContext(LangContext)
}

export function PolicyLanguageSelector() {
  const { mode, setMode } = usePolicyLang()

  return (
    <div
      role="radiogroup"
      aria-label="Language display mode"
      className="inline-flex items-center rounded-xl border border-line bg-surface-alt p-1 text-sm font-medium"
    >
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'both'}
        onClick={() => setMode('both')}
        className={`rounded-lg px-3 py-1.5 transition-colors ${
          mode === 'both'
            ? 'bg-white text-brand-700 shadow-sm font-semibold'
            : 'text-ink-soft hover:text-ink'
        }`}
      >
        উভয় ভাষা (Both)
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'bn'}
        onClick={() => setMode('bn')}
        className={`rounded-lg px-3 py-1.5 transition-colors ${
          mode === 'bn'
            ? 'bg-white text-brand-700 shadow-sm font-semibold'
            : 'text-ink-soft hover:text-ink'
        }`}
      >
        বাংলা
      </button>
      <button
        type="button"
        role="radio"
        aria-checked={mode === 'en'}
        onClick={() => setMode('en')}
        className={`rounded-lg px-3 py-1.5 transition-colors ${
          mode === 'en'
            ? 'bg-white text-brand-700 shadow-sm font-semibold'
            : 'text-ink-soft hover:text-ink'
        }`}
      >
        English
      </button>
    </div>
  )
}

export function PolicySection({
  number,
  titleBn,
  titleEn,
  childrenBn,
  childrenEn,
}: {
  number?: string
  titleBn: string
  titleEn: string
  childrenBn: ReactNode
  childrenEn: ReactNode
}) {
  const { mode } = usePolicyLang()

  return (
    <section className="border-b border-line py-8 last:border-b-0">
      <div className="mb-4">
        {mode !== 'en' && (
          <h2 className="text-xl font-bold text-ink">
            {number && <span className="mr-2 text-brand-600">{number}.</span>}
            {titleBn}
          </h2>
        )}
        {mode !== 'bn' && (
          <h3
            className={`text-base font-semibold text-ink-soft ${
              mode === 'both' ? 'mt-1' : ''
            }`}
          >
            {number && mode === 'en' && (
              <span className="mr-2 text-brand-600">{number}.</span>
            )}
            {titleEn}
          </h3>
        )}
      </div>

      <div
        className={`grid gap-6 ${
          mode === 'both' ? 'lg:grid-cols-2' : 'grid-cols-1'
        }`}
      >
        {mode !== 'en' && (
          <div className="space-y-3 leading-relaxed text-ink/90">
            {childrenBn}
          </div>
        )}
        {mode !== 'bn' && (
          <div
            className={`space-y-3 leading-relaxed text-ink/80 ${
              mode === 'both'
                ? 'border-transparent lg:border-l lg:border-line lg:pl-6'
                : ''
            }`}
          >
            {childrenEn}
          </div>
        )}
      </div>
    </section>
  )
}
