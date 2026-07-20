#!/usr/bin/env node
/**
 * generate-pwa-icons.js
 *
 * Rasterizes the SVG PWA icons in /app/public into PNG variants so Android
 * launchers and Lighthouse pass with full marks (modern Chrome accepts
 * SVG, but masked launchers and the installability audit prefer PNG).
 *
 *   public/icon-192.svg            -> public/icon-192.png            (192x192)
 *   public/icon-512.svg            -> public/icon-512.png            (512x512)
 *   public/icon-maskable-512.svg   -> public/icon-maskable-512.png   (512x512)
 *
 * Run via `yarn icons:build` (added to package.json) or directly:
 *   node scripts/generate-pwa-icons.js
 *
 * Idempotent: re-running overwrites the existing PNGs. Safe to commit.
 */
const fs = require('fs')
const path = require('path')
const sharp = require('sharp')

const PUBLIC_DIR = path.join(__dirname, '..', 'public')

const JOBS = [
  { src: 'icon-192.svg',          dest: 'icon-192.png',          size: 192 },
  { src: 'icon-512.svg',          dest: 'icon-512.png',          size: 512 },
  { src: 'icon-maskable-512.svg', dest: 'icon-maskable-512.png', size: 512 },
]

async function main() {
  for (const { src, dest, size } of JOBS) {
    const srcPath = path.join(PUBLIC_DIR, src)
    const destPath = path.join(PUBLIC_DIR, dest)
    if (!fs.existsSync(srcPath)) {
      console.error(`[icons] missing source: ${srcPath}`)
      process.exit(1)
    }
    const svg = fs.readFileSync(srcPath)
    // density=384 doubles the rasterization grid so the PNG stays crisp
    // after the resize step (sharp scales by 2x for high-DPI screens).
    await sharp(svg, { density: 384 })
      .resize(size, size, { fit: 'cover' })
      .png({ compressionLevel: 9, palette: undefined })
      .toFile(destPath)
    const stat = fs.statSync(destPath)
    console.log(`[icons] wrote ${dest}  ${size}x${size}  ${(stat.size / 1024).toFixed(1)} KB`)
  }
}

main().catch((err) => {
  console.error('[icons] failed:', err)
  process.exit(1)
})
