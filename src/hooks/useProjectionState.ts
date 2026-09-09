import { useCallback, useEffect, useState } from 'react'
import { initialProjectionState, type ProjectionPatch, type ProjectionState } from '../../shared/types'

export function useProjectionState() {
  const [state, setState] = useState<ProjectionState>(initialProjectionState)
  useEffect(() => {
    window.flProyector.getState().then(setState)
    return window.flProyector.onState(setState)
  }, [])
  const update = useCallback((patch: ProjectionPatch) => window.flProyector.updateState(patch), [])
  return { state, update }
}
