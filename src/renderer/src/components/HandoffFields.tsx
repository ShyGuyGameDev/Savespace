export const handoffFields = [
  ['goal', 'What were you trying to do?'],
  ['finding', 'What had you figured out?'],
  ['stopped', 'Where did you stop?'],
  ['next', 'What should you open first?'],
] as const

export type Handoff = Partial<Record<(typeof handoffFields)[number][0], string>>

export function readHandoff(note?: string | null): Handoff {
  if (!note) return {}
  const answers: Handoff = {}
  for (const line of note.split('\n')) {
    const match = /^(goal|finding|stopped|next):\s*(.+)$/i.exec(line)
    if (match) answers[match[1]!.toLowerCase() as keyof Handoff] = match[2]
  }
  return Object.keys(answers).length ? answers : { stopped: note }
}

export function writeHandoff(answers: Handoff): string {
  return handoffFields
    .flatMap(([key]) => {
      const value = answers[key]?.trim().replace(/\s+/g, ' ')
      return value ? [`${key}: ${value}`] : []
    })
    .join('\n')
}

export function HandoffFields({
  value,
  onChange,
}: {
  value: Handoff
  onChange: (value: Handoff) => void
}) {
  return (
    <div className="grid gap-3">
      {handoffFields.map(([key, label]) => (
        <label key={key} className="grid gap-1 text-xs font-medium">
          {label}
          <input
            autoFocus={key === 'goal'}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm font-normal"
            maxLength={230}
            value={value[key] ?? ''}
            onChange={(event) => onChange({ ...value, [key]: event.target.value })}
          />
        </label>
      ))}
    </div>
  )
}
