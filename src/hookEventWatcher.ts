import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// Standalone log shim — replace with `import { log } from './logger.js'`
// when the dedicated output channel logger (PR #X) is merged.
const log = console.log;

const EVENTS_DIR = path.join(os.homedir(), '.pixel-agents', 'events');
const POLL_INTERVAL_MS = 2000;

export interface HookSignal {
	event: string;
	session_id: string;
	transcript_path: string;
	cwd: string;
	timestamp: number;
	// PreCompact
	trigger?: string;
	// SessionStart
	source?: string;
	model?: string;
	// SessionEnd
	reason?: string;
	// Stop
	stop_hook_active?: boolean;
	// SubagentStart / SubagentStop
	agent_id?: string;
	agent_type?: string;
	// PreToolUse / PostToolUse / PermissionRequest
	tool_name?: string;
	tool_error?: string;
	permission_decision?: string;
	// TaskCompleted
	task_state?: string;
}

export type HookEventHandler = (signal: HookSignal) => void;

// --- Subscription-based event bus ---
// The watcher auto-starts when the first subscriber registers and
// auto-stops when the last subscriber unsubscribes.

type EventFilter = string | '*';

interface Subscription {
	filter: EventFilter;
	handler: HookEventHandler;
}

const subscribers: Subscription[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;

function startPolling(): void {
	if (pollTimer) return;

	try {
		fs.mkdirSync(EVENTS_DIR, { recursive: true });
	} catch { /* ignore */ }

	pollTimer = setInterval(() => {
		let files: string[];
		try {
			files = fs.readdirSync(EVENTS_DIR).filter(f => f.endsWith('.json'));
		} catch { return; }

		for (const file of files) {
			const filePath = path.join(EVENTS_DIR, file);
			try {
				const raw = fs.readFileSync(filePath, 'utf-8');
				const signal = JSON.parse(raw) as HookSignal;
				log(`Hook event: ${signal.event} (session: ${signal.session_id?.slice(0, 8)})`);
				for (const sub of subscribers) {
					if (sub.filter === '*' || sub.filter === signal.event) {
						sub.handler(signal);
					}
				}
			} catch (e) {
				log(`Failed to parse hook signal ${file}: ${e}`);
			}
			// Always delete after processing (or on error)
			try { fs.unlinkSync(filePath); } catch { /* ignore */ }
		}
	}, POLL_INTERVAL_MS);
}

function stopPolling(): void {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
}

/**
 * Subscribe to hook events. The watcher starts automatically on first subscription.
 *
 * @param filter - Event name to listen for, or '*' for all events
 * @param handler - Callback receiving the hook signal
 * @returns Unsubscribe function — call it to remove this subscription.
 *          The watcher stops automatically when all subscribers are removed.
 *
 * @example
 *   const unsub = onHookEvent('PreToolUse', (signal) => { ... });
 *   const unsub2 = onHookEvent('*', (signal) => { ... });
 *   unsub();  // removes first subscription
 *   unsub2(); // removes last subscription, watcher stops
 */
export function onHookEvent(filter: EventFilter, handler: HookEventHandler): () => void {
	const sub: Subscription = { filter, handler };
	subscribers.push(sub);

	// Auto-start on first subscriber
	if (subscribers.length === 1) {
		startPolling();
	}

	// Return unsubscribe function
	return () => {
		const idx = subscribers.indexOf(sub);
		if (idx !== -1) {
			subscribers.splice(idx, 1);
		}
		// Auto-stop when no subscribers remain
		if (subscribers.length === 0) {
			stopPolling();
		}
	};
}

/** Force stop the watcher and remove all subscribers */
export function stopAllHookEvents(): void {
	subscribers.length = 0;
	stopPolling();
}

/** Check if the events directory has been set up (hooks likely installed) */
export function isHookEventsDirectoryReady(): boolean {
	return fs.existsSync(EVENTS_DIR);
}
