import * as fs from 'fs';
import * as vscode from 'vscode';
import type { AgentState } from './types.js';
import { removeAgent } from './agentManager.js';
import { STALE_AGENT_TIMEOUT_MS, STALE_AGENT_CHECK_INTERVAL_MS } from './constants.js';

/**
 * Periodically removes stale agents whose terminals are no longer alive
 * and whose JSONL files haven't been modified recently.
 *
 * Agents with a live terminal are managed by onDidCloseTerminal and skipped here.
 */
export function startStaleAgentCheck(
	agents: Map<number, AgentState>,
	fileWatchers: Map<number, fs.FSWatcher>,
	pollingTimers: Map<number, ReturnType<typeof setInterval>>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	jsonlPollTimers: Map<number, ReturnType<typeof setInterval>>,
	webview: vscode.Webview | undefined,
	persistAgents: () => void,
): ReturnType<typeof setInterval> {
	return setInterval(() => {
		const now = Date.now();
		const toRemove: number[] = [];
		const liveTerminals = vscode.window.terminals;

		for (const [id, agent] of agents) {
			// Skip agents whose terminal is still alive
			if (liveTerminals.includes(agent.terminalRef)) continue;

			try {
				const stat = fs.statSync(agent.jsonlFile);
				if (now - stat.mtimeMs > STALE_AGENT_TIMEOUT_MS) {
					toRemove.push(id);
				}
			} catch {
				// File deleted — remove agent
				toRemove.push(id);
			}
		}

		for (const id of toRemove) {
			console.log(`[Pixel Agents] Removing stale agent ${id}`);
			removeAgent(id, agents, fileWatchers, pollingTimers, waitingTimers, permissionTimers, jsonlPollTimers, persistAgents);
			webview?.postMessage({ type: 'agentClosed', id });
		}
	}, STALE_AGENT_CHECK_INTERVAL_MS);
}
