import { PALETTES, type Palette } from "./palettes.ts";

/** The theme categories of the picker. A favorite also stays in its own category. */
export type ThemeCategoryId = "favorites" | "yours" | "editor" | "photo" | "original";
export type ThemeCategory = { id: ThemeCategoryId; label: string; blurb: string; empty: string; palettes: Palette[] };

export const OWN_GROUP = "Your palettes";
export const EDITOR_GROUP = "Editor classics";
export const PHOTO_GROUP = "From photos";
export const OTHER_GROUP = "Originals";

type Home = Exclude<ThemeCategoryId, "favorites">;
const LABEL: Record<Home, string> = { yours: OWN_GROUP, editor: EDITOR_GROUP, photo: PHOTO_GROUP, original: OTHER_GROUP };

/** The category a palette lives in, favorites aside. */
export function categoryOf(id: string): Home {
	const palette = PALETTES.find((p) => p.id === id);
	if (!palette) return "original";
	if (!palette.bundled) return "yours";
	return palette.group === "editor" ? "editor" : palette.group === "photo" ? "photo" : "original";
}

export function groupOf(id: string): string {
	return LABEL[categoryOf(id)];
}

export function themeCategories(favorites: ReadonlySet<string>): ThemeCategory[] {
	const home = (id: Home) => PALETTES.filter((p) => categoryOf(p.id) === id);
	return [
		{ id: "favorites", label: "Favorites", blurb: "The palettes you starred", empty: "No favorites yet. Open a category and press f on a palette.", palettes: PALETTES.filter((p) => favorites.has(p.id)) },
		{ id: "yours", label: OWN_GROUP, blurb: "Your own library, from pi-themes", empty: "No palettes of your own yet. Account → i imports a library from pi-themes.", palettes: home("yours") },
		{ id: "editor", label: EDITOR_GROUP, blurb: "Inspired by the classic editor themes", empty: "All of them are yours now.", palettes: home("editor") },
		{ id: "photo", label: PHOTO_GROUP, blurb: "Colors taken from photographs", empty: "All of them are yours now.", palettes: home("photo") },
		{ id: "original", label: OTHER_GROUP, blurb: "Made for Pi", empty: "All of them are yours now.", palettes: home("original") },
	];
}
