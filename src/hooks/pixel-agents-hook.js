#!/usr/bin/env node
// Pixel Agents — Claude Code hook handler
// Reads hook event JSON from stdin and writes a signal file
// to ~/.pixel-agents/events/ for the VS Code extension to pick up.

const fs = require('fs');
const path = require('path');
const os = require('os');

const EVENTS_DIR = path.join(os.homedir(), '.pixel-agents', 'events');
const MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes

// Read all of stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
	try {
		const event = JSON.parse(input);
		fs.mkdirSync(EVENTS_DIR, { recursive: true });

		// Dead-letter check: if old signals exist, nobody is consuming them.
		// Clean up stale files and skip writing to avoid unbounded accumulation.
		const existing = fs.readdirSync(EVENTS_DIR).filter(f => f.endsWith('.json'));
		if (existing.length > 0) {
			const oldest = existing.sort()[0];
			const ts = parseInt(oldest.split('-')[0], 10);
			if (!isNaN(ts) && Date.now() - ts > MAX_AGE_MS) {
				for (const f of existing) {
					try { fs.unlinkSync(path.join(EVENTS_DIR, f)); } catch {}
				}
				return;
			}
		}

		const signal = {
			event: event.hook_event_name,
			session_id: event.session_id,
			transcript_path: event.transcript_path,
			cwd: event.cwd,
			timestamp: Date.now(),
		};

		// Include event-specific fields (no tool_input — can be large/sensitive)
		switch (event.hook_event_name) {
			case 'PreCompact':
				signal.trigger = event.trigger;
				break;
			case 'SessionStart':
				signal.source = event.source;
				signal.model = event.model;
				break;
			case 'SessionEnd':
				signal.reason = event.reason;
				break;
			case 'Stop':
				signal.stop_hook_active = event.stop_hook_active;
				break;
			case 'SubagentStart':
				signal.agent_id = event.agent_id;
				signal.agent_type = event.agent_type;
				break;
			case 'SubagentStop':
				signal.agent_id = event.agent_id;
				signal.agent_type = event.agent_type;
				break;
			case 'PreToolUse':
				signal.tool_name = event.tool_name;
				break;
			case 'PostToolUse':
				signal.tool_name = event.tool_name;
				signal.tool_error = event.tool_error;
				break;
			case 'PermissionRequest':
				signal.tool_name = event.tool_name;
				signal.permission_decision = event.permission_decision;
				break;
			case 'UserPromptSubmit':
				break;
			case 'TaskCompleted':
				signal.task_state = event.task_state;
				break;
		}

		const filename = `${Date.now()}-${event.hook_event_name}.json`;
		fs.writeFileSync(path.join(EVENTS_DIR, filename), JSON.stringify(signal));
	} catch {
		// Silently fail — don't interfere with Claude Code
	}
});
