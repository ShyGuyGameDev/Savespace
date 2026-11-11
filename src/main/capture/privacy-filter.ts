import {
  HARD_EXCLUDED_BUNDLE_IDS,
  HARD_EXCLUDED_URL_HOSTS,
  PRIVATE_WINDOW_TITLE_MARKERS,
} from '@shared/constants'
import type { ExclusionRule, ResourceRef } from '@shared/schemas'

/** Query parameters that commonly carry secrets; stripped from every captured URL. */
const SECRET_PARAMS =
  /^(access_token|id_token|refresh_token|token|code|state|auth|authorization|key|api_key|apikey|password|passwd|pwd|secret|sig|signature|session|sessionid|sid|otp|x-amz-signature|x-amz-credential|x-goog-signature)$/i

export interface PrivacyRules {
  bundleIds: Set<string>
  urlHosts: string[]
  pathPrefixes: string[]
  titleContains: string[]
}

export function buildRules(rules: ExclusionRule[]): PrivacyRules {
  return {
    bundleIds: new Set([
      ...HARD_EXCLUDED_BUNDLE_IDS,
      ...rules.filter((r) => r.type === 'bundleId').map((r) => r.value),
    ]),
    urlHosts: [
      ...HARD_EXCLUDED_URL_HOSTS,
      ...rules.filter((r) => r.type === 'urlHost').map((r) => r.value.toLowerCase()),
    ],
    pathPrefixes: rules.filter((r) => r.type === 'pathPrefix').map((r) => r.value),
    titleContains: rules
      .filter((r) => r.type === 'titleContains')
      .map((r) => r.value.toLowerCase()),
  }
}

export function isExcludedApp(bundleId: string | null | undefined, rules: PrivacyRules): boolean {
  if (!bundleId) return false
  if (rules.bundleIds.has(bundleId)) return true
  // Any password manager / keychain-ish bundle we didn't list explicitly.
  return /(1password|bitwarden|lastpass|dashlane|keepass|keeper|enpass|nordpass|proton\.pass|keychain|passwords)/i.test(
    bundleId,
  )
}

export function isPrivateTitle(title: string | null | undefined): boolean {
  if (!title) return false
  return PRIVATE_WINDOW_TITLE_MARKERS.some((m) => title.includes(m))
}

export function isExcludedTitle(title: string | null | undefined, rules: PrivacyRules): boolean {
  if (!title) return false
  if (isPrivateTitle(title)) return true
  const t = title.toLowerCase()
  return rules.titleContains.some((s) => t.includes(s))
}

export function hostExcluded(host: string, rules: PrivacyRules): boolean {
  const h = host.toLowerCase()
  return rules.urlHosts.some((x) => h === x || h.endsWith('.' + x))
}

/** Removes credentials and secret-looking query params. Returns null if the URL must not be kept at all. */
export function sanitizeUrl(raw: string, rules: PrivacyRules): string | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.username || u.password) return null
  if (u.protocol === 'http:' || u.protocol === 'https:') {
    if (hostExcluded(u.hostname, rules)) return null
    for (const k of [...u.searchParams.keys()]) if (SECRET_PARAMS.test(k)) u.searchParams.delete(k)
    // OAuth implicit-flow fragments carry tokens.
    if (/access_token=|id_token=/.test(u.hash)) u.hash = ''
    return u.toString()
  }
  return raw
}

function pathExcluded(p: string, rules: PrivacyRules): boolean {
  return rules.pathPrefixes.some(
    (pre) => p === pre || p.startsWith(pre.endsWith('/') ? pre : pre + '/'),
  )
}

/** Applies every exclusion rule to a list of refs. Returns the kept refs (URLs sanitized). */
export function filterRefs(refs: ResourceRef[], rules: PrivacyRules): ResourceRef[] {
  const out: ResourceRef[] = []
  for (const r of refs) {
    if (isExcludedApp(r.app, rules)) continue
    if (r.title && isExcludedTitle(r.title, rules)) continue
    if ('path' in r && typeof r.path === 'string' && pathExcluded(r.path, rules)) continue
    if (r.kind === 'gitState' && pathExcluded(r.repoPath, rules)) continue
    if (r.kind === 'windowFrame' && isExcludedTitle(r.windowTitle, rules)) continue
    if (r.kind === 'url' || r.kind === 'doc' || r.kind === 'deepLink') {
      const clean = sanitizeUrl(r.url, rules)
      if (!clean) continue
      out.push({ ...r, url: clean })
      continue
    }
    out.push(r)
  }
  return out
}
