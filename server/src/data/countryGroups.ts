// Categorical country groupings for the Gauntlet prompt engine.
//
// SERVER-ONLY (anti-cheat): like countryAttributes, these feed the prompt
// engine and must never reach the client — they ARE the answer keys.
//
// Each group is a set of lowercase ISO alpha-2 codes (scoped to the game's
// country list). A prompt built from a group is only offered for a set when at
// least MIN_VALID of its members fall inside that set (see buildPromptPool),
// so e.g. "Spanish-speaking" surfaces in the Americas, "Arabic-speaking" in the
// Middle East, etc.
//
// Seeded by research and hand-verified (2025 membership). Hand-edit freely.

/** Official or clearly predominant national language. */
export const spanishSpeaking = [
  "ar", "bo", "cl", "co", "cr", "cu", "do", "ec", "es", "gq",
  "gt", "hn", "mx", "ni", "pa", "pe", "py", "sv", "uy", "ve",
];
export const frenchSpeaking = [
  "be", "bf", "bi", "bj", "ca", "cd", "cf", "cg", "ch", "ci",
  "cm", "dj", "fr", "ga", "gn", "gq", "ht", "km", "lu", "mc",
  "mg", "ml", "ne", "rw", "sc", "sn", "td", "tg", "vu",
];
export const arabicSpeaking = [
  "ae", "bh", "dj", "dz", "eg", "er", "iq", "jo", "km", "kw",
  "lb", "ly", "ma", "mr", "om", "ps", "qa", "sa", "sd", "so",
  "sy", "td", "tn", "ye",
];
export const portugueseSpeaking = ["ao", "br", "cv", "gq", "gw", "mz", "pt", "st", "tl"];

/** International organisation membership (2025). */
export const euMembers = [
  "at", "be", "bg", "cy", "cz", "de", "dk", "ee", "es", "fi",
  "fr", "gr", "hr", "hu", "ie", "it", "lt", "lu", "lv", "mt",
  "nl", "pl", "pt", "ro", "se", "si", "sk",
];
/** Uses the euro (eurozone + non-EU euro users like Monaco, San Marino, …). */
export const eurozone = [
  "ad", "at", "be", "cy", "de", "ee", "es", "fi", "fr", "gr",
  "hr", "ie", "it", "lt", "lu", "lv", "mc", "me", "mt", "nl",
  "pt", "si", "sk", "sm", "va", "xk",
];
export const opecMembers = ["ae", "cg", "dz", "ga", "gq", "ir", "iq", "kw", "ly", "ng", "sa", "ve"];
export const commonwealthMembers = [
  "ag", "au", "bb", "bd", "bn", "bs", "bw", "bz", "ca", "cm",
  "cy", "dm", "fj", "ga", "gb", "gd", "gh", "gm", "gy", "in",
  "jm", "ke", "ki", "kn", "lc", "lk", "ls", "mt", "mu", "mv",
  "mw", "my", "mz", "na", "ng", "nr", "nz", "pg", "pk", "rw",
  "sb", "sc", "sg", "sl", "sz", "tg", "to", "tt", "tv", "tz",
  "ug", "vc", "vu", "ws", "za", "zm",
];
export const aseanMembers = ["bn", "id", "kh", "la", "mm", "my", "ph", "sg", "th", "vn"];

/** Geography. */
export const equatorCrossers = ["br", "cd", "cg", "co", "ec", "ga", "id", "ke", "ki", "so", "st", "ug"];
export const southernHemisphere = [
  "ao", "ar", "au", "bi", "bo", "bw", "cl", "fj", "km", "ls",
  "mg", "mu", "mw", "mz", "na", "nr", "nz", "pe", "pg", "py",
  "rw", "sb", "sc", "sz", "tl", "to", "tv", "tz", "uy", "vu",
  "ws", "za", "zm", "zw",
];
export const mediterraneanCoast = [
  "al", "ba", "cy", "dz", "eg", "es", "fr", "gr", "hr", "il",
  "it", "lb", "ly", "ma", "mc", "me", "mt", "ps", "si", "sy",
  "tn", "tr",
];

/** Traffic drives on the left. */
export const drivesLeft = [
  "ag", "au", "bb", "bd", "bn", "bs", "bt", "bw", "cy", "dm",
  "fj", "gb", "gd", "gy", "id", "ie", "in", "jm", "jp", "ke",
  "lc", "lk", "ls", "mt", "mu", "mv", "mw", "my", "mz", "na",
  "np", "nz", "pg", "pk", "sb", "sc", "sg", "sr", "sz", "th",
  "tl", "to", "tt", "tz", "ug", "vc", "ws", "za", "zm", "zw",
];

/** Head of state is a monarch (sovereign monarchies + Commonwealth realms + the papacy). */
export const monarchies = [
  "ad", "ae", "ag", "au", "be", "bh", "bn", "bs", "bt", "bz",
  "ca", "dk", "es", "gb", "gd", "jm", "jo", "jp", "kh", "kn",
  "kw", "lc", "li", "ls", "lu", "mc", "ma", "my", "nl", "no",
  "nz", "om", "pg", "qa", "sa", "sb", "se", "sz", "th", "to",
  "tv", "va", "vc",
];
