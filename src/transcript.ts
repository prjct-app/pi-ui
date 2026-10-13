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

const PATCHED = Symbol.for("pi-ui.transcript");
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

/** Everything transcript knows about the current session, as one immutable value; every change replaces it. */
type SessionState = Readonly<{
	ui: ExtensionContext["ui"] | undefined;
	/** User message texts in the order they were sent, with each occurrence's real timestamp. */
	sent: ReadonlyMap<string, readonly number[]>;
	/** How many times each user text has been rendered, so the right timestamp is picked next. */
	seen: ReadonlyMap<string, number>;
	/** Tool call ids and the assistant message that made them. */
	called: ReadonlyMap<string, number>;
}>;

const idle = (): SessionState => ({
	ui: undefined,
	sent: new Map(),
	seen: new Map(),
	called: new Map(),
});

// The one cell that changes: it holds the current state value, which is always replaced, never edited.
const session: { state: SessionState } = { state: idle() };
const set = (change: Partial<SessionState>): void => {
	session.state = { ...session.state, ...change };
};

/** Adds `message`'s timestamp to the right index. Pure: returns a new state. */
const withMessage = (state: SessionState, message: Message): SessionState => {
	if (!message.timestamp) return state;
	if (message.role === "user") {
		const text = textOf(message.content);
		const sent = new Map(state.sent);
		sent.set(text, [...(state.sent.get(text) ?? []), message.timestamp]);
		return { ...state, sent };
	}
	if (message.role === "assistant" && Array.isArray(message.content)) {
		let called: Map<string, number> | null = null;
		for (const part of message.content) {
			if (part?.type === "toolCall") {
				if (called === null) called = new Map(state.called);
				called.set(part.id, message.timestamp);
			}
		}
		return called === null ? state : { ...state, called };
	}
	return state;
};

/**
 * Cache: a view's user time, computed once and reused across renders.
 * Weak so unused views are released; the cache is rebuilt on every session.
 */
let userTimes: WeakMap<object, number> = new WeakMap();

/** The view's user time, building a new state with the seen counter advanced when this is a fresh view. */
const withUserTime = (state: SessionState, view: UserView & object): { state: SessionState; at: number } => {
	const known = userTimes.get(view);
	if (known !== undefined) return { state, at: known };
	const text = view.text ?? "";
	const position = state.seen.get(text) ?? 0;
	const seen = new Map(state.seen).set(text, position + 1);
	const at = state.sent.get(text)?.[position] ?? Date.now();
	userTimes.set(view, at);
	return { state: { ...state, seen }, at };
};

/** When Pi made a tool call, from the session when it is known. */
export function callTime(toolCallId: string): number | undefined {
	return session.state.called.get(toolCallId);
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
		let state: SessionState = { ui: ctx.ui, sent: new Map(), seen: new Map(), called: new Map() };
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "message") state = withMessage(state, entry.message as Message);
		}
		userTimes = new WeakMap();
		set(state);
	});
	pi.on("session_tree", (_event, ctx) => {
		let state: SessionState = { ui: session.state.ui, sent: new Map(), seen: new Map(), called: new Map() };
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "message") state = withMessage(state, entry.message as Message);
		}
		userTimes = new WeakMap();
		set(state);
	});
	pi.on("message_end", (event) => set(withMessage(session.state, event.message as Message)));

	// A user message is drawn between a blank line above and below, and the
	// chat adds another before it. Both pads go; the stamp takes the top one.
	wrap(UserMessageComponent, function (this: UserView & object, lines) {
		const theme = session.state.ui?.theme;
		if (!theme || lines.length < 3 || !blank(lines[0]!) || !blank(lines[lines.length - 1]!)) return lines;
		const body = lines.slice(1, -1);
		body[body.length - 1] += marks(lines[lines.length - 1]!);
		const { at, state: next } = withUserTime(session.state, this);
		if (next !== session.state) set(next);
		const head = `${marks(lines[0]!)}${" ".repeat(this.outputPad ?? 1)}${stamp(theme, "u", at)}`;
		return [head, ...body];
	});

	// Pi's prose opens with one blank line; the stamp goes right under it.
	wrap(AssistantMessageComponent, function (this: AssistantView, lines) {
		const theme = session.state.ui?.theme;
		const message = this.lastMessage;
		if (!theme || !message?.timestamp || lines.length < 2 || !blank(lines[0]!) || !textOf(message.content).trim()) return lines;
		return [lines[0]!, `${" ".repeat(this.outputPad ?? 1)}${stamp(theme, "p", message.timestamp)}`, ...lines.slice(1)];
	});
}
