import { VERSION, type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Box, SelectList, Spacer, Text, type Component } from '@earendil-works/pi-tui';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLogo, MAX_LOGO_BYTES, normalizeLogo, saveLogo, type Logo } from './logo.ts';
import { createPixelArt, renderPixelArt, type PixelArt } from './pixel-art.ts';

/**
 * The startup header. "pi" is Pi's own header, untouched; "prjct" and a
 * custom logo replace it with pixel art. When the header is switched off in
 * /ui, nothing is drawn, whatever the logo.
 */

const prjctLogo = (): Buffer => readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'prjct-logo.png'));
// The prjct logo is decoded once, on first use.
const builtinArt: { prjct?: Promise<PixelArt> } = {};
const toPixelArt = (logo: Exclude<Logo, { kind: 'pi' }>): Promise<PixelArt> => {
  if (logo.kind === 'custom') return createPixelArt(Buffer.from(logo.data, 'base64'));
  builtinArt.prjct ??= createPixelArt(prjctLogo(), true);
  return builtinArt.prjct;
};
const painted = (paint: () => string): Component => ({
  render: width => new Text(paint(), 0, 0).render(width), invalidate() {},
});
const NO_HEADER = (): Component => ({ render: () => [], invalidate() {} });
const captureHint = 'Paste one reference image or SVG, then send it. /header cancel exits.';

export function headerPath(): string {
  return join(process.env.PRJCT_HOME ?? join(homedir(), '.prjct'), 'pi-ui', 'header.json');
}

/** pi-header kept its logo in its own folder. Copy it once; the original stays where it was. */
export async function adoptPiHeaderLogo(target: string, legacy = join(dirname(dirname(target)), 'pi-header', 'settings.json')): Promise<void> {
  const exists = (path: string) => stat(path).then(() => true, () => false);
  if (!(await exists(legacy)) || (await exists(target))) return;
  await mkdir(dirname(target), { recursive: true });
  await copyFile(legacy, target);
}

async function preview(art: PixelArt, ctx: ExtensionContext): Promise<boolean> {
  return ctx.ui.custom<boolean>((tui, theme, _keys, done) => {
    const content = new Box(2, 1);
    content.addChild(new Text(theme.fg('text', 'Header logo preview'), 0, 0));
    content.addChild(new Spacer(1));
    content.addChild({ render: width => renderPixelArt(art, width), invalidate() {} });
    content.addChild(new Spacer(1));
    const choices = new SelectList([
      { value: 'apply', label: 'Use this logo' },
      { value: 'cancel', label: 'Keep current logo' },
    ], 2, {
      selectedPrefix: text => theme.fg('accent', text), selectedText: text => theme.fg('text', text),
      description: text => theme.fg('muted', text), scrollInfo: text => theme.fg('muted', text),
      noMatch: text => theme.fg('muted', text),
    });
    choices.onSelect = item => done(item.value === 'apply');
    choices.onCancel = () => done(false);
    content.addChild(choices);
    return { render: width => content.render(width), invalidate: () => content.invalidate(),
      handleInput: data => { choices.handleInput(data); tui.requestRender(); } };
  });
}

export type Header = {
  /** Draw the header for the current logo, or nothing when it is switched off. */
  apply(ctx: ExtensionContext, on: boolean): Promise<void>;
};

export default function registerHeader(pi: ExtensionAPI, options: { settingsPath?: string } = {}): Header {
  const settingsPath = options.settingsPath ?? headerPath();
  // Never fails the host: if the copy cannot finish, the header starts as Pi's own.
  const adopted = adoptPiHeaderLogo(settingsPath).catch(() => undefined);
  type HeaderState = Readonly<{ logo: Logo; art?: PixelArt; on: boolean; pending: boolean }>;
  // The one cell that changes: it holds the current state value, which is always replaced, never edited.
  const session: { state: HeaderState } = { state: { logo: { kind: 'pi' }, on: true, pending: false } };
  const set = (change: Partial<HeaderState>): void => {
    session.state = { ...session.state, ...change };
  };

  const render = (ctx: ExtensionContext): void => {
    if (ctx.mode !== 'tui') return;
    const { on, logo, art } = session.state;
    if (!on) { ctx.ui.setHeader(NO_HEADER); return; }
    if (logo.kind === 'pi') { ctx.ui.setHeader(undefined); return; }
    ctx.ui.setHeader((_tui, theme) => {
      const header = new Box(2, 1);
      const monochrome = logo.kind === 'custom' ? undefined : (text: string) => theme.fg('text', text);
      if (art) {
        header.addChild({ render: width => renderPixelArt(art, width, monochrome), invalidate() {} });
        header.addChild(new Spacer(1));
      }
      header.addChild(painted(() => theme.fg('text', 'prjct / pi agent') + theme.fg('muted', ` · v${VERSION}`)));
      return header;
    });
  };
  const choose = async (logo: Logo, ctx: ExtensionContext): Promise<void> => {
    const art = logo.kind === 'pi' ? undefined : await toPixelArt(logo);
    await saveLogo(settingsPath, logo);
    set({ logo, art, pending: false });
    ctx.ui.setWidget('pi-ui-header-reference', undefined);
    render(ctx);
    ctx.ui.notify(session.state.on ? `Header logo: ${logo.kind}.` : `Header logo: ${logo.kind}. The header is off; turn it on in /ui.`, 'info');
  };
  const paste = (ctx: ExtensionContext): void => {
    set({ pending: true });
    ctx.ui.setWidget('pi-ui-header-reference', [captureHint]);
    ctx.ui.notify(captureHint, 'info');
  };
  const fromReference = async (bytes: Buffer, ctx: ExtensionContext): Promise<void> => {
    const logo = await normalizeLogo(bytes);
    if (logo.kind === 'pi') return;
    const art = await toPixelArt(logo);
    if (await preview(art, ctx)) await choose(logo, ctx);
    else ctx.ui.notify(session.state.pending ? `Logo unchanged. ${captureHint}` : 'Logo unchanged.', 'info');
  };
  const fromFile = async (path: string, ctx: ExtensionContext): Promise<void> => {
    const filename = resolve(ctx.cwd, path.startsWith('~/') ? join(homedir(), path.slice(2)) : path);
    if ((await stat(filename)).size > MAX_LOGO_BYTES) throw new Error('Use a logo smaller than 4 MiB.');
    await fromReference(await readFile(filename), ctx);
  };

  pi.on('session_start', (_event, ctx) => {
    set({ pending: false });
    if (ctx.mode === 'tui') ctx.ui.setWidget('pi-ui-header-reference', undefined);
  });
  pi.on('session_shutdown', (_event, ctx) => {
    set({ pending: false });
    if (ctx.mode === 'tui') ctx.ui.setWidget('pi-ui-header-reference', undefined);
  });
  pi.registerCommand('header', {
    description: "Choose the header: Pi's own, the prjct logo, or pixel art from your reference image.",
    handler: async (args, ctx) => {
      if (ctx.mode !== 'tui') { ctx.ui.notify('Header customization is available in the TUI.', 'info'); return; }
      try {
        const command = args.trim();
        if (command === 'cancel') {
          set({ pending: false });
          ctx.ui.setWidget('pi-ui-header-reference', undefined);
          ctx.ui.notify('Logo capture cancelled.', 'info'); return;
        }
        if (command === 'pi' || command === 'reset') { await choose({ kind: 'pi' }, ctx); return; }
        if (command === 'prjct') { await choose({ kind: 'prjct' }, ctx); return; }
        if (command === 'logo' || command === 'paste') { paste(ctx); return; }
        if (command.startsWith('logo ')) { await fromFile(command.slice(5).trim(), ctx); return; }
        if (command) { ctx.ui.notify('Use /header, /header logo [path], /header pi, /header prjct or /header cancel.', 'info'); return; }
        const selection = await ctx.ui.select('Choose your header', ["Pi's own header", 'prjct logo', 'Paste a reference image or SVG', 'Load a reference file']);
        if (selection === "Pi's own header") await choose({ kind: 'pi' }, ctx);
        else if (selection === 'prjct logo') await choose({ kind: 'prjct' }, ctx);
        else if (selection === 'Paste a reference image or SVG') paste(ctx);
        else if (selection === 'Load a reference file') {
          const path = await ctx.ui.input('Logo file', 'PNG, JPEG, WebP, GIF or SVG path');
          if (path?.trim()) await fromFile(path.trim(), ctx);
        }
      } catch (error) { ctx.ui.notify(`Logo unchanged: ${(error as Error).message}`, 'error'); }
    },
  });
  pi.on('input', async (event, ctx) => {
    if (!session.state.pending || event.source !== 'interactive' || ctx.mode !== 'tui') return { action: 'continue' };
    try {
      if ((event.images?.length ?? 0) > 1) throw new Error('Send one logo at a time.');
      const svg = event.text.trim().replace(/^```(?:svg|xml)?\s*/u, '').replace(/\s*```$/u, '');
      const bytes = event.images?.[0] ? Buffer.from(event.images[0].data, 'base64')
        : /^(?:<\?xml[^>]*\?>\s*)?<svg\b/u.test(svg) ? Buffer.from(svg) : undefined;
      if (!bytes) throw new Error('Paste an image or SVG, or use /header cancel.');
      await fromReference(bytes, ctx);
    } catch (error) { ctx.ui.notify(`Logo unchanged: ${(error as Error).message}`, 'error'); }
    return { action: 'handled' };
  });

  return {
    async apply(ctx, on) {
      set({ on });
      if (ctx.mode !== 'tui') return;
      try {
        await adopted;
        const logo = await loadLogo(settingsPath);
        // Pixel art is decoded only when a logo replaces Pi's header and the header is on.
        set({ logo, art: logo.kind === 'pi' || !on ? session.state.art : await toPixelArt(logo) });
      } catch (error) {
        set({ logo: { kind: 'pi' }, art: undefined });
        ctx.ui.notify(String((error as Error).message), 'warning');
      }
      render(ctx);
    },
  };
}
