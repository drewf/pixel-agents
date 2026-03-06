// Simple module-level state for Claude Code hooks installation status

let _hooksInstalled = false
const _listeners: Array<(installed: boolean) => void> = []

export function isHooksInstalled(): boolean {
  return _hooksInstalled
}

export function setHooksInstalled(installed: boolean): void {
  _hooksInstalled = installed
  for (const fn of _listeners) fn(installed)
}

export function onHooksStatusChange(fn: (installed: boolean) => void): () => void {
  _listeners.push(fn)
  return () => {
    const idx = _listeners.indexOf(fn)
    if (idx >= 0) _listeners.splice(idx, 1)
  }
}
