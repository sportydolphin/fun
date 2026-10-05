// Every Offseason Visual the runner knows, by slug. Add a new one here after writing it.
import type { Visual } from './kit'
import template from './_template'
import everyBall from './every-ball'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const VISUALS: Record<string, Visual<any>> = {
  [template.slug]: template,
  [everyBall.slug]: everyBall,
}
