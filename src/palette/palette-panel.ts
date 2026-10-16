import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, type Component, type Focusable, type TUI } from "@earendil-works/pi-tui";
import { ago, fit, paint, type Tone } from "@prjct.app/pi-tui-kit";
import type { Version, VersionInfo } from "./backup.ts";
import { WHY, when } from "./backup-ui.ts";
import type { CloudVersion } from "./cloud.ts";
import { readFavorites, toggleFavorite } from "./favorites.ts";
import { categoryOf, groupOf, themeCategories, type ThemeCategoryId } from "./palette-groups.ts";
import { PALETTES, paintChip, type Palette } from "./palettes.ts";

/**
 * The /palette picker. Categories on the left; the highlighted category's
 * list on the right. Opening a category moves its list to the left and shows
 * the selected item's details on the right. Each category brings its own keys.
 */

/** What the picker hands back to the command besides a palette to apply. */
export type PaletteAction = "sync" | "login" | "logout" | "import" | "export";
export type PickerResult = { apply?: string; action?: PaletteAction; restore?: string };

/** Account and backup state, in a few words each. */
export type PickerInfo = { connected: boolean; account: string; backups: string };

/** Everything the picker needs from the extension beyond the palettes. */
export type PickerHost = {
	info(): PickerInfo;
	backups(): { local: VersionInfo[]; cloud: CloudVersion[]; cloudProblem?: string; summary: string };
	readBackup(file: string): Version;
	/** Bring the cloud list (no network when not connected). */
	refreshCloud(): Promise<void>;
	backupNow(): Promise<{ text: string; tone: Tone }>;
	site: string;
};

export type CategoryId = ThemeCategoryId | "backups" | "account";

const NO_HOST: PickerHost = {
	info: () => ({ connected: false, account: "", backups: "" }),
	backups: () => ({ local: [], cloud: [], summary: "" }),
	readBackup: () => { throw new Error("no backups"); },
	refreshCloud: async () => {},
	backupNow: async () => ({ text: "Backups are not available here.", tone: "muted" }),
	site: "",
};

/** `meta` shows beside the label in the wide list; `tag` replaces it in the narrow left pane. */
type Item = { id: string; label: string; meta?: string; tag?: string; palette?: Palette };
type Category = { id: CategoryId; label: string; blurb: string; empty: string; items: Item[]; count: string };
type Tool = { key: string; label: string };

/** The panel's state as one immutable value; every key press produces a new one. */
type PanelState = Readonly<{
	level: "categories" | "items";
	category: CategoryId;
	cursor: Readonly<Partial<Record<CategoryId, string>>>;
	showDetail: boolean;
	confirm: string | undefined;
	busy: boolean;
	cloudAsked: boolean;
	applied: boolean;
	closed: boolean;
	favorites: ReadonlySet<string>;
	notice: Readonly<{ text: string; tone: Tone }> | undefined;
}>;

/** The favorites set, or an empty one with a notice when the favorites file cannot be read. */
function loadFavorites(): { favorites: Set<string>; notice?: { text: string; tone: Tone } } {
	try {
		return { favorites: readFavorites() };
	} catch (error) {
		return {
			favorites: new Set(),
			notice: { text: `Favorites unavailable: ${error instanceof Error ? error.message : String(error)}`, tone: "error" },
		};
	}
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const ACCOUNT_HELP: Record<string, (site: string) => string> = {
	sync: (site) => `Sends your palettes and favorites to ${site}, brings your library back, and reloads Pi.`,
	login: (site) => `Shows a short code and opens ${site}. Approve it there while signed in. From then on, backups also go to the cloud.`,
	logout: () => "Revokes this Pi's token. Your palettes and their backups stay on this computer.",
	import: () => "Replaces your library and favorites with a library.json from pi-themes (default: ~/Downloads/library.json), then reloads.",
	export: () => "Writes your palettes, favorites and the active palette to ~/Downloads/pi-palette-export.json, ready for pi-themes.",
};

function palettePicker(
	ctx: ExtensionContext,
	tui: TUI,
	theme: Theme,
	originalTheme: string | undefined,
	host: PickerHost,
	initial: CategoryId | undefined,
	done: (value: PickerResult | undefined) => void,
): Component & Focusable & { dispose(): void } {
	const loaded = loadFavorites();
	const inUse = ctx.ui.theme.name && PALETTES.some((p) => p.id === ctx.ui.theme.name) ? ctx.ui.theme.name : undefined;
	const startCategory = initial ?? (inUse ? (loaded.favorites.has(inUse) ? "favorites" : categoryOf(inUse)) : "favorites");
	// The one cell that changes: it holds the panel's current state value, which is always replaced, never edited.
	const panel: { state: PanelState } = {
		state: {
			level: "categories",
			category: startCategory,
			cursor: inUse ? { [startCategory]: inUse } : {},
			showDetail: false,
			confirm: undefined,
			busy: false,
			cloudAsked: false,
			applied: false,
			closed: false,
			favorites: loaded.favorites,
			notice: loaded.notice,
		},
	};
	const set = (change: Partial<PanelState>): void => {
		panel.state = { ...panel.state, ...change };
	};

	const accent = (text: string) => theme.fg("accent", text);
	const dim = (text: string) => theme.fg("dim", text);
	const request = () => { if (!panel.state.closed) tui.requestRender(); };
	const isTheme = (id: CategoryId) => id !== "backups" && id !== "account";

	function categories(): Category[] {
		const themes = themeCategories(panel.state.favorites).map((c): Category => ({
			id: c.id,
			label: c.label,
			blurb: c.blurb,
			empty: c.empty,
			count: String(c.palettes.length),
			items: c.palettes.map((p) => ({ id: p.id, label: p.label, palette: p })),
		}));
		const b = host.backups();
		const info = host.info();
		const backupItems: Item[] = [
			...b.local.map((v) => ({ id: `local:${v.file}`, label: when(v.createdAt), meta: `local · ${plural(v.palettes.length, "palette")}`, tag: "local" })),
			...b.cloud.map((v) => ({ id: `cloud:${v.id}`, label: when(v.createdAt), meta: `cloud · ${plural(v.palettes, "palette")}`, tag: "cloud" })),
		];
		const accountItems: Item[] = [
			...(info.connected
				? [{ id: "sync", label: "Sync now" }, { id: "logout", label: "Log out" }]
				: [{ id: "login", label: "Log in to pi-themes" }]),
			{ id: "import", label: "Import a library file" },
			{ id: "export", label: "Export your palettes" },
		];
		return [
			...themes,
			{ id: "backups", label: "Backups", blurb: b.summary, empty: "No backups yet. Press b to back up now.", count: String(b.local.length + b.cloud.length), items: backupItems },
			{ id: "account", label: "Account", blurb: info.account, empty: "", count: info.connected ? "●" : "○", items: accountItems },
		];
	}

	const category = (): Category => categories().find((c) => c.id === panel.state.category)!;
	const selected = (c = category()): Item | undefined => c.items.find((i) => i.id === panel.state.cursor[c.id]) ?? c.items[0];

	const restoreTheme = () => { if (originalTheme && ctx.ui.theme.name !== originalTheme) ctx.ui.setTheme(originalTheme); };
	const preview = () => {
		const item = selected();
		if (!item?.palette) return;
		const result = ctx.ui.setTheme(item.palette.id);
		if (!result.success) set({ notice: { text: result.error ?? `Could not preview ${item.label}`, tone: "error" } });
	};
	const close = (result: PickerResult | undefined) => {
		if (panel.state.closed) return;
		set({ closed: true, applied: Boolean(result?.apply) });
		if (!panel.state.applied) restoreTheme();
		done(result);
	};
	/** The cloud list is fetched the first time Backups is in view, never before. */
	const askCloud = () => {
		if (panel.state.category !== "backups" || panel.state.cloudAsked) return;
		set({ cloudAsked: true });
		void host.refreshCloud().then(request, request);
	};

	const moveCategory = (delta: number) => {
		const list = categories();
		const index = list.findIndex((c) => c.id === panel.state.category);
		set({ category: list[Math.max(0, Math.min(list.length - 1, index + delta))]!.id, confirm: undefined });
		askCloud();
	};
	const moveItem = (delta: number) => {
		const c = category();
		if (!c.items.length) return;
		const index = Math.max(0, c.items.findIndex((i) => i.id === selected(c)?.id));
		set({ cursor: { ...panel.state.cursor, [c.id]: c.items[Math.max(0, Math.min(c.items.length - 1, index + delta))]!.id }, confirm: undefined });
		if (isTheme(c.id)) preview();
	};
	const open = () => {
		if (!category().items.length) return;
		set({ level: "items", showDetail: false });
		if (isTheme(panel.state.category)) preview();
	};
	const back = () => {
		set({ level: "categories", confirm: undefined });
		restoreTheme();
	};

	async function backupNow(): Promise<void> {
		if (panel.state.busy) return;
		set({ busy: true, notice: { text: "Backing up…", tone: "muted" } });
		request();
		const outcome = await host.backupNow();
		await host.refreshCloud().catch(() => {});
		set({ busy: false, notice: outcome });
		request();
	}

	/** Keys the current category adds, at this level and for this item. */
	function tools(): Tool[] {
		const c = category();
		const item = panel.state.level === "items" ? selected(c) : undefined;
		if (isTheme(c.id)) {
			if (!item) return [];
			return [{ key: "f", label: panel.state.favorites.has(item.id) ? "unfavorite" : "favorite" }, { key: "a", label: "apply" }];
		}
		if (c.id === "backups") return [{ key: "b", label: "back up now" }, ...(item ? [{ key: "r", label: "restore" }] : [])];
		const connected = host.info().connected;
		return [
			...(item ? [{ key: "enter", label: "run" }] : []),
			...(connected ? [{ key: "s", label: "sync" }] : []),
			{ key: "l", label: connected ? "log out" : "log in" },
			{ key: "i", label: "import" },
			{ key: "e", label: "export" },
		];
	}

	function navigation(): Tool[] {
		if (panel.state.level === "categories") return [{ key: "↑↓", label: "category" }, { key: "→", label: "open" }, { key: "esc", label: "close" }];
		return [
			{ key: "↑↓", label: isTheme(panel.state.category) ? "preview" : "select" },
			{ key: "←", label: "categories" },
			{ key: "esc", label: "back" },
		];
	}

	const keyed = (list: Tool[]) => list.map((t) => `${accent(t.key)}${dim(` ${t.label}`)}`).join(dim(" · "));

	function itemLine(c: Category, item: Item, chosen: boolean, focused: boolean): string {
		const lead = chosen && focused ? accent(theme.bold("›")) : " ";
		const name = chosen ? accent(theme.bold(item.label)) : item.label;
		if (item.palette) {
			const star = panel.state.favorites.has(item.id) && c.id !== "favorites" ? accent("★") : " ";
			const chips = [0, 2, 4].map((i) => paintChip(item.palette!.swatches[i]!.hex)).join(" ");
			return `${lead}${star} ${name} ${chips}`;
		}
		const meta = focused ? item.tag ?? item.meta : item.meta;
		return `${lead} ${name}${meta ? dim(`  ${meta}`) : ""}`;
	}

	/** A window of `rows` lines that keeps the cursor in view. */
	function windowed(lines: string[], cursor: number, rows: number): string[] {
		if (lines.length <= rows) return lines;
		const from = Math.max(0, Math.min(cursor - Math.floor(rows / 2), lines.length - rows));
		return lines.slice(from, from + rows);
	}

	function detail(c: Category, item: Item | undefined): string[] {
		if (!item) return [dim(c.empty)];
		if (item.palette) {
			const p = item.palette;
			const width = Math.max(...p.swatches.map((s) => s.name.length));
			return [
				theme.bold(p.label),
				`${theme.fg("success", "Live preview")}${dim(` · ${panel.state.favorites.has(p.id) ? "★ Favorite · " : ""}${groupOf(p.id)}`)}`,
				"",
				accent("Palette"),
				process.env.NO_COLOR ? p.swatches.map((s) => s.name).join(" · ") : p.swatches.map((s) => paintChip(s.hex)).join(" "),
				"",
				...p.swatches.map((s) => `${paintChip(s.hex)} ${s.name.padEnd(width)}  ${s.hex}`),
			];
		}
		if (c.id === "backups") {
			const [side, key = ""] = item.id.split(/:(.*)/s);
			const restore = dim("Press r twice to restore it. Your current library is saved as a version first.");
			if (side === "cloud") {
				const v = host.backups().cloud.find((x) => x.id === key);
				return [
					theme.bold(item.label),
					dim(`On ${host.site}`),
					"",
					`${dim("Saved     ")}${v ? `${when(v.createdAt)} (${ago(Date.parse(v.createdAt))})` : "—"}`,
					`${dim("From      ")}${v?.client ?? "—"}`,
					`${dim("Palettes  ")}${v?.palettes ?? 0}`,
					`${dim("Favorites ")}${v?.favorites ?? 0}`,
					"",
					restore,
				];
			}
			try {
				const v = host.readBackup(key);
				return [
					theme.bold(item.label),
					dim("On this computer"),
					"",
					`${dim("Saved     ")}${when(v.createdAt)} (${ago(Date.parse(v.createdAt))})`,
					`${dim("Why       ")}${WHY[v.reason]}`,
					`${dim("Palettes  ")}${v.local.palettes.length}`,
					`${dim("Favorites ")}${v.local.favorites?.length ?? 0}`,
					`${dim("Active    ")}${v.local.active ?? "—"}`,
					`${dim("Cloud     ")}${v.cloud ? `${plural(v.cloud.palettes.length, "palette")}${v.user ? ` from @${v.user}` : ""}` : "not connected then"}`,
					...(v.local.palettes.length ? ["", accent("Your palettes"), ...v.local.palettes.slice(0, 12).map((p) => `${p.label}  ${dim(p.id)}`)] : []),
					"",
					restore,
				];
			} catch (error) {
				return [theme.bold(item.label), theme.fg("error", `Could not read this backup: ${error instanceof Error ? error.message : String(error)}`)];
			}
		}
		const info = host.info();
		return [
			theme.bold(item.label),
			"",
			ACCOUNT_HELP[item.id]?.(host.site) ?? "",
			"",
			accent("Account"),
			info.account || dim("—"),
			"",
			accent("Backups"),
			info.backups || dim("—"),
		];
	}

	/** The right pane while choosing a category: what is inside it. */
	function contents(c: Category, rows: number): string[] {
		const head = [accent(theme.bold(c.label)), dim(c.blurb || " "), ""];
		if (!c.items.length) return [...head, dim(c.empty)];
		const lines = c.items.map((item) => itemLine(c, item, false, false));
		const room = Math.max(1, rows - head.length);
		const shown = lines.slice(0, room);
		if (lines.length > room) shown[room - 1] = dim(`  … ${lines.length - room + 1} more`);
		return [...head, ...shown];
	}

	// Opened on a category (/palette backups): straight into its list and details.
	if (initial && category().items.length) open();
	askCloud();

	return {
		render(width: number): string[] {
			const height = Math.max(10, Math.min(26, tui.terminal?.rows ?? 30));
			if (width < 24) return [accent(theme.bold("Palette")), dim("Need a wider terminal.")].map((line) => fit(line, width));
			const wide = width >= 72;
			const bodyHeight = height - 5;
			const leftWidth = wide ? Math.min(30, Math.max(20, Math.floor(width * 0.3))) : width - 2;
			const rightWidth = wide ? width - leftWidth - 3 : width - 2;
			const list = categories();
			const c = category();
			const item = selected(c);

			const pane = { left: [] as string[], right: [] as string[] };
			if (panel.state.level === "categories") {
				const index = list.findIndex((x) => x.id === c.id);
				pane.left = list.map((x) => {
					const chosen = x.id === c.id;
					const label = chosen ? accent(theme.bold(x.label)) : x.label;
					return `${chosen ? accent(theme.bold("›")) : " "} ${label}`;
				});
				// Room for the counts, right-aligned in the pane.
				pane.left = pane.left.map((line, i) => {
					const count = dim(list[i]!.count);
					return fit(line, Math.max(1, leftWidth - list[i]!.count.length - 1)) + " " + count;
				});
				// A rule between the themes and the rest.
				pane.left.splice(list.findIndex((x) => x.id === "backups"), 0, dim("─".repeat(Math.max(1, leftWidth - 1))));
				pane.left = windowed(pane.left, index, bodyHeight);
				pane.right = contents(c, bodyHeight);
			} else {
				const cursor = Math.max(0, c.items.findIndex((x) => x.id === item?.id));
				pane.left = [
					accent(theme.bold(`‹ ${c.label}`)),
					...windowed(c.items.map((x) => itemLine(c, x, x.id === item?.id, true)), cursor, bodyHeight - 1),
				];
				pane.right = detail(c, item);
			}

			const confirm = panel.state.confirm ? { text: `Press r again to restore ${item?.label ?? "it"} · any other key cancels`, tone: "warning" as Tone } : undefined;
			const message = confirm ?? panel.state.notice;
			const showing = PALETTES.find((p) => p.id === ctx.ui.theme.name)?.label;
			const title = ` ${accent(theme.bold("Palette"))}  ${dim(`${PALETTES.length} themes · ${panel.state.favorites.size} favorites${showing ? ` · ${showing}` : ""}`)}`;
			const body = Array.from({ length: bodyHeight }, (_, i) => {
				if (!wide) {
					const shown = panel.state.level === "items" && panel.state.showDetail ? pane.right : pane.left;
					return ` ${fit(shown[i] ?? "", Math.max(1, width - 2))} `;
				}
				return `${fit(pane.left[i] ?? "", leftWidth)} ${dim("│")} ${fit(pane.right[i] ?? "", rightWidth)}`;
			});
			const own = tools();
			const nav = navigation();
			if (!wide && panel.state.level === "items") nav.splice(1, 0, { key: "tab", label: panel.state.showDetail ? "list" : "details" });
			return [
				fit(title, width),
				dim("─".repeat(width)),
				...body,
				dim("─".repeat(width)),
				fit(` ${message ? paint(theme, message.tone, message.text) : own.length ? keyed(own) : dim(c.blurb)}`, width),
				fit(` ${keyed(nav)}`, width),
			];
		},
		handleInput(data: string): void {
			const c = category();
			const item = panel.state.level === "items" ? selected(c) : undefined;
			const wasConfirm = panel.state.confirm;
			set(panel.state.busy ? { confirm: undefined } : { confirm: undefined, notice: undefined });

			// Navigation, the same everywhere.
			if (matchesKey(data, Key.escape) || data === "q") {
				if (panel.state.level === "items") back();
				else close(undefined);
			} else if (matchesKey(data, Key.up) || data === "k") {
				if (panel.state.level === "categories") moveCategory(-1); else moveItem(-1);
			} else if (matchesKey(data, Key.down) || data === "j") {
				if (panel.state.level === "categories") moveCategory(1); else moveItem(1);
			} else if (matchesKey(data, Key.right) || (matchesKey(data, Key.enter) && panel.state.level === "categories")) {
				if (panel.state.level === "categories") open();
			} else if (matchesKey(data, Key.left)) {
				if (panel.state.level === "items") back();
			} else if (matchesKey(data, Key.tab)) {
				if (panel.state.level === "items") set({ showDetail: !panel.state.showDetail });
			}
			// The category's own keys.
			else if (isTheme(c.id) && item?.palette && data === "f") {
				try {
					set({ favorites: toggleFavorite(item.id) });
				}
				catch (error) { set({ notice: { text: `Could not save favorite: ${error instanceof Error ? error.message : String(error)}`, tone: "error" } }); }
				// Unstarring inside Favorites moves the cursor to what is left.
				if (c.id === "favorites" && !panel.state.favorites.has(item.id)) {
					const rest = category().items;
					if (!rest.length) back();
					else { set({ cursor: { ...panel.state.cursor, favorites: rest[0]!.id } }); preview(); }
				}
			} else if (isTheme(c.id) && item?.palette && (data === "a" || matchesKey(data, Key.enter))) {
				preview();
				if (!panel.state.notice) close({ apply: item.id });
			} else if (c.id === "backups" && data === "b") {
				void backupNow();
			} else if (c.id === "backups" && item && data === "r") {
				if (wasConfirm === item.id) close({ restore: item.id });
				else set({ confirm: item.id });
			} else if (c.id === "account" && item && matchesKey(data, Key.enter)) {
				close({ action: item.id as PaletteAction });
			} else if (c.id === "account" && data === "s" && host.info().connected) close({ action: "sync" });
			else if (c.id === "account" && data === "l") close({ action: host.info().connected ? "logout" : "login" });
			else if (c.id === "account" && data === "i") close({ action: "import" });
			else if (c.id === "account" && data === "e") close({ action: "export" });
			else return;
			request();
		},
		invalidate(): void {},
		dispose(): void {
			if (!panel.state.applied) restoreTheme();
			set({ closed: true });
		},
		get focused() { return true; },
		set focused(_value: boolean) {},
	};
}

export async function openPalettePanels(
	ctx: ExtensionContext,
	host: PickerHost = NO_HOST,
	initial?: CategoryId,
): Promise<PickerResult | undefined> {
	const originalTheme = ctx.ui.theme.name;
	return ctx.ui.custom<PickerResult | undefined>((tui, theme, _keybindings, done) =>
		palettePicker(ctx, tui, theme, originalTheme, host, initial, done));
}
