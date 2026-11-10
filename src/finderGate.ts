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
// A few questions have no count in them at all, and the parser reads each as its own conditions:
// "immaculate inning", "bases-loaded walks", "grand slams", "walk-offs", "full count", "hits with
// risp", "home runs in extra innings", "strikeouts in the first inning", "hits with runners on",
// "comebacks", "go-ahead innings", "biggest innings", "back-to-back home runs", "consecutive
// strikeouts", "hr at bat" (the plate-appearance grain said bare, an event with no number), a club's
// named games ("shutouts", "no-hitters", "blowouts", "errorless games") and "steals of home". A word missing here hides the question from the search bar with no sign, so a
// countless phrase added to the parser adds its word here too.

const COUNT_WORDS = /(?<![a-z])(zero|no|none|an?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|without|multi|double|triple|immaculate|loaded|slams?|walk[\s-]?offs?|full|risp|scoring|empty|extras?|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|runners?|men|someone|somebody|comebacks?|behind|ahead|rall(?:y|ies)|lead|biggest|largest|back|b2b|straight|consecutive|successive|at[\s-]?bats?|plate\s+appearances?|shut[\s-]?outs?|blow[\s-]?outs?|errorless|stole\s+home|steals?\s+of\s+home|home\s+steals?)(?![a-z])/i

export function mightBeFinderQuestion(text: string): boolean {
  return /\d/.test(text) || COUNT_WORDS.test(text)
}
