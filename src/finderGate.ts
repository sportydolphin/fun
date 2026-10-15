// Could this text be a stat question at all? The shell asks before it loads the parser.
//
// The parser (src/league/finderParse.ts) and the club lists it is handed are kept out of the
// entry chunk, which every page load pays for and most readers never search from. So the shell
// imports only this, and loads the rest on the first focus of the search. Every question the
// parser can read has a count in it, written as digits or as a word, so text with neither is
// answered "no" without the parser: a name search never touches it.
//
// IMPORTS NOTHING, which is the point of it being its own file. The list of words must stay a
// superset of the parser's NUMBER_WORDS plus "without"; finderParse.test.ts holds it to that.

const COUNT_WORDS = /(?<![a-z])(zero|no|none|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|without|multi|double|triple)(?![a-z])/i

export function mightBeFinderQuestion(text: string): boolean {
  return /\d/.test(text) || COUNT_WORDS.test(text)
}
