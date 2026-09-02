/**
 * The two cells every table in this product is built out of.
 *
 * Written once here because they had been written four times — byte for byte, in
 * expenses, the collection register, the head-office board and the payroll run —
 * and the roster was about to be the fifth. Four copies of a padding value is four
 * chances for one sheet to sit a pixel off the others, and the thing a table is for
 * is a column somebody can run their eye down.
 *
 * `num` puts the figure in the tabular-numeral face, which is what makes a column of
 * amounts line up on the digit rather than on the glyph. `right` is for that same
 * column: money and counts are read from the right, names from the left.
 *
 * Server components, deliberately — every table in the app is rendered on the server
 * and there is nothing here to make interactive.
 */

export function Th({
  children,
  num = false,
  right = false,
  className = '',
}: {
  children: React.ReactNode
  num?: boolean
  right?: boolean
  /** A width, for a `table-fixed` sheet whose columns are shared out by hand. */
  className?: string
}) {
  return (
    <th
      scope="col"
      className={`px-2 pb-2 font-medium text-ink-soft ${num ? 'num' : ''} ${
        right ? 'text-right' : ''
      } ${className}`}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  num = false,
  right = false,
  className = '',
}: {
  children: React.ReactNode
  num?: boolean
  right?: boolean
  /** For a cell that needs a width or a colour the other three do not. */
  className?: string
}) {
  return (
    <td
      className={`px-2 py-2 text-ink ${num ? 'num' : ''} ${
        right ? 'text-right' : ''
      } ${className}`}
    >
      {children}
    </td>
  )
}
