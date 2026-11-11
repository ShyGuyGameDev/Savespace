import { useEffect } from 'react'
import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query'
import type { IpcChannel, IpcEvent, IpcInput, IpcOutput } from '@shared/ipc'

export const api = <C extends IpcChannel>(channel: C, input?: IpcInput<C>): Promise<IpcOutput<C>> =>
  window.waypoint.invoke(channel, input)

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: true, retry: 1 } },
})

export function useIpc<C extends IpcChannel>(
  channel: C,
  input?: IpcInput<C>,
  opts: Omit<UseQueryOptions<IpcOutput<C>>, 'queryKey' | 'queryFn'> = {},
) {
  return useQuery<IpcOutput<C>>({
    queryKey: [channel, input ?? null],
    queryFn: () => api(channel, input),
    ...opts,
  })
}

export function useIpcMutation<C extends IpcChannel>(channel: C, invalidate: IpcChannel[] = []) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: IpcInput<C>) => api(channel, input),
    onSuccess: () => {
      for (const c of invalidate) void qc.invalidateQueries({ queryKey: [c] })
    },
  })
}

export function useIpcEvent<E extends IpcEvent>(
  event: E,
  cb: (p: Parameters<Parameters<typeof window.waypoint.on<E>>[1]>[0]) => void,
) {
  useEffect(() => window.waypoint.on(event, cb), [event, cb])
}

/** Refetch everything when main says data changed. */
export function useLiveData() {
  const qc = useQueryClient()
  useEffect(
    () =>
      window.waypoint.on('data:changed', ({ scope }) => {
        if (scope === 'all') return void qc.invalidateQueries()
        const map: Record<string, IpcChannel[]> = {
          projects: ['projects:list', 'app:currentContext'],
          checkpoints: ['checkpoints:list', 'checkpoints:get', 'projects:list', 'privacy:stats'],
          suggestions: ['suggestions:list'],
          settings: ['settings:get'],
        }
        for (const c of map[scope] ?? []) void qc.invalidateQueries({ queryKey: [c] })
      }),
    [qc],
  )
}
