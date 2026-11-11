import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IpcContract, type IpcChannel, type IpcInput, type IpcOutput } from '@shared/ipc'

export type Handler<C extends IpcChannel> = (
  input: IpcInput<C>,
  e: IpcMainInvokeEvent,
) => Promise<IpcOutput<C>> | IpcOutput<C>
export type Handlers = { [C in IpcChannel]: Handler<C> }

/** Only our own bundle (file://) or the dev server may call IPC. */
export function isTrustedSender(e: IpcMainInvokeEvent, devUrl?: string): boolean {
  const url = e.senderFrame?.url ?? ''
  return url.startsWith('file://') || (!!devUrl && url.startsWith(devUrl))
}

export function registerIpc(handlers: Handlers, devUrl?: string): void {
  for (const channel of Object.keys(IpcContract) as IpcChannel[]) {
    const spec = IpcContract[channel]
    const handler = handlers[channel] as Handler<IpcChannel>
    ipcMain.handle(channel, async (e, raw: unknown) => {
      if (!isTrustedSender(e, devUrl)) throw new Error('Untrusted IPC sender')
      const input = spec.input.safeParse(raw ?? undefined)
      if (!input.success)
        throw new Error(
          `Invalid input for ${channel}: ${input.error.issues.map((i) => i.message).join('; ')}`,
        )
      const result = await handler(input.data as never, e)
      const output = spec.output.safeParse(result)
      if (!output.success) {
        console.error(`[ipc] invalid output for ${channel}`, output.error.issues)
        throw new Error(`Internal error: invalid output for ${channel}`)
      }
      return output.data
    })
  }
}
