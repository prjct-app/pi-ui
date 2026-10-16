import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

export type Logo = { kind: 'pi' | 'prjct' } | { kind: 'custom'; data: string; mimeType: 'image/png' };
export const MAX_LOGO_BYTES = 4 * 1024 * 1024;

export async function loadLogo(path: string): Promise<Logo> {
  try {
    const bytes = await readFile(path);
    if (bytes.length > MAX_LOGO_BYTES * 2) throw new Error('Logo settings are too large.');
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    if (typeof value !== 'object' || value === null) throw new Error('Invalid logo settings.');
    const logo = value as Partial<Logo> & { data?: unknown; mimeType?: unknown };
    if (logo.kind === 'pi' || logo.kind === 'prjct') return { kind: logo.kind };
    if (logo.kind === 'custom' && logo.mimeType === 'image/png' && typeof logo.data === 'string'
      && Buffer.from(logo.data, 'base64').subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
      return { kind: 'custom', data: logo.data, mimeType: 'image/png' };
    }
    throw new Error('Invalid logo settings.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'pi' };
    throw error;
  }
}

export async function normalizeLogo(bytes: Buffer): Promise<Logo> {
  if (!bytes.length || bytes.length > MAX_LOGO_BYTES) throw new Error('Use an image or SVG smaller than 4 MiB.');
  const { default: sharp } = await import('sharp');
  const input = sharp(bytes, { limitInputPixels: 16_777_216, animated: false });
  const metadata = await input.metadata();
  if (!['png', 'jpeg', 'webp', 'gif', 'svg'].includes(metadata.format ?? '')) throw new Error('Use PNG, JPEG, WebP, GIF or SVG.');
  const png = await input.resize({ width: 512, height: 512, fit: 'inside' }).png().toBuffer();
  if (png.length > MAX_LOGO_BYTES) throw new Error('The rendered logo exceeds 4 MiB.');
  return { kind: 'custom', data: png.toString('base64'), mimeType: 'image/png' };
}

export async function saveLogo(path: string, logo: Logo): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(logo)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}
