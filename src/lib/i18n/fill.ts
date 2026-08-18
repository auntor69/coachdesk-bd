/**
 * Substituting a value into a translated sentence, in the browser.
 *
 * Everything else in this folder resolves a sentence on the server: the dictionary
 * holds a function, the page or the action calls it, and the finished string
 * travels. That is the better answer wherever it is available, because the
 * compiler checks the argument at both ends — see `T` in ./index.ts for what
 * happens when a function is handed across the boundary instead.
 *
 * It is not available for a sentence that changes after the page has rendered. The
 * counter on the reminder worklist ticks down as an owner works through it, and a
 * row grows "এসএমএস পাঠানো হয়েছে ✓" the moment the message reaches the phone;
 * neither number nor channel is known to the server that rendered the screen. So
 * those sentences cross as templates and are filled here.
 *
 * `{name}` rather than `%s` or a positional `{0}`: the placeholder says what goes
 * in it, so a translator who moves it to the other end of the sentence — which
 * Bangla and English routinely need — cannot silently swap two values. An unknown
 * placeholder is left standing rather than blanked, because a visible `{n}` on a
 * screen gets reported and a missing word does not.
 *
 * Its own file, with no imports, on purpose. A client component importing this
 * from ./index.ts would pull bn.ts and en.ts in behind it and put both languages
 * on a 3G phone, which is the one thing this design exists to avoid.
 */
export function fill(
  template: string,
  values: Record<string, string | number>,
): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  )
}
