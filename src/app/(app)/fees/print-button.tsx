'use client'

import { buttonClass } from '@/components/ui'

/**
 * The button that opens the print dialog.
 *
 * A browser already has Ctrl+P, and on the device this product is used on that is
 * three taps into Chrome's overflow menu — which most owners have never opened.
 * The two screens that are meant to end up on paper each put this at the top, so
 * the path from "the parent is waiting" to a printable sheet is one tap.
 *
 * It is also the PDF button, and that is the likelier use. Android's print sheet
 * offers "Save as PDF" above every physical printer, and a receipt saved that way
 * goes to the family on WhatsApp — which is how a centre with no printer still
 * gives a parent something to keep. So the label says "print" in both languages
 * and the button does not promise paper.
 *
 * Its own client component, and the only one on either screen. Everything else
 * there is a server render of rows that were fetched anyway; making the whole page
 * a client component to get one onClick would ship the receipt's markup twice and
 * put the fee figures through a serialisation boundary for no reason.
 *
 * print:hidden because it is chrome, not content — a receipt with a "Print"
 * button printed on it is a receipt somebody has to explain.
 */
export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      // `buttonClass` and not `<Button>`: this is the tinted variant on a real `<button>`
      // with an `onClick`, which is the one case the two shared halves do not cover.
      className={buttonClass('tinted', false, 'print:hidden')}
    >
      {label}
    </button>
  )
}
