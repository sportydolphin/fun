// The one order every WPBL ranking is read in: the Players table, the Leaders cards and the search
// box's "who leads". By the value (nulls last), then the bigger sample, then the name.
//
// THE NAME IS WHAT MAKES IT AN ORDER. Two rows tied on value and sample used to keep whatever order
// the rows arrived in, which was the order of the box-score lines (random uuids) for one source and
// of a stored table for another (derive/playerSeasons.ts). So the same tie could put a different
// player on top of the table and of the search answer that promises to match it. Compared by code
// unit rather than `localeCompare`, whose answer can differ between the browser and the job.

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

export function compareRows(
  av: number | null, bv: number | null, asc: boolean,
  aSample: number, bSample: number, aName: string, bName: string,
): number {
  if (av == null && bv == null) return bSample - aSample || byName(aName, bName)
  if (av == null) return 1          // nulls always sink
  if (bv == null) return -1
  if (av !== bv) return asc ? av - bv : bv - av
  return bSample - aSample || byName(aName, bName)
}
