/**
 * US states list for the "us-states" category.
 *
 * `id` = the two-letter USPS postal abbreviation, LOWERCASE. This MUST match
 * the frontend SVG map location ids (@svg-maps/usa) exactly.
 *
 * Covers the 50 states only — NO District of Columbia, NO territories.
 * Aliases cover the postal code, common newspaper/style abbreviations
 * ('calif.', 'mass.', 'penn.') and disambiguating forms ('washington state').
 * Matching is diacritic/punctuation/case insensitive (see normalizeAnswer),
 * so e.g. 'calif.' and 'calif' both resolve.
 */

import type { AnswerItem } from "../matching.js";

export const usStates: AnswerItem[] = [
  { id: "al", name: "Alabama", aliases: ["al", "ala"] },
  { id: "ak", name: "Alaska", aliases: ["ak", "alas"] },
  { id: "az", name: "Arizona", aliases: ["az", "ariz"] },
  { id: "ar", name: "Arkansas", aliases: ["ar", "ark"] },
  { id: "ca", name: "California", aliases: ["ca", "calif", "cal"] },
  { id: "co", name: "Colorado", aliases: ["co", "colo", "col"] },
  { id: "ct", name: "Connecticut", aliases: ["ct", "conn"] },
  { id: "de", name: "Delaware", aliases: ["de", "del"] },
  { id: "fl", name: "Florida", aliases: ["fl", "fla"] },
  { id: "ga", name: "Georgia", aliases: ["ga"] },
  { id: "hi", name: "Hawaii", aliases: ["hi"] },
  { id: "id", name: "Idaho", aliases: ["id"] },
  { id: "il", name: "Illinois", aliases: ["il", "ill"] },
  { id: "in", name: "Indiana", aliases: ["in", "ind"] },
  { id: "ia", name: "Iowa", aliases: ["ia"] },
  { id: "ks", name: "Kansas", aliases: ["ks", "kan", "kans"] },
  { id: "ky", name: "Kentucky", aliases: ["ky", "ken", "kent"] },
  { id: "la", name: "Louisiana", aliases: ["la"] },
  { id: "me", name: "Maine", aliases: ["me"] },
  { id: "md", name: "Maryland", aliases: ["md"] },
  { id: "ma", name: "Massachusetts", aliases: ["ma", "mass"] },
  { id: "mi", name: "Michigan", aliases: ["mi", "mich"] },
  { id: "mn", name: "Minnesota", aliases: ["mn", "minn"] },
  { id: "ms", name: "Mississippi", aliases: ["ms", "miss"] },
  { id: "mo", name: "Missouri", aliases: ["mo"] },
  { id: "mt", name: "Montana", aliases: ["mt", "mont"] },
  { id: "ne", name: "Nebraska", aliases: ["ne", "neb", "nebr"] },
  { id: "nv", name: "Nevada", aliases: ["nv", "nev"] },
  { id: "nh", name: "New Hampshire", aliases: ["nh"] },
  { id: "nj", name: "New Jersey", aliases: ["nj"] },
  { id: "nm", name: "New Mexico", aliases: ["nm", "nmex"] },
  { id: "ny", name: "New York", aliases: ["ny", "ny state", "new york state"] },
  { id: "nc", name: "North Carolina", aliases: ["nc", "ncar"] },
  { id: "nd", name: "North Dakota", aliases: ["nd", "ndak"] },
  { id: "oh", name: "Ohio", aliases: ["oh"] },
  { id: "ok", name: "Oklahoma", aliases: ["ok", "okla"] },
  { id: "or", name: "Oregon", aliases: ["or", "ore", "oreg"] },
  { id: "pa", name: "Pennsylvania", aliases: ["pa", "penn", "penna"] },
  { id: "ri", name: "Rhode Island", aliases: ["ri"] },
  { id: "sc", name: "South Carolina", aliases: ["sc", "scar"] },
  { id: "sd", name: "South Dakota", aliases: ["sd", "sdak"] },
  { id: "tn", name: "Tennessee", aliases: ["tn", "tenn"] },
  { id: "tx", name: "Texas", aliases: ["tx", "tex"] },
  { id: "ut", name: "Utah", aliases: ["ut"] },
  { id: "vt", name: "Vermont", aliases: ["vt"] },
  { id: "va", name: "Virginia", aliases: ["va"] },
  { id: "wa", name: "Washington", aliases: ["wa", "wash", "washington state"] },
  { id: "wv", name: "West Virginia", aliases: ["wv", "wva", "wvirginia"] },
  { id: "wi", name: "Wisconsin", aliases: ["wi", "wis", "wisc"] },
  { id: "wy", name: "Wyoming", aliases: ["wy", "wyo"] },
];
