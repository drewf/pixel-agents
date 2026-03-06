import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// Standalone log shim — replace with `import { log } from './logger.js'`
// when the dedicated output channel logger (PR #X) is merged.
const log = console.log;

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json');
const HOOK_SCRIPT_DIR = path.join(os.homedir(), '.pixel-agents', 'hooks');
const HOOK_SCRIPT_NAME = 'pixel-agents-hook.js';
const EVENTS_DIR = path.join(os.homedir(), '.pixel-agents', 'events');

// Marker to identify our hooks in settings.json
const HOOK_MARKER = 'pixel-agents-hook.js';

/** Events we install hooks for */
const HOOK_EVENTS = [
	'PreCompact',
	'SessionStart',
	'SessionEnd',
	'Stop',
	'SubagentStart',
	'SubagentStop',
	'PreToolUse',
	'PostToolUse',
	'PermissionRequest',
	'UserPromptSubmit',
	'TaskCompleted',
] as const;

function getHookCommand(): string {
	const scriptPath = path.join(HOOK_SCRIPT_DIR, HOOK_SCRIPT_NAME);
	// Use forward slashes for cross-platform compatibility in shell commands
	const normalized = scriptPath.replace(/\\/g, '/');
	return `node "${normalized}"`;
}

function buildHookEntry() {
	return {
		type: 'command' as const,
		command: getHookCommand(),
	};
}

/**
 * Install the hook script file to ~/.pixel-agents/hooks/
 * Copies from the extension's bundled hooks directory.
 */
export function installHookScript(extensionPath: string): boolean {
	try {
		// Look for the hook script in the extension's dist/hooks or src/hooks
		let sourcePath = path.join(extensionPath, 'dist', 'hooks', HOOK_SCRIPT_NAME);
		if (!fs.existsSync(sourcePath)) {
			sourcePath = path.join(extensionPath, 'hooks', HOOK_SCRIPT_NAME);
		}
		if (!fs.existsSync(sourcePath)) {
			sourcePath = path.join(extensionPath, 'src', 'hooks', HOOK_SCRIPT_NAME);
		}
		if (!fs.existsSync(sourcePath)) {
			log(`Hook script not found in extension at ${extensionPath}`);
			return false;
		}

		fs.mkdirSync(HOOK_SCRIPT_DIR, { recursive: true });
		fs.mkdirSync(EVENTS_DIR, { recursive: true });
		fs.copyFileSync(sourcePath, path.join(HOOK_SCRIPT_DIR, HOOK_SCRIPT_NAME));
		log(`Hook script installed to ${HOOK_SCRIPT_DIR}`);
		return true;
	} catch (e) {
		log(`Failed to install hook script: ${e}`);
		return false;
	}
}

/**
 * Add Pixel Agents hooks to ~/.claude/settings.json
 */
export function installHooksInSettings(): boolean {
	try {
		// Read existing settings
		let settings: Record<string, unknown> = {};
		if (fs.existsSync(CLAUDE_SETTINGS_PATH)) {
			const raw = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
			settings = JSON.parse(raw);
		}

		// Initialize hooks object if missing
		if (!settings.hooks || typeof settings.hooks !== 'object') {
			settings.hooks = {};
		}
		const hooks = settings.hooks as Record<string, unknown[]>;

		const entry = buildHookEntry();

		for (const event of HOOK_EVENTS) {
			if (!Array.isArray(hooks[event])) {
				hooks[event] = [];
			}

			// Check if our hook is already installed
			const existing = hooks[event] as Array<{ description?: string; hooks?: Array<{ command?: string }> }>;
			const alreadyInstalled = existing.some(group =>
				group.hooks?.some(h => h.command?.includes(HOOK_MARKER)),
			);

			if (!alreadyInstalled) {
				existing.push({
					description: 'Pixel Agents — VS Code extension for animated Claude Code session characters. Safe to remove if extension is uninstalled. https://github.com/pablodelucca/pixel-agents',
					hooks: [entry],
				});
			}
		}

		// Write back
		fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
		log(`Hooks installed in ${CLAUDE_SETTINGS_PATH}`);
		return true;
	} catch (e) {
		log(`Failed to install hooks in settings: ${e}`);
		return false;
	}
}

/**
 * Remove Pixel Agents hooks from ~/.claude/settings.json
 */
export function uninstallHooksFromSettings(): boolean {
	try {
		if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return true;

		const raw = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
		const settings = JSON.parse(raw) as Record<string, unknown>;

		if (!settings.hooks || typeof settings.hooks !== 'object') return true;
		const hooks = settings.hooks as Record<string, unknown[]>;

		for (const event of HOOK_EVENTS) {
			if (!Array.isArray(hooks[event])) continue;

			// Remove matcher groups that contain our hook
			hooks[event] = (hooks[event] as Array<{ hooks?: Array<{ command?: string }> }>)
				.filter(group =>
					!group.hooks?.some(h => h.command?.includes(HOOK_MARKER)),
				);

			// Clean up empty arrays
			if ((hooks[event] as unknown[]).length === 0) {
				delete hooks[event];
			}
		}

		// Clean up empty hooks object
		if (Object.keys(hooks).length === 0) {
			delete settings.hooks;
		}

		fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
		log(`Hooks removed from ${CLAUDE_SETTINGS_PATH}`);

		// Clean up any pending signal files
		cleanupEventFiles();

		return true;
	} catch (e) {
		log(`Failed to uninstall hooks: ${e}`);
		return false;
	}
}

/**
 * Remove all signal files from the events directory
 */
function cleanupEventFiles(): void {
	try {
		if (!fs.existsSync(EVENTS_DIR)) return;
		const files = fs.readdirSync(EVENTS_DIR).filter(f => f.endsWith('.json'));
		for (const f of files) {
			try { fs.unlinkSync(path.join(EVENTS_DIR, f)); } catch { /* ignore */ }
		}
		if (files.length > 0) log(`Cleaned up ${files.length} pending signal file(s)`);
	} catch { /* ignore */ }
}

/**
 * Check if Pixel Agents hooks are currently installed
 */
export function areHooksInstalled(): boolean {
	try {
		if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return false;

		const raw = fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8');
		const settings = JSON.parse(raw) as Record<string, unknown>;

		if (!settings.hooks || typeof settings.hooks !== 'object') return false;
		const hooks = settings.hooks as Record<string, unknown[]>;

		// Check if at least PreCompact hook is installed (the most important one)
		if (!Array.isArray(hooks.PreCompact)) return false;

		return (hooks.PreCompact as Array<{ hooks?: Array<{ command?: string }> }>)
			.some(group =>
				group.hooks?.some(h => h.command?.includes(HOOK_MARKER)),
			);
	} catch {
		return false;
	}
}

/**
 * Full install: copy script + add to settings
 */
export function installHooks(extensionPath: string): boolean {
	const scriptOk = installHookScript(extensionPath);
	if (!scriptOk) return false;
	return installHooksInSettings();
}

/**
 * Full uninstall: remove from settings (leave script in place for safety)
 */
export function uninstallHooks(): boolean {
	return uninstallHooksFromSettings();
}
