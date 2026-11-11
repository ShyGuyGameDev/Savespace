/**
 * Recognises web apps inside captured browser URLs so previews read naturally
 * ("Jira ticket WP-12", "Gmail draft", "Figma file …") and restores go to the exact item.
 * Covers: Gmail, Google Docs/Sheets/Slides/Drive/Calendar, Notion, Slack, Discord, Teams, Jira,
 * Linear, Asana, Trello, Figma, GitHub, GitLab, Outlook web.
 */
export interface UrlInfo {
  service: string
  label: string
  /** Desktop deep link that opens the same item in the native app, when one is documented. */
  deepLink?: string
}

export function classifyUrl(raw: string): UrlInfo | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  const h = u.hostname.replace(/^www\./, '')
  const p = u.pathname
  const seg = p.split('/').filter(Boolean)
  const hash = u.hash

  if (h === 'mail.google.com') {
    if (/[#&?]compose=/.test(hash) || hash.startsWith('#drafts'))
      return { service: 'Gmail', label: 'Gmail draft' }
    if (/#\w+\/[A-Za-z0-9]+$/.test(hash)) return { service: 'Gmail', label: 'Gmail thread' }
    return { service: 'Gmail', label: 'Gmail' }
  }
  if (h === 'docs.google.com') {
    const kind =
      seg[0] === 'document'
        ? 'Google Doc'
        : seg[0] === 'spreadsheets'
          ? 'Google Sheet'
          : seg[0] === 'presentation'
            ? 'Google Slides deck'
            : seg[0] === 'forms'
              ? 'Google Form'
              : 'Google Docs'
    return { service: 'Google Docs', label: kind }
  }
  if (h === 'drive.google.com')
    return {
      service: 'Google Drive',
      label: seg[0] === 'drive' && seg[1] === 'folders' ? 'Drive folder' : 'Drive file',
    }
  if (h === 'calendar.google.com') return { service: 'Google Calendar', label: 'Google Calendar' }
  if (h === 'notion.so' || h.endsWith('.notion.site'))
    return { service: 'Notion', label: 'Notion page' }
  if (h === 'app.slack.com' && seg[0] === 'client' && seg[1]) {
    const team = seg[1]
    const chan = seg[2]
    return {
      service: 'Slack',
      label: chan ? 'Slack conversation' : 'Slack workspace',
      deepLink: chan ? `slack://channel?team=${team}&id=${chan}` : `slack://open?team=${team}`,
    }
  }
  if (h === 'discord.com' && seg[0] === 'channels')
    return { service: 'Discord', label: seg[1] === '@me' ? 'Discord DM' : 'Discord channel' }
  if (h === 'teams.microsoft.com' && seg[0] === 'l')
    return {
      service: 'Microsoft Teams',
      label: seg[1] === 'chat' ? 'Teams chat' : seg[1] === 'channel' ? 'Teams channel' : 'Teams',
      deepLink: `msteams:${p}${u.search}`,
    }
  if (h.endsWith('atlassian.net') || /jira/.test(h)) {
    const key = /\/browse\/([A-Z][A-Z0-9]+-\d+)/.exec(p)?.[1] ?? u.searchParams.get('selectedIssue')
    return {
      service: 'Jira',
      label: key ? `Jira ticket ${key}` : p.includes('/boards/') ? 'Jira board' : 'Jira',
    }
  }
  if (h === 'linear.app') {
    const key = /\/issue\/([A-Z][A-Z0-9]*-\d+)/.exec(p)?.[1]
    return { service: 'Linear', label: key ? `Linear issue ${key}` : 'Linear' }
  }
  if (h === 'app.asana.com') return { service: 'Asana', label: 'Asana task' }
  if (h === 'trello.com')
    return {
      service: 'Trello',
      label: seg[0] === 'c' ? 'Trello card' : seg[0] === 'b' ? 'Trello board' : 'Trello',
    }
  if (h === 'figma.com')
    return { service: 'Figma', label: u.searchParams.get('node-id') ? 'Figma frame' : 'Figma file' }
  if (h === 'github.com' && seg.length >= 2) {
    const repo = `${seg[0]}/${seg[1]}`
    if (seg[2] === 'pull' && seg[3])
      return { service: 'GitHub', label: `GitHub PR #${seg[3]} in ${repo}` }
    if (seg[2] === 'issues' && seg[3])
      return { service: 'GitHub', label: `GitHub issue #${seg[3]} in ${repo}` }
    if (seg[2] === 'tree' && seg[3])
      return { service: 'GitHub', label: `GitHub branch ${seg.slice(3).join('/')} in ${repo}` }
    return { service: 'GitHub', label: `GitHub ${repo}` }
  }
  if (h === 'gitlab.com' && seg.length >= 2) {
    const i = seg.indexOf('-')
    const repo = seg.slice(0, i > 0 ? i : 2).join('/')
    if (seg[i + 1] === 'merge_requests')
      return { service: 'GitLab', label: `GitLab MR !${seg[i + 2]} in ${repo}` }
    if (seg[i + 1] === 'issues')
      return { service: 'GitLab', label: `GitLab issue #${seg[i + 2]} in ${repo}` }
    return { service: 'GitLab', label: `GitLab ${repo}` }
  }
  if (h === 'outlook.office.com' || h === 'outlook.live.com')
    return { service: 'Outlook', label: 'Outlook (web)' }
  return null
}

export function describeUrl(url: string, title?: string): string {
  const info = classifyUrl(url)
  const t = title && title !== url ? `“${title.slice(0, 70)}”` : ''
  if (info) return `Open ${info.label}${t ? ` ${t}` : ''}`
  try {
    return `Open ${t || new URL(url).hostname}`
  } catch {
    return `Open ${t || url}`
  }
}
