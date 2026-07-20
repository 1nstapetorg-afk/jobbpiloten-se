#!/usr/bin/env node
/**
 * generate-extension-icons.js
 *
 * Rasterises the SVG source at extension/icons/icon-source.svg into
 * the three PNG sizes the MV3 manifest references (16/48/128). Chrome
 * toolbar surfaces need transparent-background favicons at every
 * density; the source SVG already paints on a rounded-square
 * gradient so the resized PNGs ship with the rounded shape baked
 * in, transparent corners free for the browser to composite onto
 * its own theme.
 *
 *   extension/icons/icon-source.svg   -> extension/icons/icon16.png    (16x16)
 *   extension/icons/icon-source.svg   -> extension/icons/icon48.png    (48x48)
 *   extension/icons/icon-source.svg   -> extension/icons/icon128.png   (128x128)
 *
 * Run via `yarn icons:extension` (added to package.json):
 *
 *   node scripts/generate-extension-icons.js
 *
 * Idempotent: re-running overwrites the existing PNGs. Safe to commit.
 * Cheap: ~250 ms end-to-end because sharp caches the SVG parse.
 */
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'extension', 'icons', 'icon-source.svg')

const JOBS = [
  { dest: path.join(ROOT, 'extension', 'icons', 'icon16.png'),  size: 16  },
  { dest: path.join(ROOT, 'extension', 'icons', 'icon48.png'),  size: 48  },
  { dest: path.join(ROOT, 'extension', 'icons', 'icon128.png'), size: 128 },
]

async function main() {
  if (!fs.existsSync(SRC)) {
    console.error(`[icons] missing source: ${SRC}`)
    process.exit(1)
  }
  const svg = fs.readFileSync(SRC)
  // density=384 doubles the raster grid so each axis is rasterised at
  // ~3px/source-unit — sharp then downsamples to the target size with a
  // high-quality Lanczos filter; chromium's per-pixel toolbar re-render
  // reads better at this density than at density=72.
  for (const { dest, size } of JOBS) {
    await sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toFile(dest)
    const kb = (fs.statSync(dest).size / 1024).toFixed(2)
    console.log(`[icons] wrote ${path.relative(ROOT, dest)}  ${size}x${size}  ${kb} KB`)
  }
}

main().catch((err) => {
  console.error('[icons] failed:', err)
  process.exit(1)
})
