// Whether the reader has asked the browser to save data (Chrome's Data Saver, Android's Lite
// mode). The site's speculative downloads ask this before going out: they are chunks a reader may
// never open, fetched on a timer rather than on any intent. Prefetches made on hover, focus or a
// tap are intent and do not ask. False wherever the browser does not say (Safari, Firefox).
export function saveDataOn(): boolean {
  return (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true
}
