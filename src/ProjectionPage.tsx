import { useEffect, useState } from 'react'
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
  return (
    <main
      className="projection-page"
      style={{ backgroundColor: displaySettings.backgroundColor }}
    >
      <div
        className="projection-viewport"
        style={{
          width: `${state.outputViewport.width}px`,
          height: `${state.outputViewport.height}px`,
        }}
      >
        <ProjectionStage
          state={state}
          onVideoEnded={() => window.flProyector.finishVideoPlayback()}
        />
      </div>
    </main>
  )
}
