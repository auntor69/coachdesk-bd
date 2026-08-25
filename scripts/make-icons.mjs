/**
 * Draws the home-screen icons into public/icons/.
 *
 * Run by hand, not by the build: `node scripts/make-icons.mjs`. The output is four
 * PNGs that are committed, because rendering them needs a Bengali font installed on
 * the machine doing the rendering and a deploy box has no reason to have one. What is
 * committed is the artifact; this file is how it was made and how to remake it.
 *
 * THE MARK IS THE Logo'S MARK — the letter ক, white, on brand-600. Not a second piece
 * of branding invented for the phone: an owner who installs this taps an icon that
 * matches the header of the screen it opens. `Logo` in src/components/ui.tsx draws the
 * same letter in the same green, and BRAND below is the same hex as `--color-brand-600`
 * in globals.css and as `themeColor` in the root layout's viewport.
 *
 * FULL-BLEED, OPAQUE, NO ROUNDED CORNERS, and that is deliberate rather than lazy. iOS
 * masks a home-screen icon to its own squircle and composites anything transparent onto
 * black, so corners rounded here would show as black slivers against the squircle.
 * Android does its own shaping for the maskable icon. Both platforms want a plain
 * square and both are given one.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import sharp from 'sharp'

const BRAND = '#137e50'
const OUT = path.join(import.meta.dirname, '..', 'public', 'icons')

/**
 * The font stack, in the order a Bangladeshi or a build machine is likely to have one.
 *
 * Nirmala UI ships with Windows, Vrinda is its predecessor, and Hind Siliguri is the
 * face the app itself loads — if someone has installed it locally it is the closest
 * match to the rendered header. `sans-serif` last so a machine with none of them
 * produces *something* to fail the ink check on rather than throwing.
 */
const FONTS = 'Nirmala UI, Hind Siliguri, Vrinda, Shonar Bangla, Noto Sans Bengali, sans-serif'

/**
 * How much of the tile the glyph fills, as a fraction of the tile's width.
 *
 * `any` is generous because nothing crops it. `maskable` is not: Android may crop a
 * maskable icon to a circle of 80% diameter, so anything outside the middle can be
 * cut. 0.45 keeps ক — which is wider than it is tall, and has a tail that drops below
 * the baseline — inside that circle with room to spare. A maskable icon that is too
 * bold is an icon with its head sliced off on one launcher and nowhere else, which is
 * the kind of bug nobody reports.
 */
const FILL = { any: 0.68, maskable: 0.45 }

function tile(size, glyphFraction) {
  const font = Math.round(size * glyphFraction)
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" `
      + `viewBox="0 0 ${size} ${size}">`
      + `<rect width="${size}" height="${size}" fill="${BRAND}"/>`
      + `<text x="50%" y="50%" font-family="${FONTS}" font-size="${font}" `
      + `font-weight="700" fill="#ffffff" text-anchor="middle" `
      + `dominant-baseline="central">ক</text>`
      + `</svg>`,
  )
}

/**
 * Refuses to write a tile the glyph did not land on.
 *
 * The failure this catches is silent and shippable: on a machine with no Bengali font
 * the `<text>` renders as nothing, or as the empty rectangle a missing glyph is drawn
 * as, and what gets committed is a plain green square or a green square with a box in
 * it. Both look deliberate in a file listing and wrong on a phone.
 *
 * Measured as the fraction of near-white pixels, because that is what the letter is
 * and the background is not. The observed value for `any` is about 0.17 and for
 * `maskable` about 0.08; the window is wide enough that a font substitution is fine
 * and narrow enough that nothing (0) and a solid block (much higher) both fail.
 */
function inkFraction(data, channels) {
  let white = 0
  for (let i = 0; i < data.length; i += channels) {
    if (data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) white++
  }
  return white / (data.length / channels)
}

async function write(name, size, glyphFraction, floor) {
  const png = await sharp(tile(size, glyphFraction)).png({ compressionLevel: 9 }).toBuffer()

  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const ink = inkFraction(data, info.channels)
  if (ink < floor || ink > 0.32) {
    throw new Error(
      `${name}: the ক did not render (ink ${ink.toFixed(3)}, wanted `
        + `${floor}–0.32). Install a Bengali font — Nirmala UI on Windows, `
        + `fonts-noto-sans-bengali on Debian — and run this again.`,
    )
  }

  await writeFile(path.join(OUT, name), png)
  console.log(`${name}  ${size}×${size}  ink ${ink.toFixed(3)}`)
}

await mkdir(OUT, { recursive: true })

// The two the manifest declares as `any`, at the two sizes every install prompt and
// launcher asks for.
await write('icon-192.png', 192, FILL.any, 0.08)
await write('icon-512.png', 512, FILL.any, 0.08)

// The one Android may crop. Its own floor, because a smaller glyph is less ink.
await write('maskable-512.png', 512, FILL.maskable, 0.03)

// iOS, which ignores the manifest's icons entirely and reads <link rel="apple-touch-icon">.
// 180 is what a modern iPhone asks for.
await write('apple-touch-icon.png', 180, FILL.any, 0.08)
