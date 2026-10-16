import { getCellDimensions, truncateToWidth } from '@earendil-works/pi-tui';

export interface PixelArt {
  width: number;
  height: number;
  pixels: Buffer;
}

export const LOGO_COLUMNS = 12;
export const MAX_LOGO_PX = 256;
const MAX_ROWS = 6;
type Pixel = { color: string; alpha: number };
const grids = new WeakMap<PixelArt, { columns: number; height: number; pixels: Pixel[] }>();

/** Keep source detail until the actual terminal cell dimensions are known. */
export async function createPixelArt(bytes: Buffer, trim = false): Promise<PixelArt> {
  const { default: sharp } = await import('sharp');
  const input = sharp(bytes, { limitInputPixels: 16_777_216, animated: false }).rotate();
  if (trim) input.trim();
  const { data, info } = await input
    .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
    .toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, pixels: data };
}

/** Average coverage, rather than dropping thin strokes between sampled pixels. */
/** Integers from `from` up to, not including, `to`. */
const range = (from: number, to: number, step = 1): number[] =>
  Array.from({ length: Math.max(0, Math.ceil((to - from) / step)) }, (_, i) => from + i * step);

/** Source pixel indices each output column and row covers; built once per grid, not once per cell. */
type Spans = { readonly cols: readonly number[][]; readonly rows: readonly number[][] };

function spansFor(art: PixelArt, columns: number, height: number): Spans {
  const span = (count: number, size: number) => Array.from({ length: count }, (_, i) =>
    range(Math.floor(i * size / count), Math.ceil((i + 1) * size / count)));
  return { cols: span(columns, art.width), rows: span(height, art.height) };
}

function sample(art: PixelArt, x: number, y: number, columns: number, height: number, spans: Spans): Pixel {
  const left = x * art.width / columns, right = (x + 1) * art.width / columns;
  const top = y * art.height / height, bottom = (y + 1) * art.height / height;
  const sum = { alpha: 0, red: 0, green: 0, blue: 0 };
  for (const sy of spans.rows[y]!) {
    for (const sx of spans.cols[x]!) {
      const coverage = (Math.min(right, sx + 1) - Math.max(left, sx))
        * (Math.min(bottom, sy + 1) - Math.max(top, sy));
      const offset = (sy * art.width + sx) * 4;
      const weight = coverage * art.pixels[offset + 3];
      sum.alpha += weight;
      sum.red += art.pixels[offset] * weight;
      sum.green += art.pixels[offset + 1] * weight;
      sum.blue += art.pixels[offset + 2] * weight;
    }
  }
  const { alpha, red, green, blue } = sum;
  return { alpha: alpha / ((right - left) * (bottom - top)),
    color: alpha ? `${Math.round(red / alpha)};${Math.round(green / alpha)};${Math.round(blue / alpha)}` : '0;0;0' };
}

/** Built-in marks follow the theme; custom references retain their colors. */
export function renderPixelArt(art: PixelArt, width: number, monochrome?: (text: string) => string): string[] {
  if (width < 1) return [];
  const cell = getCellDimensions();
  const maxColumns = Math.min(width, LOGO_COLUMNS, art.width, Math.floor(MAX_LOGO_PX / cell.widthPx));
  const maxHalfRows = Math.min(MAX_ROWS, Math.floor(MAX_LOGO_PX / cell.heightPx)) * 2;
  if (maxColumns < 1 || maxHalfRows < 1) return [];
  const pixelAspect = 2 * cell.widthPx / cell.heightPx;
  const ratio = art.height / art.width * pixelAspect;
  const columns = Math.max(1, Math.min(maxColumns, Math.floor(maxHalfRows / ratio)));
  const height = Math.max(1, Math.min(maxHalfRows, Math.round(columns * ratio)));
  const cached = grids.get(art);
  const grid = cached && cached.columns === columns && cached.height === height ? cached : {
    columns, height, pixels: ((spans) => Array.from({ length: columns * height }, (_, i) => sample(art, i % columns, Math.floor(i / columns), columns, height, spans)))(spansFor(art, columns, height)),
  };
  grids.set(art, grid);
  const pixel = (x: number, y: number): string | undefined => {
    if (y >= height) return undefined;
    const value = grid.pixels[y * columns + x];
    if (value.alpha < 128) return undefined;
    return monochrome ? 'mark' : value.color;
  };
  const lines: string[] = [];
  for (const y of range(0, height, 2)) {
    const cells: string[] = [];
    for (const x of range(0, columns)) {
      const top = pixel(x, y), bottom = pixel(x, y + 1);
      if (top === undefined && bottom === undefined) { cells.push(' '); continue; }
      const block = top === bottom ? '█' : bottom === undefined ? '▀' : top === undefined ? '▄' : '▀';
      cells.push(monochrome ? block
        : `\x1b[38;2;${top ?? bottom}m${top && bottom && top !== bottom ? `\x1b[48;2;${bottom}m` : ''}${block}\x1b[39;49m`);
    }
    const line = cells.join('');
    lines.push(truncateToWidth(monochrome ? monochrome(line) : line, width));
  }
  return lines;
}
