import { useEffect, useState, type CSSProperties } from 'react'
import { initialDisplaySettings } from '../shared/types'
import { ProjectionStage } from './components/ProjectionStage'
import { useProjectionState } from './hooks/useProjectionState'

export function ProjectionPage() {
  const { state } = useProjectionState()
  const [displaySettings, setDisplaySettings] = useState(initialDisplaySettings)
  useEffect(() => {
    window.flProyector.getDisplaySettings().then(setDisplaySettings)
    return window.flProyector.onDisplaySettings(setDisplaySettings)
  }, [])
  const viewport = state.outputViewport
  return (
    <main
      className="projection-page"
      style={{ backgroundColor: displaySettings.backgroundColor }}
    >
      <div
        className="projection-viewport"
        style={{
          "--projection-width": viewport.width,
          "--projection-height": viewport.height,
        } as CSSProperties}
      >
        <ProjectionStage
          state={state}
          onVideoEnded={() => window.flProyector.finishVideoPlayback()}
        />
      </div>
    </main>
  )
}
