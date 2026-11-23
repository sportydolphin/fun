// Types for shared/r2Usage.js, hand-written like the other shared sidecars.
export const R2_FREE_TIER: { storageBytes: number; classA: number; classB: number }
export const ALERT_AT: number

export type Allowance = 'storage' | 'classA' | 'classB'

export function operationClass(action: string): 'A' | 'B' | 'free'
export function sumOperations(
  rows: Array<{ bucket: string; action: string; requests: number }>,
): Map<string, { classA: number; classB: number }>

export interface BucketUsageRow {
  payload_bytes: number
  metadata_bytes: number
  class_a_month: number
  class_b_month: number
}
export function accountUsage(buckets: BucketUsageRow[]): {
  storageBytes: number
  classA: number
  classB: number
  shares: Record<Allowance, number>
  over: Allowance[]
}
export function alertKey(allowance: Allowance, now: Date): string
export function monthStart(now: Date): Date
export function formatBytes(n: number): string
