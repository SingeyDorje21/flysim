import type { AircraftId } from '../../config/aircraftCatalog'
import { createF22 } from './f22'
import type { AircraftRig } from './rigTypes'
import { createTrainerRig } from './trainerModel'
import { createA220, createA350, createGlobal8000 } from './transport'

/** Build the model for an aircraft id. Pure three.js; dispose() when replacing it. */
export function createAircraftRig(id: AircraftId, shadows: boolean): AircraftRig {
  switch (id) {
    case 'f22':
      return createF22(shadows)
    case 'a220':
      return createA220(shadows)
    case 'a350':
      return createA350(shadows)
    case 'global8000':
      return createGlobal8000(shadows)
    default:
      return createTrainerRig(shadows)
  }
}
