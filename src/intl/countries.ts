// National teams by IOC code, the id every World Cup row carries (src/intl/wbsc/game.ts).
//
// The names are WBSC's own labels from its schedules, so a reader moving between this site and
// wbsc.org sees the same team ("Chinese Taipei", "Hong Kong, China"). One exception: WBSC's "United
// States of America" is "USA", which fits a standings row. A code missing here shows as the code,
// never as nothing.

const NAMES: Readonly<Record<string, string>> = {
  AUS: 'Australia',
  CAN: 'Canada',
  CHN: 'China',
  CUB: 'Cuba',
  DOM: 'Dominican Republic',
  FRA: 'France',
  GBR: 'Great Britain',
  HKG: 'Hong Kong, China',
  IND: 'India',
  JPN: 'Japan',
  KOR: 'Korea',
  MEX: 'Mexico',
  NED: 'Netherlands',
  PAK: 'Pakistan',
  PHI: 'Philippines',
  PUR: 'Puerto Rico',
  TPE: 'Chinese Taipei',
  USA: 'USA',
  VEN: 'Venezuela',
}

export const countryName = (ioc: string | null | undefined): string => (ioc ? NAMES[ioc] ?? ioc : '')
