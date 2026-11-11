import { describe, expect, it } from 'vitest'
import {
  ALLOWED_JXA_METHODS,
  ALLOWED_VERBS,
  FORBIDDEN_PATTERNS,
  SCRIPT_LIST,
  VERB_ASSIGNMENTS,
  VERB_USAGE,
  type Verb,
} from '../../src/main/safe-exec/scripts/registry'

/**
 * The build-breaking safety linter for every AppleScript/JXA template.
 * If you add a template and this fails, the template is doing something Savespace must never do.
 */
const JS_KEYWORDS = new Set([
  'function',
  'if',
  'for',
  'while',
  'catch',
  'return',
  'switch',
  'run',
  'typeof',
])

const stripStrings = (src: string) => src.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''")

describe.each(SCRIPT_LIST.map((t) => [t.id, t] as const))('script template %s', (_id, tpl) => {
  it('declares only allowlisted verbs', () => {
    for (const v of tpl.verbs) expect(ALLOWED_VERBS).toContain(v)
  })

  it('contains no forbidden verb', () => {
    for (const { verb, re } of FORBIDDEN_PATTERNS) {
      expect(re.test(tpl.source), `template ${tpl.id} uses forbidden verb "${verb}"`).toBe(false)
    }
  })

  it('calls only allowlisted methods', () => {
    const code = stripStrings(tpl.source)
    const dotted = [...code.matchAll(/\.\s*([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]!)
    const bare = [...code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)]
      .map((m) => m[1]!)
      .filter((n) => !JS_KEYWORDS.has(n))
    for (const m of [...dotted, ...bare]) {
      expect(
        ALLOWED_JXA_METHODS.has(m),
        `template ${tpl.id} calls non-allowlisted method ${m}()`,
      ).toBe(true)
    }
  })

  it('assigns only properties permitted by its declared verbs', () => {
    const code = stripStrings(tpl.source)
    const assigns = [...code.matchAll(/\.\s*[A-Za-z_$][\w$]*\s*=(?!=)/g)].map((m) => m[0])
    const allowed = tpl.verbs.flatMap((v) => VERB_ASSIGNMENTS[v])
    for (const a of assigns) {
      expect(
        allowed.some((re) => re.test(a)),
        `template ${tpl.id} assigns ${a} without a verb that allows it`,
      ).toBe(true)
    }
  })

  it('declares every verb it uses', () => {
    for (const [verb, re] of Object.entries(VERB_USAGE) as [Exclude<Verb, 'read'>, RegExp][]) {
      if (re.test(tpl.source))
        expect(tpl.verbs, `template ${tpl.id} uses ${verb} without declaring it`).toContain(verb)
    }
  })

  it('never interpolates values (parameters arrive via argv)', () => {
    expect(tpl.source).not.toMatch(/\$\{/)
  })

  it('is flagged arrange-only iff it arranges windows', () => {
    expect(!!tpl.arrange).toBe(tpl.verbs.includes('arrange'))
  })
})

describe('linter self-test: known-bad templates are rejected', () => {
  const bad = [
    `Application('System Events').keystroke('a')`,
    `se.keyCode(36)`,
    `button.click()`,
    `field.value = 'x'`,
    `doc.save()`,
    `msg.send()`,
    `w.close()`,
    `app.quit()`,
    `tab.url = 'https://evil'`,
    `tab.URL = 'https://evil'`,
    `app.doScript('rm -rf ~')`,
    `app.doJavaScript('x', { in: t })`,
    `session.writeText('ls')`,
    `app.doShellScript('id')`,
    `el.actions.byName('AXPress').perform()`,
    `msg.delete()`,
  ]
  it.each(bad)('rejects %s', (src) => {
    expect(FORBIDDEN_PATTERNS.some(({ re }) => re.test(src))).toBe(true)
  })
})

describe('linter self-test: method and assignment checks bite', () => {
  const methodsOf = (src: string) =>
    [...stripStrings(src).matchAll(/\.\s*([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]!)
  it('extracts real calls from a template', () => {
    const tpl = SCRIPT_LIST.find((t) => t.id === 'chromium.focus-or-open')!
    expect(methodsOf(tpl.source)).toEqual(
      expect.arrayContaining(['activate', 'tabs', 'url', 'Tab', 'push']),
    )
  })
  it.each(['w.close()', 'doc.print()', 'app.open(x)', 'p.make({ new: "x" })'])(
    'flags non-allowlisted call in %s',
    (src) => {
      expect(methodsOf(src).some((m) => !ALLOWED_JXA_METHODS.has(m))).toBe(true)
    },
  )
  it('flags an assignment not allowed by read-only verbs', () => {
    const assigns = [
      ...'tab.title = "x"; w.index = 1'.matchAll(/\.\s*[A-Za-z_$][\w$]*\s*=(?!=)/g),
    ].map((m) => m[0])
    expect(assigns.filter((a) => !VERB_ASSIGNMENTS.read.some((re) => re.test(a)))).toHaveLength(2)
  })
})
