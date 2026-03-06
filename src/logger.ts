import * as vscode from 'vscode';

let channel: vscode.OutputChannel | null = null;

export function initLogger(): void {
	channel = vscode.window.createOutputChannel('Pixel Agents');
}

export function log(msg: string): void {
	const ts = new Date().toISOString().slice(11, 23);
	const line = `[${ts}] ${msg}`;
	if (channel) channel.appendLine(line);
	console.log(`[Pixel Agents] ${msg}`);
}
