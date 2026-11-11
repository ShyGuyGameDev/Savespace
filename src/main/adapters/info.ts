import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import type { AdapterInfo } from '@shared/schemas'
import type { AppContext } from '../app-context'

/** Known install locations per bundle id (to show which adapters apply to this Mac). */
const APP_PATHS: Record<string, string[]> = {
  'com.microsoft.VSCode': ['Visual Studio Code.app'],
  'com.microsoft.VSCodeInsiders': ['Visual Studio Code - Insiders.app'],
  'com.todesktop.230313mzl4w4u92': ['Cursor.app'],
  'com.exafunction.windsurf': ['Windsurf.app'],
  'dev.zed.Zed': ['Zed.app'],
  'com.apple.dt.Xcode': ['Xcode.app'],
  'com.sublimetext.4': ['Sublime Text.app'],
  'com.panic.Nova': ['Nova.app'],
  'com.google.Chrome': ['Google Chrome.app'],
  'com.brave.Browser': ['Brave Browser.app'],
  'com.microsoft.edgemac': ['Microsoft Edge.app'],
  'com.vivaldi.Vivaldi': ['Vivaldi.app'],
  'org.chromium.Chromium': ['Chromium.app'],
  'company.thebrowser.Browser': ['Arc.app'],
  'com.apple.Safari': ['/Applications/Safari.app'],
  'org.mozilla.firefox': ['Firefox.app'],
  'com.apple.mail': ['/System/Applications/Mail.app'],
  'com.microsoft.Outlook': ['Microsoft Outlook.app'],
  'com.apple.Notes': ['/System/Applications/Notes.app'],
  'md.obsidian': ['Obsidian.app'],
  'net.shinyfrog.bear': ['Bear.app'],
  'notion.id': ['Notion.app'],
  'com.apple.iWork.Pages': ['Pages.app'],
  'com.apple.iWork.Numbers': ['Numbers.app'],
  'com.apple.iWork.Keynote': ['Keynote.app'],
  'com.apple.Preview': ['/System/Applications/Preview.app'],
  'com.apple.TextEdit': ['/System/Applications/TextEdit.app'],
  'com.microsoft.Word': ['Microsoft Word.app'],
  'com.microsoft.Excel': ['Microsoft Excel.app'],
  'com.microsoft.Powerpoint': ['Microsoft PowerPoint.app'],
  'com.bohemiancoding.sketch3': ['Sketch.app'],
  'com.apple.finder': ['/System/Library/CoreServices/Finder.app'],
  'com.tinyspeck.slackmacgap': ['Slack.app'],
  'com.hnc.Discord': ['Discord.app'],
  'com.microsoft.teams2': ['Microsoft Teams.app'],
  'com.linear': ['Linear.app'],
  'com.figma.Desktop': ['Figma.app'],
  'com.apple.iCal': ['/System/Applications/Calendar.app'],
  'com.apple.Terminal': ['/System/Applications/Utilities/Terminal.app'],
  'com.googlecode.iterm2': ['iTerm.app'],
  'dev.warp.Warp-Stable': ['Warp.app'],
}

function installed(bundleIds: string[]): boolean {
  return bundleIds.some((b) =>
    (APP_PATHS[b] ?? []).some((p) =>
      p.startsWith('/')
        ? existsSync(p)
        : existsSync(`/Applications/${p}`) || existsSync(`${homedir()}/Applications/${p}`),
    ),
  )
}

export function listAdapters(ctx: Pick<AppContext, 'registry'>): AdapterInfo[] {
  return ctx.registry.adapters.map((a) => ({
    id: a.id,
    displayName: a.displayName,
    bundleIds: a.bundleIds,
    tier: a.tier,
    installed: a.bundleIds.includes('git')
      ? true
      : a.bundleIds.length === 0
        ? true
        : installed(a.bundleIds) ||
          a.bundleIds.some(
            (b) =>
              b.startsWith('com.jetbrains') && existsSync('/Applications/JetBrains Toolbox.app'),
          ),
    needsAutomation: a.needsAutomation,
    notes: a.notes,
  }))
}
