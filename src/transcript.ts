import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AssistantMessageComponent, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { stamp } from "@prjct.app/pi-tui-kit";

/**
 * The transcript as a quiet chat: "u. 16:18" over each message, "p. 16:22"
 * over Pi's prose, and one blank line between them.
 *
 * Pi has no option for either. Extensions share the host's classes, so the
 * message components' render is wrapped once; if their shape changes, the
 * lines pass through untouched.
 */

const PATCHED = Symbol.for("p-ui.transcript");
const SHELL_MARK = /\x1b\]133;[A-Z]\x07/g;
const SGR = /\x1b\[[0-9;]*m/g;

type Lines = (width: number) => string[];
type Patchable = { render: Lines; [PATCHED]?: true };
type Message = { role: string; timestamp?: number; content: unknown };
type UserView = { text?: string; outputPad?: number };
type AssistantView = { lastMessage?: Message; outputPad?: number };

const blank = (line: string) => !line.replace(SHELL_MARK, "").replace(SGR, "").trim();
const marks = (line: string) => line.match(SHELL_MARK)?.join("") ?? "";
const textOf = (content: unknown): string => typeof content === "string"
	? content
	: Array.isArray(content) ? content.filter((part) => part?.type === "text").map((part) => part.text).join("") : "";

let ui: ExtensionContext["ui"] | undefined;

/**
 * Real times from the session, so a resumed session shows when things
 * happened, not when they were redrawn. Messages are matched by text in order;
 * a message the index has not seen yet is live, so now is its time.
 */
const sent = new Map<string, number[]>();
const seen = new Map<string, number>();
const called = new Map<string, number>();
const userTimes = new WeakMap<object, number>();

function index(ctx: ExtensionContext): void {
	sent.clear();
	seen.clear();
	called.clear();
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type === "message") remember(entry.message as Message);
	}
}

function remember(message: Message): void {
	if (!message.timestamp) return;
	if (message.role === "user") {
		const text = textOf(message.content);
		sent.set(text, [...(sent.get(text) ?? []), message.timestamp]);
	}
	if (message.role === "assistant" && Array.isArray(message.content)) {
		for (const part of message.content) if (part?.type === "toolCall") called.set(part.id, message.timestamp);
	}
}

function userTime(view: UserView & object): number {
	const known = userTimes.get(view);
	if (known) return known;
	const text = view.text ?? "";
	const position = seen.get(text) ?? 0;
	seen.set(text, position + 1);
	const at = sent.get(text)?.[position] ?? Date.now();
	userTimes.set(view, at);
	return at;
}

/** When Pi made a tool call, from the session when it is known. */
export function callTime(toolCallId: string): number | undefined {
	return called.get(toolCallId);
}

function wrap(target: unknown, next: (this: any, lines: string[]) => string[]): void {
	const proto = (target as { prototype?: Patchable } | undefined)?.prototype;
	if (!proto || typeof proto.render !== "function" || proto[PATCHED]) return;
	const render = proto.render;
	proto.render = function (this: any, width: number): string[] {
		return next.call(this, render.call(this, width));
	};
	proto[PATCHED] = true;
}

export default function transcript(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ui = ctx.ui;
		index(ctx);
	});
	pi.on("session_tree", (_event, ctx) => index(ctx));
	pi.on("message_end", (event) => remember(event.message as Message));

	// A user message is drawn between a blank line above and below, and the
	// chat adds another before it. Both pads go; the stamp takes the top one.
	wrap(UserMessageComponent, function (this: UserView & object, lines) {
		const theme = ui?.theme;
		if (!theme || lines.length < 3 || !blank(lines[0]!) || !blank(lines[lines.length - 1]!)) return lines;
		const body = lines.slice(1, -1);
		body[body.length - 1] += marks(lines[lines.length - 1]!);
		const head = `${marks(lines[0]!)}${" ".repeat(this.outputPad ?? 1)}${stamp(theme, "u", userTime(this))}`;
		return [head, ...body];
	});

	// Pi's prose opens with one blank line; the stamp goes right under it.
	wrap(AssistantMessageComponent, function (this: AssistantView, lines) {
		const theme = ui?.theme;
		const message = this.lastMessage;
		if (!theme || !message?.timestamp || lines.length < 2 || !blank(lines[0]!) || !textOf(message.content).trim()) return lines;
		return [lines[0]!, `${" ".repeat(this.outputPad ?? 1)}${stamp(theme, "p", message.timestamp)}`, ...lines.slice(1)];
	});
}
