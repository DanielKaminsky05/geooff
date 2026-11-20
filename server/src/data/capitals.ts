// Capital cities per country, for the Gauntlet prompt engine.
//
// SERVER-ONLY (anti-cheat): like countryAttributes/countryGroups, this feeds the
// prompt engine (e.g. "name a country whose capital starts with B") and is an
// answer key — it must never be shipped to the client.
//
// Keyed by ISO 3166-1 alpha-2, lowercase. Covers the 193 UN members plus
// Vatican City (va), Palestine (ps), Kosovo (xk), Taiwan (tw). Where a country
// has multiple capitals, the primary/administrative one is used (notes inline).
//
// Verified 2026. Hand-edit freely to correct values.

export const capitals: Record<string, string> = {
  af: "Kabul",
  al: "Tirana",
  dz: "Algiers",
  ad: "Andorra la Vella",
  ao: "Luanda",
  ag: "Saint John's",
  ar: "Buenos Aires",
  am: "Yerevan",
  au: "Canberra", // not the largest city (Sydney)
  at: "Vienna",
  az: "Baku",
  bs: "Nassau",
  bh: "Manama",
  bd: "Dhaka",
  bb: "Bridgetown",
  by: "Minsk",
  be: "Brussels",
  bz: "Belmopan", // not the largest city (Belize City)
  bj: "Porto-Novo", // official capital; Cotonou is the seat of government
  bt: "Thimphu",
  bo: "Sucre", // constitutional capital; La Paz is the seat of government
  ba: "Sarajevo",
  bw: "Gaborone",
  br: "Brasilia", // not the largest city (Sao Paulo)
  bn: "Bandar Seri Begawan",
  bg: "Sofia",
  bf: "Ouagadougou",
  bi: "Gitega", // political capital since 2019; Bujumbura is the largest city
  cv: "Praia",
  kh: "Phnom Penh",
  cm: "Yaounde", // not the largest city (Douala)
  ca: "Ottawa", // not the largest city (Toronto)
  cf: "Bangui",
  td: "N'Djamena",
  cl: "Santiago",
  cn: "Beijing", // not the largest city (Shanghai)
  co: "Bogota",
  km: "Moroni",
  cg: "Brazzaville", // Republic of the Congo
  cd: "Kinshasa", // DR Congo
  cr: "San Jose",
  ci: "Yamoussoukro", // official capital; Abidjan is the largest city
  hr: "Zagreb",
  cu: "Havana",
  cy: "Nicosia",
  cz: "Prague",
  dk: "Copenhagen",
  dj: "Djibouti",
  dm: "Roseau",
  do: "Santo Domingo",
  ec: "Quito", // not the largest city (Guayaquil)
  eg: "Cairo",
  sv: "San Salvador",
  gq: "Malabo",
  er: "Asmara",
  ee: "Tallinn",
  sz: "Mbabane", // administrative capital; Lobamba is royal/legislative
  et: "Addis Ababa",
  fj: "Suva",
  fi: "Helsinki",
  fr: "Paris",
  ga: "Libreville",
  gm: "Banjul",
  ge: "Tbilisi",
  de: "Berlin",
  gh: "Accra",
  gr: "Athens",
  gd: "Saint George's",
  gt: "Guatemala City",
  gn: "Conakry",
  gw: "Bissau",
  gy: "Georgetown",
  ht: "Port-au-Prince",
  hn: "Tegucigalpa",
  hu: "Budapest",
  is: "Reykjavik",
  in: "New Delhi", // not the largest city (Mumbai)
  id: "Jakarta", // Nusantara is the planned future capital; Jakarta de facto in 2026
  ir: "Tehran",
  iq: "Baghdad",
  ie: "Dublin",
  il: "Jerusalem", // internationally disputed; many embassies are in Tel Aviv
  it: "Rome",
  jm: "Kingston",
  jp: "Tokyo",
  jo: "Amman",
  kz: "Astana", // reverted from Nur-Sultan in 2022
  ke: "Nairobi",
  ki: "Tarawa", // South Tarawa
  kp: "Pyongyang", // North Korea
  kr: "Seoul", // South Korea
  kw: "Kuwait City",
  kg: "Bishkek",
  la: "Vientiane",
  lv: "Riga",
  lb: "Beirut",
  ls: "Maseru",
  lr: "Monrovia",
  ly: "Tripoli",
  li: "Vaduz",
  lt: "Vilnius",
  lu: "Luxembourg",
  mg: "Antananarivo",
  mw: "Lilongwe",
  my: "Kuala Lumpur", // Putrajaya is the administrative capital; KL remains official
  mv: "Male",
  ml: "Bamako",
  mt: "Valletta",
  mh: "Majuro",
  mr: "Nouakchott",
  mu: "Port Louis",
  mx: "Mexico City",
  fm: "Palikir", // not the largest city (Weno)
  md: "Chisinau",
  mc: "Monaco", // city-state
  mn: "Ulaanbaatar",
  me: "Podgorica",
  ma: "Rabat", // not the largest city (Casablanca)
  mz: "Maputo",
  mm: "Naypyidaw", // not the largest city (Yangon)
  na: "Windhoek",
  nr: "Yaren", // de facto; Nauru has no official capital
  np: "Kathmandu",
  nl: "Amsterdam", // constitutional capital; The Hague is the seat of government
  nz: "Wellington", // not the largest city (Auckland)
  ni: "Managua",
  ne: "Niamey",
  ng: "Abuja", // not the largest city (Lagos)
  mk: "Skopje", // North Macedonia
  no: "Oslo",
  om: "Muscat",
  pk: "Islamabad", // not the largest city (Karachi)
  pw: "Ngerulmud", // not the largest city (Koror)
  pa: "Panama City",
  pg: "Port Moresby",
  py: "Asuncion",
  pe: "Lima",
  ph: "Manila",
  pl: "Warsaw",
  pt: "Lisbon",
  qa: "Doha",
  ro: "Bucharest",
  ru: "Moscow",
  rw: "Kigali",
  kn: "Basseterre", // Saint Kitts and Nevis
  lc: "Castries", // Saint Lucia
  vc: "Kingstown", // Saint Vincent and the Grenadines
  ws: "Apia",
  sm: "San Marino",
  st: "Sao Tome",
  sa: "Riyadh",
  sn: "Dakar",
  rs: "Belgrade",
  sc: "Victoria",
  sl: "Freetown",
  sg: "Singapore", // city-state
  sk: "Bratislava",
  si: "Ljubljana",
  sb: "Honiara",
  so: "Mogadishu",
  za: "Pretoria", // executive capital; also Cape Town (legislative), Bloemfontein (judicial)
  ss: "Juba", // South Sudan
  es: "Madrid",
  lk: "Sri Jayawardenepura Kotte", // official admin capital; Colombo is the largest city
  sd: "Khartoum",
  sr: "Paramaribo",
  se: "Stockholm",
  ch: "Bern", // not the largest city (Zurich)
  sy: "Damascus",
  tj: "Dushanbe",
  tz: "Dodoma", // official capital since 1996; Dar es Salaam is the largest city
  th: "Bangkok",
  tl: "Dili", // Timor-Leste
  tg: "Lome",
  to: "Nuku'alofa",
  tt: "Port of Spain",
  tn: "Tunis",
  tr: "Ankara", // not the largest city (Istanbul)
  tm: "Ashgabat",
  tv: "Funafuti",
  ug: "Kampala",
  ua: "Kyiv",
  ae: "Abu Dhabi", // not the largest city (Dubai)
  gb: "London",
  us: "Washington", // Washington, D.C.; not the largest city (New York)
  uy: "Montevideo",
  uz: "Tashkent",
  vu: "Port Vila",
  ve: "Caracas",
  vn: "Hanoi", // not the largest city (Ho Chi Minh City)
  ye: "Sanaa", // de jure; the government relocated to Aden amid the civil war
  zm: "Lusaka",
  zw: "Harare",
  // --- Non-UN-member entities ---
  va: "Vatican City", // city-state
  ps: "Ramallah", // de facto administrative seat; East Jerusalem is claimed but not controlled
  xk: "Pristina", // Kosovo
  tw: "Taipei", // Taiwan
};

/**
 * Countries whose capital is NOT their largest / most famous city — an
 * editorial list (each has a clearly bigger rival city). Used for the
 * "name a country whose capital isn't its largest city" prompt.
 */
export const capitalNotLargest = [
  "us", "au", "br", "tr", "ca", "ch", "ng", "kz", "mm", "za",
  "in", "cn", "nz", "ma", "vn", "ci", "tz", "pk", "ae", "cm",
  "ec", "bj", "bz", "lk", "bi", "fm", "pw",
];

