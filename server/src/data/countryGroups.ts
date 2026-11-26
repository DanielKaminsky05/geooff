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

// --- Organisations / status (verified 2026) ---

/** NATO member states — all 32, incl. Finland (2023) and Sweden (2024). */
export const natoMembers = [
  "al", "be", "bg", "ca", "hr", "cz", "dk", "ee", "fi", "fr",
  "de", "gr", "hu", "is", "it", "lv", "lt", "lu", "me", "nl",
  "mk", "no", "pl", "pt", "ro", "sk", "si", "es", "se", "tr",
  "gb", "us",
];

/** G20 — the 19 sovereign-country members (the EU and AU blocs are excluded). */
export const g20Members = [
  "ar", "au", "br", "ca", "cn", "fr", "de", "in", "id", "it",
  "jp", "kr", "mx", "ru", "sa", "za", "tr", "gb", "us",
];

/** States that possess nuclear weapons (the nine; Israel never officially confirms). */
export const nuclearArmed = ["us", "ru", "cn", "fr", "gb", "in", "pk", "kp", "il"];

/** Countries using the US dollar as official or primary currency. */
export const usdUsers = ["us", "ec", "sv", "pa", "tl", "mh", "fm", "pw", "zw", "lr"];

// --- Religion ---

/** Countries where Islam is the majority religion (>50%, strict). */
export const majorityMuslim = [
  "af", "al", "dz", "az", "bh", "bd", "bn", "bf", "td", "km",
  "dj", "eg", "gm", "gn", "iq", "ir", "jo", "kz", "xk", "kw",
  "kg", "lb", "ly", "my", "mv", "ml", "mr", "ma", "ne", "om",
  "pk", "ps", "qa", "sa", "sn", "sl", "so", "sd", "sy", "tj",
  "tr", "tm", "tn", "ae", "uz", "ye",
];

// --- Ocean coastlines (marginal seas counted; see research notes) ---

/** Countries with an Atlantic Ocean coastline (incl. North/Baltic/Caribbean seas, Gulf of Mexico). */
export const atlanticCoast = [
  "pt", "es", "fr", "gb", "ie", "is", "no", "se", "fi", "dk",
  "de", "nl", "be", "ee", "lv", "lt", "pl", "ma", "mr", "sn",
  "gm", "gw", "gn", "sl", "lr", "ci", "gh", "tg", "bj", "ng",
  "cm", "gq", "ga", "cg", "cd", "ao", "na", "za", "cv", "st",
  "ca", "us", "mx", "bz", "gt", "hn", "ni", "cr", "pa", "co",
  "ve", "gy", "sr", "br", "uy", "ar", "bs", "cu", "jm", "ht",
  "do", "kn", "ag", "dm", "lc", "vc", "bb", "gd", "tt",
];

/** Countries with a Pacific Ocean coastline (incl. its marginal seas + Pacific island states). */
export const pacificCoast = [
  "ru", "cn", "kp", "kr", "jp", "tw", "ph", "vn", "kh", "th",
  "my", "sg", "bn", "id", "au", "nz", "pg", "sb", "fj", "vu",
  "ki", "nr", "tv", "to", "ws", "fm", "mh", "pw", "ca", "us",
  "mx", "gt", "sv", "hn", "ni", "cr", "pa", "co", "ec", "pe",
  "cl",
];

/** Countries with an Indian Ocean coastline (open ocean + Arabian Sea/Bay of Bengal/Red Sea). */
export const indianOceanCoast = [
  "za", "mz", "tz", "ke", "so", "dj", "er", "sd", "eg", "sa",
  "ye", "om", "ae", "qa", "bh", "kw", "iq", "ir", "pk", "in",
  "lk", "mv", "bd", "mm", "th", "my", "id", "sg", "au", "tl",
  "mg", "mu", "sc", "km",
];

// --- Colonial history (commonly-accepted sets of modern sovereign states) ---

/** Former British colonies / protectorates / mandates. */
export const formerBritishColony = [
  "us", "ca", "au", "nz", "in", "pk", "bd", "lk", "mm", "my",
  "sg", "bn", "ng", "gh", "sl", "gm", "ke", "ug", "tz", "zm",
  "zw", "mw", "bw", "ls", "sz", "za", "sd", "ss", "eg", "iq",
  "jo", "il", "ps", "kw", "bh", "qa", "ae", "om", "ye", "cy",
  "mt", "jm", "bs", "bb", "tt", "gy", "bz", "ag", "dm", "gd",
  "kn", "lc", "vc", "fj", "sb", "tv", "ki", "to", "ws", "mv",
  "mu", "sc",
];

/** Former French colonies / protectorates / mandates. */
export const formerFrenchColony = [
  "dz", "tn", "ma", "mr", "sn", "ml", "ne", "td", "bf", "bj",
  "ci", "gn", "tg", "ga", "cg", "cf", "cm", "dj", "km", "mg",
  "sc", "vn", "la", "kh", "lb", "sy", "ht", "mu", "vu",
];

// --- National flag features (source-verified 2026) ---
// A flag feature is either clearly present or not; these are strict sets —
// composite coats-of-arms count as "has an animal/sun" only when the official
// national flag bears them (noted during verification).

/** Flag bears a crescent. */
export const flagHasCrescent = ["tr", "pk", "dz", "tn", "my", "sg", "mr", "az", "mv", "ly", "km", "uz", "tm"];

/** Flag bears at least one star. */
export const flagHasStar = [
  "us", "cn", "vn", "tr", "pk", "my", "sg", "cu", "cl", "gh",
  "so", "br", "au", "nz", "ve", "ma", "kp", "dj", "cv", "mh",
  "az", "tn", "dz", "mr", "pg", "ws", "hn", "mm", "cm", "lr",
  "st", "gw", "bf", "cf", "tg", "ao", "mz", "sb", "fm", "tj", "ba",
];

/** Three equal horizontal bands (plain — no dominating emblem). */
export const flagThreeHorizontalStripes = ["nl", "ru", "de", "hu", "bg", "lt", "ee", "lu", "ye", "am", "sl", "ga", "at"];

/** Three equal vertical bands (plain — no dominating emblem). */
export const flagThreeVerticalStripes = ["fr", "it", "ie", "be", "ro", "td", "ml", "gn", "ci", "ng", "pe"];

/** Flag bears a sun (disc or rayed). */
export const flagHasSun = ["ar", "uy", "jp", "bd", "ne", "kg", "mk", "np", "rw", "kz", "ag", "ph", "tw", "mw", "ki"];

/** Flag depicts an animal (incl. birds, dragons, heraldic beasts). */
export const flagHasAnimal = [
  "lk", "me", "al", "eg", "mx", "zm", "ec", "bo", "ug", "pg",
  "bt", "gt", "dm", "zw", "rs", "md", "fj", "es", "ad", "kz",
];

// --- "An animal lives here" (wildlife range) ---
// Each set is the countries (in the game's list) that hold an ESTABLISHED,
// RESIDENT, EXTANT WILD population of the animal — the answer key for
// "Name a country where <animal> live in the wild". Seeded from IUCN Red List
// range data and species specialist-group assessments (verified 2026), then
// hand-trimmed to established populations: regionally-extinct, vagrant-only and
// captive/feral-only ranges are excluded (e.g. no Colombia for hippos). Reintroduced
// but now self-sustaining free-ranging populations ARE counted. Deliberately
// inclusive on commonly-named range states (a missing country penalises a player),
// conservative on dead/disputed ones. Hand-edit freely.

/** Lions (African lion + Asiatic lion in India's Gir Forest). */
export const lionRange = [
  "ao", "bj", "bw", "cd", "cm", "et", "in", "ke", "mz", "na",
  "sd", "sn", "ss", "tz", "ug", "za", "zm", "zw",
];
/** Tigers (resident wild populations; excludes functionally-extinct range states). */
export const tigerRange = ["bd", "bt", "cn", "id", "in", "mm", "my", "np", "ru", "th"];
/** Elephants (African savanna + forest elephants and the Asian elephant). */
export const elephantRange = [
  "ao", "bd", "bf", "bj", "bt", "bw", "cd", "cf", "cg", "ci",
  "cm", "cn", "er", "et", "ga", "gh", "gn", "gq", "id", "in",
  "ke", "kh", "la", "lk", "lr", "ml", "mm", "mw", "mz", "na",
  "ne", "ng", "np", "rw", "ss", "td", "tg", "th", "ug", "vn",
  "za", "zm", "zw",
];
/** Giraffes (incl. now-established reintroductions, e.g. Rwanda/Malawi/Eswatini). */
export const giraffeRange = [
  "ao", "bw", "cd", "cf", "cm", "et", "ke", "mw", "mz", "na",
  "ne", "rw", "ss", "sz", "td", "tz", "ug", "za", "zm", "zw",
];
/** Gorillas (western + eastern gorillas, central/west Africa). */
export const gorillaRange = ["ao", "cd", "cf", "cg", "cm", "ga", "gq", "ng", "rw", "ug"];
/** Common hippopotamus (sub-Saharan Africa; Colombia's feral herd excluded). */
export const hippoRange = [
  "ao", "bf", "bi", "bj", "bw", "cd", "cf", "cg", "ci", "cm",
  "et", "ga", "gh", "gm", "gn", "gq", "gw", "ke", "lr", "ml",
  "mw", "mz", "na", "ne", "ng", "rw", "sd", "sl", "sn", "so",
  "ss", "sz", "td", "tg", "tz", "ug", "za", "zm", "zw",
];
/** Rhinoceroses (African white/black + Asian one-horned, Javan, Sumatran). */
export const rhinoRange = [
  "bw", "id", "in", "ke", "mw", "na", "np", "sz", "tz", "ug",
  "za", "zm", "zw",
];
/** Cheetahs (southern/eastern Africa, the Sahel, and the Asiatic cheetah in Iran). */
export const cheetahRange = [
  "ao", "bf", "bj", "bw", "dz", "et", "ir", "ke", "ml", "mz",
  "na", "ne", "ss", "tz", "ug", "za", "zm", "zw",
];
/** Zebras (plains, mountain and Grevy's zebra). */
export const zebraRange = [
  "ao", "bw", "et", "ke", "mw", "mz", "na", "rw", "ss", "sz",
  "tz", "ug", "za", "zm", "zw",
];
/** Chimpanzees (west/central/east Africa). */
export const chimpanzeeRange = [
  "ao", "bi", "cd", "cf", "cg", "ci", "cm", "ga", "gn", "gq",
  "gw", "lr", "ml", "ng", "rw", "sl", "sn", "ss", "tz", "ug",
];
/** Jaguars (the Americas; USA excluded — transient males only, no breeding population). */
export const jaguarRange = [
  "ar", "bo", "br", "bz", "co", "cr", "ec", "gt", "gy", "hn",
  "mx", "ni", "pa", "pe", "py", "sr", "ve",
];
/** Brown bears (grizzly in North America; brown bears across Europe and Asia). */
export const brownBearRange = [
  "af", "al", "am", "az", "ba", "bg", "by", "ca", "cn", "ee",
  "es", "fi", "fr", "ge", "gr", "hr", "in", "ir", "iq", "it",
  "jp", "kg", "kz", "lv", "me", "mk", "mn", "no", "np", "pk",
  "pl", "ro", "rs", "ru", "se", "si", "sk", "tj", "tr", "ua",
  "us", "uz",
];
/** Gray wolves (North America, Europe, the Middle East and Asia; recolonisers included). */
export const wolfRange = [
  "af", "al", "am", "at", "az", "ba", "be", "bg", "bt", "by",
  "ca", "cn", "cz", "de", "dk", "ee", "es", "fi", "fr", "ge",
  "gr", "hr", "hu", "in", "iq", "ir", "it", "jo", "kg", "kz",
  "lt", "lv", "md", "me", "mk", "mn", "mx", "nl", "no", "om",
  "pk", "pl", "pt", "ro", "rs", "ru", "sa", "se", "si", "sk",
  "sy", "tj", "tm", "tr", "ua", "us", "uz", "ye",
];
/** Snow leopards (the 12 high-mountain range states of Central/South Asia). */
export const snowLeopardRange = ["af", "bt", "cn", "in", "kg", "kz", "mn", "np", "pk", "ru", "tj", "uz"];
/** Pumas (cougar / mountain lion — Canada down to Patagonia). */
export const pumaRange = [
  "ar", "bo", "br", "bz", "ca", "cl", "co", "cr", "ec", "gt",
  "gy", "hn", "mx", "ni", "pa", "pe", "py", "sr", "us", "uy",
  "ve",
];
/** Capybaras (South America + far-southern Central America). */
export const capybaraRange = [
  "ar", "bo", "br", "co", "ec", "gy", "pa", "pe", "py", "sr",
  "uy", "ve",
];
/** Armadillos (southern USA through the Americas to central Argentina/Chile). */
export const armadilloRange = [
  "ar", "bo", "br", "bz", "cl", "co", "cr", "ec", "gt", "gy",
  "hn", "mx", "ni", "pa", "pe", "py", "sr", "sv", "tt", "us",
  "uy", "ve",
];
/** Sloths (southern Central America + northern/central South America). */
export const slothRange = ["bo", "br", "co", "cr", "ec", "gy", "hn", "ni", "pa", "pe", "sr", "ve"];
/** Peafowl (native Indian + green peafowl; feral/introduced birds excluded). */
export const peafowlRange = ["bt", "cn", "id", "in", "kh", "lk", "mm", "np", "pk", "th", "vn"];
/** Gibbons (south, southeast and east Asia). */
export const gibbonRange = ["bd", "bn", "cn", "id", "in", "kh", "la", "mm", "my", "th", "vn"];
/** Lynx (Eurasian lynx across Eurasia, Iberian lynx, and Canada lynx). */
export const lynxRange = [
  "af", "al", "at", "ba", "bg", "by", "ca", "ch", "cn", "cz",
  "de", "es", "fi", "fr", "ge", "hr", "hu", "in", "ir", "iq",
  "kg", "kz", "lt", "lv", "mn", "np", "pl", "pt", "ro", "ru",
  "se", "si", "sk", "tj", "tr", "ua", "us", "uz",
];
/** Moose (North America + northern/eastern Europe + northern Asia; "elk" in Europe). */
export const mooseRange = [
  "by", "ca", "cn", "cz", "ee", "fi", "kz", "lt", "lv", "mn",
  "no", "pl", "ru", "se", "ua", "us",
];
/** Bison (American bison + free-ranging European bison / wisent). */
export const bisonRange = ["by", "ca", "de", "lt", "mx", "pl", "ro", "ru", "sk", "ua", "us"];
/** Reindeer / caribou (Arctic & subarctic; free-ranging herds counted). */
export const reindeerRange = ["ca", "fi", "is", "mn", "no", "ru", "se", "us"];
/** Penguins (mainland/national-territory breeders; Antarctica & overseas isles excluded). */
export const penguinRange = ["ar", "au", "cl", "ec", "na", "nz", "pe", "za"];
