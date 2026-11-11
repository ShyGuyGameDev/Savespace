import { QueryClientProvider } from '@tanstack/react-query'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { MotionConfig } from 'framer-motion'
import { lazy, Suspense } from 'react'
import { queryClient, useIpc, useLiveData } from '@/lib/bridge'
import { useHashRoute } from '@/lib/route'
import { Onboarding } from '@/onboarding/Onboarding'

const Dashboard = lazy(() =>
  import('@/dashboard/Dashboard').then((m) => ({ default: m.Dashboard })),
)
const Palette = lazy(() => import('@/palette/Palette').then((m) => ({ default: m.Palette })))
const TrayPopover = lazy(() =>
  import('@/tray-popover/TrayPopover').then((m) => ({ default: m.TrayPopover })),
)

function Routes() {
  useLiveData()
  const [route, go] = useHashRoute()
  const settings = useIpc('settings:get')
  if (route.startsWith('/palette')) return <Palette />
  if (route.startsWith('/popover')) return <TrayPopover />
  if (!settings.data) return null
  if (route.startsWith('/onboarding') || !settings.data.onboardingComplete) {
    return (
      <Onboarding
        onDone={() => {
          void settings.refetch()
          go('/')
        }}
      />
    )
  }
  return <Dashboard route={route} navigate={go} />
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <TooltipPrimitive.Provider>
          <Suspense fallback={null}>
            <Routes />
          </Suspense>
        </TooltipPrimitive.Provider>
      </MotionConfig>
    </QueryClientProvider>
  )
}
