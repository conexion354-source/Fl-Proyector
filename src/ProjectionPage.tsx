import { ProjectionStage } from './components/ProjectionStage'
import { useProjectionState } from './hooks/useProjectionState'
import { useEffect, useState } from 'react'
import { initialDisplaySettings } from '../shared/types'

export function ProjectionPage() {
  const { state } = useProjectionState()
  const [settings, setSettings] = useState(initialDisplaySettings)
  useEffect(() => {
    window.flProyector.getDisplaySettings().then(setSettings)
    return window.flProyector.onDisplaySettings(setSettings)
  }, [])
  const ratio = settings.aspectRatio === 'custom' ? '16 / 9' : settings.aspectRatio.replace(':', ' / ')
  return <main className="projection-page" style={{ backgroundColor: settings.backgroundColor }}><div className="projection-viewport" style={{ aspectRatio: ratio }}><ProjectionStage state={state} /></div></main>
}
