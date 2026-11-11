/** Turns an Electron accelerator ("Alt+Command+Space") into macOS glyphs ("⌥⌘Space"). */
export function formatHotkey(acc: string): string {
  const map: Record<string, string> = {
    Command: '⌘',
    Cmd: '⌘',
    CommandOrControl: '⌘',
    CmdOrCtrl: '⌘',
    Alt: '⌥',
    Option: '⌥',
    Shift: '⇧',
    Control: '⌃',
    Ctrl: '⌃',
    Space: 'Space',
  }
  return acc
    .split('+')
    .map((p) => map[p] ?? p)
    .join('')
}
