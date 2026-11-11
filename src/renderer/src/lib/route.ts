import { useEffect, useState } from 'react'

export function useHashRoute(): [string, (r: string) => void] {
  const read = () => window.location.hash.replace(/^#/, '') || '/'
  const [route, setRoute] = useState(read)
  useEffect(() => {
    const onHash = () => setRoute(read())
    window.addEventListener('hashchange', onHash)
    const off = window.waypoint.on('nav:route', ({ route }) => {
      if (route !== read()) window.location.hash = route
    })
    return () => {
      window.removeEventListener('hashchange', onHash)
      off()
    }
  }, [])
  return [route, (r: string) => (window.location.hash = r)]
}
