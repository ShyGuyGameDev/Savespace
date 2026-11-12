import { AnimatePresence, motion } from 'framer-motion'
import {
  Accessibility,
  Bot,
  Check,
  ChevronRight,
  Cpu,
  EyeOff,
  Lock,
  ShieldCheck,
} from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { APP_NAME, DEFAULT_HOTKEYS } from '@shared/constants'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Badge, Kbd } from '@/components/ui/misc'
import { api, useIpc } from '@/lib/bridge'
import { formatHotkey } from '@/lib/hotkeys'
import { AiDownloadBar, DownloadWhere, useAiStatus } from '@/components/AiDownload'
import { cn } from '@/lib/utils'

const STEPS = ['welcome', 'privacy', 'accessibility', 'automation', 'ai', 'done'] as const
type Step = (typeof STEPS)[number]

export function Onboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('welcome')
  const idx = STEPS.indexOf(step)
  const next = () => setStep(STEPS[Math.min(idx + 1, STEPS.length - 1)]!)
  const back = () => setStep(STEPS[Math.max(idx - 1, 0)]!)

  const finish = async () => {
    // Finishing the intro without answering the AI question counts as "yes".
    const s = await api('settings:get')
    await api('settings:set', {
      onboardingComplete: true,
      ...(s.aiDownloadConsent === 'unasked' ? { aiDownloadConsent: 'yes' as const } : {}),
    })
    onDone()
  }
  const skip = async () => {
    // Skipping the AI step counts as "yes" (the model then downloads in the background).
    if (step === 'ai') {
      const s = await api('settings:get')
      if (s.aiDownloadConsent === 'unasked') await api('settings:set', { aiDownloadConsent: 'yes' })
    }
    next()
  }

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="drag h-12 shrink-0" />
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col px-8 pb-8">
        <ol className="mb-8 flex items-center gap-1.5" aria-label="Setup progress">
          {STEPS.map((s, i) => (
            <li
              key={s}
              aria-current={s === step ? 'step' : undefined}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                i <= idx ? 'bg-primary' : 'bg-muted',
              )}
            >
              <span className="sr-only">
                Step {i + 1} of {STEPS.length}
              </span>
            </li>
          ))}
        </ol>
        <AnimatePresence mode="wait">
          <motion.section
            key={step}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="flex flex-1 flex-col"
            aria-live="polite"
          >
            {step === 'welcome' && <Welcome />}
            {step === 'privacy' && <Privacy />}
            {step === 'accessibility' && <AccessibilityStep />}
            {step === 'automation' && <AutomationStep />}
            {step === 'ai' && <AiStep />}
            {step === 'done' && <Done />}
          </motion.section>
        </AnimatePresence>
        <footer className="mt-6 flex items-center justify-between">
          <Button variant="ghost" onClick={back} disabled={idx === 0}>
            Back
          </Button>
          <div className="flex items-center gap-2">
            {step !== 'welcome' && step !== 'privacy' && step !== 'done' && (
              <Button variant="ghost" onClick={() => void skip()}>
                Skip for now
              </Button>
            )}
            {step === 'done' ? (
              <Button onClick={finish} autoFocus>
                Start using {APP_NAME}
              </Button>
            ) : (
              <Button onClick={next} autoFocus>
                Continue <ChevronRight aria-hidden />
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}

function Hero({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <>
      <div
        className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground [&_svg]:size-6"
        aria-hidden
      >
        {icon}
      </div>
      <h1 className="mb-2 text-xl font-semibold tracking-tight">{title}</h1>
      <div className="space-y-3 text-[14px] leading-relaxed text-muted-foreground">{children}</div>
    </>
  )
}

function Welcome() {
  return (
    <Hero icon={<Logo className="!size-7" />} title={`Welcome to ${APP_NAME}`}>
      <p>
        When you step away from a project, {APP_NAME} saves a{' '}
        <strong className="text-foreground">checkpoint</strong>: which apps, files, tabs, drafts and
        tickets you had open. When you come back, it reopens them and shows a short “what you were
        doing” note.
      </p>
      <p className="rounded-lg border border-border bg-muted/50 p-3 text-foreground">
        <ShieldCheck className="mr-1.5 inline size-4 text-success" aria-hidden />
        <strong>{APP_NAME} only ever opens things.</strong> It never types, clicks, edits, saves,
        sends, deletes or closes anything in your other apps.
      </p>
    </Hero>
  )
}

function Privacy() {
  return (
    <Hero icon={<Lock />} title="What stays on your Mac">
      <div className="grid grid-cols-2 gap-3 text-[13px]">
        <div className="rounded-lg border border-border p-3">
          <p className="mb-1.5 font-medium text-foreground">Remembered</p>
          <ul className="list-disc space-y-1 pl-4">
            <li>App and window names</li>
            <li>File and folder paths</li>
            <li>Web page addresses and titles</li>
            <li>Git branch and status</li>
            <li>Email subjects and draft IDs</li>
            <li>Calendar event titles</li>
          </ul>
        </div>
        <div className="rounded-lg border border-border p-3">
          <p className="mb-1.5 flex items-center gap-1 font-medium text-foreground">
            <EyeOff className="size-3.5" aria-hidden /> Never
          </p>
          <ul className="list-disc space-y-1 pl-4">
            <li>Screenshots or screen recording</li>
            <li>What’s inside your documents</li>
            <li>Email or message text</li>
            <li>Keystrokes</li>
            <li>Private or incognito windows</li>
            <li>Password managers</li>
          </ul>
        </div>
      </div>
      <p>
        Everything is stored encrypted on this Mac. Summaries use a local AI model if you have one.
        Nothing is sent to the cloud.
      </p>
    </Hero>
  )
}

function usePolledPermissions() {
  const q = useIpc('permissions:status', undefined, { refetchInterval: 1500 })
  return q
}

function AccessibilityStep() {
  const { data, refetch } = usePolledPermissions()
  const granted = data?.accessibility === 'granted'
  return (
    <Hero icon={<Accessibility />} title="Let Savespace see window titles">
      <p>
        macOS calls this <strong className="text-foreground">Accessibility</strong>. {APP_NAME} uses
        it only to read the <em>titles and positions</em> of your windows, so it knows which
        document or project each window belongs to. It does not need Screen Recording, and it never
        controls your apps.
      </p>
      <p>
        <strong className="text-foreground">Without it:</strong> {APP_NAME} still works. It sees
        which app is in front and can still read tabs, editor files and drafts from apps that
        support it, but it can’t tell your windows apart.
      </p>
      <div className="flex items-center gap-3 pt-2">
        {granted ? (
          <Badge tone="success">
            <Check className="size-3" aria-hidden /> Allowed
          </Badge>
        ) : (
          <>
            <Button
              onClick={async () => {
                await api('permissions:promptAccessibility')
                await refetch()
              }}
            >
              Open System Settings
            </Button>
            <span className="text-[12px]">
              Then turn on <strong className="text-foreground">{APP_NAME}</strong> (or{' '}
              <em>Electron</em> while developing) under Privacy &amp; Security → Accessibility.
            </span>
          </>
        )}
      </div>
    </Hero>
  )
}

function AutomationStep() {
  const { data, refetch } = usePolledPermissions()
  const { data: adapters } = useIpc('adapters:list')
  const installed = new Set((adapters ?? []).filter((a) => a.installed).flatMap((a) => a.bundleIds))
  const [busy, setBusy] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, { ok: boolean; text: string }>>({})
  const targets = [
    ['com.apple.systemevents', 'System Events', 'List your open windows.'],
    ['com.google.Chrome', 'Google Chrome', 'Read tab addresses (never incognito).'],
    ['com.apple.Safari', 'Safari', 'Open or focus saved pages.'],
    ['com.apple.mail', 'Mail', 'Subjects and IDs of drafts (never the text).'],
    ['com.apple.Notes', 'Notes', 'Which note was selected (title only).'],
    ['com.apple.iCal', 'Calendar', 'Titles of events around now.'],
    ['com.apple.finder', 'Finder', 'Which folders were open.'],
  ] as const
  return (
    <Hero icon={<Bot />} title="Ask your apps what’s open">
      <p>
        macOS asks you once per app before {APP_NAME} may talk to it (
        <strong className="text-foreground">Automation</strong>). Each request is read-only.
      </p>
      <p className="rounded-lg border border-border bg-muted/50 p-3 text-[13px] text-foreground">
        <strong>Closed apps will be opened when you ask.</strong> macOS can only ask while an app is
        running, so clicking Ask opens a closed app quietly in the background first. You can also
        skip this step: macOS will ask the first time {APP_NAME} needs each app.
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border text-[13px]">
        {targets
          .filter(
            ([id]) =>
              id === 'com.apple.systemevents' ||
              id === 'com.apple.finder' ||
              installed.size === 0 ||
              installed.has(id),
          )
          .map(([id, name, why]) => {
            const state = data?.automation[id] ?? 'not-determined'
            return (
              <li key={id} className="flex items-center gap-3 px-3 py-2">
                <div className="flex-1">
                  <p className="font-medium text-foreground">{name}</p>
                  <p className="text-[12px]">{why}</p>
                  {notes[id] && state !== 'granted' && (
                    <p
                      className={cn(
                        'mt-0.5 text-[12px]',
                        notes[id]!.ok ? 'text-success' : 'text-warning',
                      )}
                      role="status"
                    >
                      {notes[id]!.text}
                    </p>
                  )}
                </div>
                {state === 'granted' ? (
                  <Badge tone="success">Allowed</Badge>
                ) : state === 'denied' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => api('permissions:openSettings', { pane: 'automation' })}
                  >
                    Denied — open Settings
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === id}
                    onClick={async () => {
                      setBusy(id)
                      try {
                        const r = await api('permissions:requestAutomation', { bundleId: id })
                        if (r.lastRequest)
                          setNotes((n) => ({
                            ...n,
                            [id]: {
                              ok: r.lastRequest!.outcome === 'granted',
                              text: r.lastRequest!.message,
                            },
                          }))
                      } catch (e) {
                        setNotes((n) => ({ ...n, [id]: { ok: false, text: (e as Error).message } }))
                      }
                      await refetch()
                      setBusy(null)
                    }}
                  >
                    {busy === id ? 'Waiting for your answer…' : 'Ask'}
                  </Button>
                )}
              </li>
            )
          })}
      </ul>
    </Hero>
  )
}

function AiStep() {
  const { status, download } = useAiStatus()
  const settings = useIpc('settings:get')
  const consent = settings.data?.aiDownloadConsent ?? 'unasked'
  const answer = async (value: 'yes' | 'no') => {
    await api('settings:set', { aiDownloadConsent: value })
    await settings.refetch()
  }
  const apple = status?.apple.available
  return (
    <Hero icon={<Cpu />} title="Local summaries, built in">
      <p>
        {APP_NAME} writes a 2–3 sentence “what you were doing” recap with AI that runs{' '}
        <strong className="text-foreground">entirely on this Mac</strong>. Nothing you work on is
        ever sent anywhere.
      </p>
      {!status ? null : apple ? (
        <Badge tone="success">
          <Check className="size-3" aria-hidden /> Ready: using Apple’s on-device AI. Nothing to
          download.
        </Badge>
      ) : status.modelAvailable || download?.status === 'success' ? (
        <Badge tone="success">
          <Check className="size-3" aria-hidden /> Ready
        </Badge>
      ) : !status.installed ? (
        <p className="rounded-lg border border-border p-3 text-[13px]">
          You’ll get simple summaries built from each checkpoint.
        </p>
      ) : consent === 'unasked' ? (
        <div
          className="space-y-3 rounded-lg border border-border p-3 text-[13px]"
          role="group"
          aria-labelledby="ai-question"
        >
          <p id="ai-question" className="font-medium text-foreground">
            Download the AI model?
          </p>
          <p>
            This Mac can’t use Apple’s on-device AI, so {APP_NAME} needs a small AI model (about 2
            GB, one time). It{' '}
            <strong className="text-foreground">downloads in the background</strong>, so you can
            keep using {APP_NAME} while it finishes. Without it, you get simple summaries.
          </p>
          <DownloadWhere dir={status.modelsDir} />
          <div className="flex gap-2">
            <Button onClick={() => void answer('yes')}>Yes, download in the background</Button>
            <Button variant="secondary" onClick={() => void answer('no')}>
              No thanks
            </Button>
          </div>
        </div>
      ) : consent === 'yes' ? (
        <div className="space-y-2 rounded-lg border border-border p-3 text-[13px]" role="status">
          <p>
            Downloading in the background. You can keep going; summaries get smarter as soon as it’s
            ready.
          </p>
          {download ? (
            <AiDownloadBar d={download} dir={status.modelsDir} />
          ) : (
            <DownloadWhere dir={status.modelsDir} />
          )}
        </div>
      ) : (
        <div className="space-y-2 rounded-lg border border-border p-3 text-[13px]" role="status">
          <p>
            No problem. You’ll get simple summaries. You can download the AI model any time in
            Settings → Local AI.
          </p>
          <Button size="sm" variant="secondary" onClick={() => void answer('yes')}>
            Download it after all
          </Button>
        </div>
      )}
    </Hero>
  )
}

function Done() {
  const [hk, setHk] = useState({
    palette: DEFAULT_HOTKEYS.palette as string,
    checkpoint: DEFAULT_HOTKEYS.checkpointNow as string,
  })
  useEffect(() => {
    void api('settings:get').then((s) =>
      setHk({ palette: s.hotkeyPalette, checkpoint: s.hotkeyCheckpoint }),
    )
  }, [])
  return (
    <Hero icon={<Check />} title="You’re set">
      <p>
        {APP_NAME} lives in your menu bar and quietly saves checkpoints when you switch projects, go
        idle, or close your laptop.
      </p>
      <ul className="space-y-2 text-[13px]">
        <li className="flex items-center gap-2">
          <Kbd>{formatHotkey(hk.palette)}</Kbd> Open the command palette to resume a project
        </li>
        <li className="flex items-center gap-2">
          <Kbd>{formatHotkey(hk.checkpoint)}</Kbd> Save a checkpoint right now
        </li>
      </ul>
      <p>
        New projects appear in <strong className="text-foreground">Suggestions</strong>. Nothing
        becomes a project until you confirm it.
      </p>
    </Hero>
  )
}
