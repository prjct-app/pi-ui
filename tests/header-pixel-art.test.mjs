import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripVTControlCharacters } from 'node:util';
import { getCellDimensions, setCellDimensions, visibleWidth } from '@earendil-works/pi-tui';
import sharp from 'sharp';
import { createPixelArt, renderPixelArt } from '../src/header/pixel-art.ts';

test('reference pixels retain colors, transparency, and an unpaired bottom row', async () => {
  const bytes = Buffer.from([
    255, 0, 0, 255, 0, 0, 0, 0,
    0, 0, 255, 255, 0, 255, 0, 255,
    255, 255, 0, 255, 0, 0, 0, 0,
  ]);
  const art = { width: 2, height: 3, pixels: bytes };
  const lines = renderPixelArt(art, 2);
  assert.deepEqual(lines.map(stripVTControlCharacters), ['▀▄', '▀ ']);
  assert.ok(lines[0].includes('\x1b[38;2;255;0;0m\x1b[48;2;0;0;255m▀'));
  assert.ok(lines[0].includes('\x1b[38;2;0;255;0m▄'));
  assert.ok(lines[1].includes('\x1b[38;2;255;255;0m▀'));
  const png = await sharp(bytes, { raw: { width: 2, height: 3, channels: 4 } }).png().toBuffer();
  const converted = await createPixelArt(png);
  assert.equal(converted.pixels.length, converted.width * converted.height * 4);
  assert.deepEqual([converted.width, converted.height], [2, 3]);
});

test('the bundled prjct reference becomes bounded text art with no image transport', async () => {
  for (const name of ['prjct']) {
    const art = await createPixelArt(await readFile(new URL(`../assets/${name}-logo.png`, import.meta.url)), true);
    for (const width of [1, 5, 10, 80]) {
      const lines = renderPixelArt(art, width, text => text);
      assert.ok(lines.length <= 6);
      assert.ok(lines.every(line => visibleWidth(line) <= Math.min(width, 12)));
      if (width >= 5) assert.match(lines.join(''), /[▀▄█]/u);
      assert.doesNotMatch(lines.join(''), /\[Image:|\x1b_G|\x1b\]1337/u);
    }
    assert.deepEqual(renderPixelArt(art, 0), []);
  }
});

test('physical aspect ratio follows terminal cell dimensions, including changes after first render', async t => {
  const original = getCellDimensions();
  t.after(() => setCellDimensions(original));
  for (const [width, height] of [[120, 120], [160, 80], [80, 160]]) {
    const png = await sharp({ create: { width, height, channels: 4, background: '#ff0000' } }).png().toBuffer();
    const art = await createPixelArt(png);
    for (const cell of [{ widthPx: 9, heightPx: 18 }, { widthPx: 9, heightPx: 24 }, { widthPx: 12, heightPx: 18 },
      { widthPx: 18, heightPx: 36 }, { widthPx: 24, heightPx: 48 }, { widthPx: 40, heightPx: 80 }]) {
      setCellDimensions(cell);
      const lines = renderPixelArt(art, 80, text => text);
      const halfRows = lines.length * 2 - (lines.at(-1).includes('▀') ? 1 : 0);
      const physicalWidth = visibleWidth(lines[0]) * cell.widthPx;
      const physicalHeight = halfRows * cell.heightPx / 2;
      assert.ok(physicalWidth <= 256, 'visible width stays within the pixel limit');
      assert.ok(lines.length * cell.heightPx <= 256, 'occupied terminal rows stay within the pixel limit');
      assert.ok(Math.abs(physicalHeight - physicalWidth * height / width) <= cell.heightPx / 4 + 0.01,
        `${width}x${height} must retain its aspect ratio with ${cell.widthPx}x${cell.heightPx} cells`);
    }
  }
});

test('a monochrome logo repaints with the current theme', () => {
  const art = { width: 1, height: 2, pixels: Buffer.from([0, 0, 0, 255, 255, 255, 255, 255]) };
  const color = { value: '\x1b[31m' };
  const paint = text => `${color.value}${text}\x1b[39m`;
  assert.equal(renderPixelArt(art, 1, paint)[0], '\x1b[31m█\x1b[39m');
  color.value = '\x1b[32m';
  assert.equal(renderPixelArt(art, 1, paint)[0], '\x1b[32m█\x1b[39m');
});
