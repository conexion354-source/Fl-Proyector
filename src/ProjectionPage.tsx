import { ProjectionStage } from './components/ProjectionStage'
import { useProjectionState } from './hooks/useProjectionState'

export function ProjectionPage() {
  const { state } = useProjectionState()
  return <main className="projection-page"><div className="projection-viewport"><ProjectionStage state={state} /></div></main>
}
