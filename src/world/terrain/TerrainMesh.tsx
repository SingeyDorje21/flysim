import { useEffect, useMemo } from 'react'
import { MeshLambertMaterial } from 'three'
import { buildTerrainGeometry } from './buildTerrainGeometry'

export function TerrainMesh({ segments, shadows }: { segments: number; shadows: boolean }) {
  const geometry = useMemo(() => buildTerrainGeometry(segments), [segments])
  const material = useMemo(() => new MeshLambertMaterial({ vertexColors: true }), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  return <mesh geometry={geometry} material={material} receiveShadow={shadows} frustumCulled={false} />
}
