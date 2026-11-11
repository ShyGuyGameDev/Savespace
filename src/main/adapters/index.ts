import {
  arcAdapter,
  braveAdapter,
  chromeAdapter,
  chromiumAdapter,
  edgeAdapter,
  safariAdapter,
  vivaldiAdapter,
} from './browsers'
import {
  calendarAdapter,
  documentAppAdapters,
  finderAdapter,
  mailAdapter,
  notesAdapter,
} from './apple-apps'
import {
  jetbrainsAdapters,
  novaAdapter,
  sublimeAdapter,
  xcodeAdapter,
  zedAdapter,
} from './cli-editors'
import {
  bearAdapter,
  discordAdapter,
  figmaAdapter,
  linearAdapter,
  notionAdapter,
  obsidianAdapter,
  outlookAdapter,
  slackAdapter,
  teamsAdapter,
} from './desktop-apps'
import { firefoxAdapter } from './firefox'
import { arrangeAdapter, gitAdapter } from './special'
import { itermAdapter, terminalAdapter, warpAdapter } from './terminals'
import type { AppAdapter } from './types'
import {
  cursorAdapter,
  vscodeAdapter,
  vscodeInsidersAdapter,
  windsurfAdapter,
} from './vscode-family'

/**
 * Every dedicated adapter. To add a deep adapter: create one file exporting an AppAdapter and add
 * one entry below. Apps not listed fall back to the GenericAppAdapter (launch/focus by bundle id).
 * Order = phase-6 order: editors, browsers, email, docs/notes, comms, PM/design (URL-based), dev, terminals.
 */
export function allAdapters(): AppAdapter[] {
  return [
    // special handlers (by ref kind)
    arrangeAdapter,
    gitAdapter,
    // editors
    vscodeAdapter,
    vscodeInsidersAdapter,
    cursorAdapter,
    windsurfAdapter,
    zedAdapter,
    xcodeAdapter,
    ...jetbrainsAdapters,
    sublimeAdapter,
    novaAdapter,
    // browsers
    chromeAdapter,
    braveAdapter,
    edgeAdapter,
    vivaldiAdapter,
    chromiumAdapter,
    arcAdapter,
    safariAdapter,
    firefoxAdapter,
    // email
    mailAdapter,
    outlookAdapter,
    // docs & notes
    notesAdapter,
    obsidianAdapter,
    bearAdapter,
    notionAdapter,
    ...documentAppAdapters,
    finderAdapter,
    // comms
    slackAdapter,
    discordAdapter,
    teamsAdapter,
    // project management / design (desktop apps; their web URLs go through the browser adapters)
    linearAdapter,
    figmaAdapter,
    // calendar
    calendarAdapter,
    // terminals
    terminalAdapter,
    itermAdapter,
    warpAdapter,
  ]
}
