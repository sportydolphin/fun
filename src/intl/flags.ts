// National flags by IOC code, square, for a team's round badge (WorldCupPage.tsx's `CountryBadge`).
//
// From `flag-icons` (MIT, Panayiotis Lipiridis), imported one by one so the bundle carries only the
// flags a World Cup team uses rather than all 270. A new team's code goes here, or its badge shows
// the code instead, which is also the fallback for a code with no flag below.
//
// CHINESE TAIPEI HAS NONE ON PURPOSE. In international sport it competes under the Chinese Taipei
// Olympic flag, never the national one, and no flag set carries that flag, so its badge reads TPE.

import aus from 'flag-icons/flags/1x1/au.svg'
import can from 'flag-icons/flags/1x1/ca.svg'
import chn from 'flag-icons/flags/1x1/cn.svg'
import cub from 'flag-icons/flags/1x1/cu.svg'
import dom from 'flag-icons/flags/1x1/do.svg'
import fra from 'flag-icons/flags/1x1/fr.svg'
import gbr from 'flag-icons/flags/1x1/gb.svg'
import hkg from 'flag-icons/flags/1x1/hk.svg'
import ind from 'flag-icons/flags/1x1/in.svg'
import jpn from 'flag-icons/flags/1x1/jp.svg'
import kor from 'flag-icons/flags/1x1/kr.svg'
import mex from 'flag-icons/flags/1x1/mx.svg'
import ned from 'flag-icons/flags/1x1/nl.svg'
import pak from 'flag-icons/flags/1x1/pk.svg'
import phi from 'flag-icons/flags/1x1/ph.svg'
import pur from 'flag-icons/flags/1x1/pr.svg'
import usa from 'flag-icons/flags/1x1/us.svg'
import ven from 'flag-icons/flags/1x1/ve.svg'

const FLAGS: Readonly<Record<string, string>> = {
  AUS: aus, CAN: can, CHN: chn, CUB: cub, DOM: dom, FRA: fra, GBR: gbr, HKG: hkg, IND: ind,
  JPN: jpn, KOR: kor, MEX: mex, NED: ned, PAK: pak, PHI: phi, PUR: pur, USA: usa, VEN: ven,
}

export const flagOf = (ioc: string | null | undefined): string | undefined => (ioc ? FLAGS[ioc] : undefined)
