/**
 * Daily Dive — destination + route content (owned by Track B).
 *
 * Each entry is one destination city plus its three authored routes
 * (short/medium/long polylines) that lead to it. `window.ts` (Track A) picks one
 * entry per day (seeded by date) and pairs it with the journey config.
 *
 * CONCEPT: a journey is a long cross-map TREK. You start at a far-away origin and
 * navigate through intermediate "wonder" waypoints (famous cities and landmarks)
 * to reach the destination — e.g. start in Japan, end in Turkey. The origin is
 * always clearly distant: even the SHORT road is a real cross-region journey
 * (~Paris→Moscow scale), never a local hop.
 *
 * The three tiers escalate the trek (rough great-circle targets, origin→dest):
 *   - short  : a real journey from a neighbouring region          (~2000-4000 km)
 *   - medium : a continental crossing                             (~4000-6000 km)
 *   - long   : an epic, usually trans-continental trek            (~6000-10000 km)
 * Enforced by the test: every origin is far (> 1200 km), the LONG origin is very
 * far (> 5000 km), and total route length strictly increases short < medium <
 * long.
 *
 * There are >= 22 hand-authored entries so destinations don't repeat within a
 * rolling 7-day window. Each route's LAST point deep-equals `destination.at`
 * exactly; the FIRST point is the far origin. Origins are varied across
 * destinations so journeys feel different each day. Coordinates are degrees; the
 * client projects lat/lon directly.
 */

import type { DailyDestination, DailyRoute } from "../protocol.js";

/** One destination and the three routes that lead to it. */
export interface DestinationEntry {
  destination: DailyDestination;
  /** Exactly three routes, one per JourneyId, each ending at `destination.at`. */
  routes: DailyRoute[];
}

export const destinations: DestinationEntry[] = [
  {
    // End: Istanbul. Treks arrive from across Asia.
    destination: { name: "Istanbul", at: { lat: 41.0, lon: 29.0 } },
    routes: [
      {
        // short: from the Persian Gulf, across Mesopotamia and the Levant.
        journeyId: "short",
        points: [
          { lat: 25.3, lon: 55.3 }, // Dubai
          { lat: 33.3, lon: 44.4 }, // Baghdad
          { lat: 33.5, lon: 36.3 }, // Damascus
          { lat: 39.9, lon: 32.9 }, // Ankara
          { lat: 41.0, lon: 29.0 },
        ],
      },
      {
        // medium: from the Ganges plain, across Persia and Anatolia.
        journeyId: "medium",
        points: [
          { lat: 22.6, lon: 88.4 }, // Kolkata
          { lat: 28.6, lon: 77.2 }, // Delhi
          { lat: 35.7, lon: 51.4 }, // Tehran
          { lat: 39.9, lon: 41.3 }, // Erzurum
          { lat: 39.9, lon: 32.9 }, // Ankara
          { lat: 41.0, lon: 29.0 },
        ],
      },
      {
        // long: from Japan, the whole Silk Road to the Bosphorus.
        journeyId: "long",
        points: [
          { lat: 35.7, lon: 139.7 }, // Tokyo
          { lat: 39.9, lon: 116.4 }, // Beijing
          { lat: 43.3, lon: 76.9 }, // Almaty
          { lat: 39.7, lon: 67.0 }, // Samarkand
          { lat: 35.7, lon: 51.4 }, // Tehran
          { lat: 41.0, lon: 29.0 },
        ],
      },
    ],
  },
  {
    // End: Cairo. Arrivals sweep down into the Nile delta.
    destination: { name: "Cairo", at: { lat: 30.0, lon: 31.2 } },
    routes: [
      {
        // short: from the Gulf, across Arabia and up the Red Sea.
        journeyId: "short",
        points: [
          { lat: 25.3, lon: 55.3 }, // Dubai
          { lat: 24.7, lon: 46.7 }, // Riyadh
          { lat: 21.4, lon: 39.8 }, // Mecca
          { lat: 29.5, lon: 35.0 }, // Aqaba
          { lat: 30.0, lon: 31.2 },
        ],
      },
      {
        // medium: from West Africa, across the Sahel and Sahara.
        journeyId: "medium",
        points: [
          { lat: 14.7, lon: -17.4 }, // Dakar
          { lat: 12.6, lon: -8.0 }, // Bamako
          { lat: 12.0, lon: 8.5 }, // Kano
          { lat: 15.6, lon: 32.5 }, // Khartoum
          { lat: 24.1, lon: 32.9 }, // Aswan
          { lat: 30.0, lon: 31.2 },
        ],
      },
      {
        // long: from southern Africa, the length of the continent.
        journeyId: "long",
        points: [
          { lat: -33.9, lon: 18.4 }, // Cape Town
          { lat: -17.9, lon: 25.9 }, // Victoria Falls
          { lat: -1.3, lon: 36.8 }, // Nairobi
          { lat: 15.6, lon: 32.5 }, // Khartoum
          { lat: 24.1, lon: 32.9 }, // Aswan
          { lat: 30.0, lon: 31.2 },
        ],
      },
    ],
  },
  {
    // End: Nairobi. Treks drop in from the north and across Africa.
    destination: { name: "Nairobi", at: { lat: -1.3, lon: 36.8 } },
    routes: [
      {
        // short: from Egypt, up the Nile corridor.
        journeyId: "short",
        points: [
          { lat: 30.0, lon: 31.2 }, // Cairo
          { lat: 15.6, lon: 32.5 }, // Khartoum
          { lat: 9.0, lon: 38.7 }, // Addis Ababa
          { lat: -1.3, lon: 36.8 },
        ],
      },
      {
        // medium: from West Africa, across the Sahel.
        journeyId: "medium",
        points: [
          { lat: 14.7, lon: -17.4 }, // Dakar
          { lat: 12.6, lon: -8.0 }, // Bamako
          { lat: 12.0, lon: 8.5 }, // Kano
          { lat: 4.4, lon: 18.6 }, // Bangui
          { lat: 0.3, lon: 32.6 }, // Kampala
          { lat: -1.3, lon: 36.8 },
        ],
      },
      {
        // long: from the Baltic, the length of Europe then all of Africa.
        journeyId: "long",
        points: [
          { lat: 59.3, lon: 18.1 }, // Stockholm
          { lat: 52.5, lon: 13.4 }, // Berlin
          { lat: 41.9, lon: 12.5 }, // Rome
          { lat: 30.0, lon: 31.2 }, // Cairo
          { lat: 9.0, lon: 38.7 }, // Addis Ababa
          { lat: -1.3, lon: 36.8 },
        ],
      },
    ],
  },
  {
    // End: Kyoto. Arrivals cross the Pacific rim and Eurasia.
    destination: { name: "Kyoto", at: { lat: 35.0, lon: 135.8 } },
    routes: [
      {
        // short: from South China, up the island chain.
        journeyId: "short",
        points: [
          { lat: 22.5, lon: 114.1 }, // Hong Kong
          { lat: 25.0, lon: 121.5 }, // Taipei
          { lat: 33.6, lon: 130.4 }, // Fukuoka
          { lat: 35.0, lon: 135.8 },
        ],
      },
      {
        // medium: from India, across China to Japan.
        journeyId: "medium",
        points: [
          { lat: 28.6, lon: 77.2 }, // Delhi
          { lat: 22.6, lon: 88.4 }, // Kolkata
          { lat: 22.5, lon: 114.1 }, // Hong Kong
          { lat: 31.2, lon: 121.5 }, // Shanghai
          { lat: 37.6, lon: 126.9 }, // Seoul
          { lat: 35.0, lon: 135.8 },
        ],
      },
      {
        // long: from western Europe, the full Trans-Eurasian crossing.
        journeyId: "long",
        points: [
          { lat: 48.9, lon: 2.4 }, // Paris
          { lat: 55.8, lon: 37.6 }, // Moscow
          { lat: 55.0, lon: 82.9 }, // Novosibirsk
          { lat: 39.9, lon: 116.4 }, // Beijing
          { lat: 37.6, lon: 126.9 }, // Seoul
          { lat: 35.0, lon: 135.8 },
        ],
      },
    ],
  },
  {
    // End: Reykjavik. Arrivals come up the Atlantic.
    destination: { name: "Reykjavik", at: { lat: 64.1, lon: -21.9 } },
    routes: [
      {
        // short: from Iberia, up the Atlantic seaboard.
        journeyId: "short",
        points: [
          { lat: 38.7, lon: -9.1 }, // Lisbon
          { lat: 53.3, lon: -6.3 }, // Dublin
          { lat: 62.0, lon: -6.8 }, // Torshavn
          { lat: 64.1, lon: -21.9 },
        ],
      },
      {
        // medium: from North Africa, across Europe and the North Sea.
        journeyId: "medium",
        points: [
          { lat: 30.0, lon: 31.2 }, // Cairo
          { lat: 37.9, lon: 23.7 }, // Athens
          { lat: 41.9, lon: 12.5 }, // Rome
          { lat: 48.9, lon: 2.4 }, // Paris
          { lat: 55.9, lon: -4.3 }, // Glasgow
          { lat: 64.1, lon: -21.9 },
        ],
      },
      {
        // long: from the US west coast, across the continent and North Atlantic.
        journeyId: "long",
        points: [
          { lat: 34.1, lon: -118.2 }, // Los Angeles
          { lat: 41.9, lon: -87.6 }, // Chicago
          { lat: 40.7, lon: -74.0 }, // New York
          { lat: 64.2, lon: -51.7 }, // Nuuk
          { lat: 64.1, lon: -21.9 },
        ],
      },
    ],
  },
  {
    // End: Cusco, high in the Andes.
    destination: { name: "Cusco", at: { lat: -13.5, lon: -72.0 } },
    routes: [
      {
        // short: from the Caribbean coast, down the Andes.
        journeyId: "short",
        points: [
          { lat: 10.5, lon: -66.9 }, // Caracas
          { lat: 4.7, lon: -74.1 }, // Bogota
          { lat: -0.2, lon: -78.5 }, // Quito
          { lat: -12.0, lon: -77.0 }, // Lima
          { lat: -13.5, lon: -72.0 },
        ],
      },
      {
        // medium: from Mexico, down through Central America and the Andes.
        journeyId: "medium",
        points: [
          { lat: 19.4, lon: -99.1 }, // Mexico City
          { lat: 9.0, lon: -79.5 }, // Panama City
          { lat: 4.7, lon: -74.1 }, // Bogota
          { lat: -12.0, lon: -77.0 }, // Lima
          { lat: -13.5, lon: -72.0 },
        ],
      },
      {
        // long: from the US west coast, the length of the Americas.
        journeyId: "long",
        points: [
          { lat: 34.1, lon: -118.2 }, // Los Angeles
          { lat: 19.4, lon: -99.1 }, // Mexico City
          { lat: 9.0, lon: -79.5 }, // Panama City
          { lat: 4.7, lon: -74.1 }, // Bogota
          { lat: -12.0, lon: -77.0 }, // Lima
          { lat: -13.5, lon: -72.0 },
        ],
      },
    ],
  },
  {
    // End: Marrakech.
    destination: { name: "Marrakech", at: { lat: 31.6, lon: -8.0 } },
    routes: [
      {
        // short: from Italy, across the western Mediterranean.
        journeyId: "short",
        points: [
          { lat: 41.9, lon: 12.5 }, // Rome
          { lat: 40.4, lon: -3.7 }, // Madrid
          { lat: 36.1, lon: -5.4 }, // Gibraltar strait
          { lat: 33.6, lon: -7.6 }, // Casablanca
          { lat: 31.6, lon: -8.0 },
        ],
      },
      {
        // medium: from Mesopotamia, the whole Maghreb coast.
        journeyId: "medium",
        points: [
          { lat: 33.3, lon: 44.4 }, // Baghdad
          { lat: 30.0, lon: 31.2 }, // Cairo
          { lat: 36.8, lon: 10.2 }, // Tunis
          { lat: 36.8, lon: 3.1 }, // Algiers
          { lat: 31.6, lon: -8.0 },
        ],
      },
      {
        // long: from Central Asia, across Persia and Europe into Africa.
        journeyId: "long",
        points: [
          { lat: 41.3, lon: 69.3 }, // Tashkent
          { lat: 35.7, lon: 51.4 }, // Tehran
          { lat: 41.0, lon: 29.0 }, // Istanbul
          { lat: 41.9, lon: 12.5 }, // Rome
          { lat: 40.4, lon: -3.7 }, // Madrid
          { lat: 31.6, lon: -8.0 },
        ],
      },
    ],
  },
  {
    // End: Samarkand, jewel of the Silk Road.
    destination: { name: "Samarkand", at: { lat: 39.7, lon: 67.0 } },
    routes: [
      {
        // short: from the Iranian plateau, across to Transoxiana.
        journeyId: "short",
        points: [
          { lat: 32.6, lon: 51.7 }, // Isfahan
          { lat: 35.7, lon: 51.4 }, // Tehran
          { lat: 36.3, lon: 59.6 }, // Mashhad
          { lat: 39.8, lon: 64.4 }, // Bukhara
          { lat: 39.7, lon: 67.0 },
        ],
      },
      {
        // medium: from Greece, across Anatolia and the Caucasus.
        journeyId: "medium",
        points: [
          { lat: 37.9, lon: 23.7 }, // Athens
          { lat: 41.0, lon: 29.0 }, // Istanbul
          { lat: 40.4, lon: 49.9 }, // Baku
          { lat: 37.9, lon: 58.4 }, // Ashgabat
          { lat: 39.7, lon: 67.0 },
        ],
      },
      {
        // long: from Japan, the Silk Road travelled east-to-west.
        journeyId: "long",
        points: [
          { lat: 35.7, lon: 139.7 }, // Tokyo
          { lat: 39.9, lon: 116.4 }, // Beijing
          { lat: 40.1, lon: 94.7 }, // Dunhuang
          { lat: 43.3, lon: 76.9 }, // Almaty
          { lat: 41.3, lon: 69.3 }, // Tashkent
          { lat: 39.7, lon: 67.0 },
        ],
      },
    ],
  },
  {
    // End: Cape Town, the far south.
    destination: { name: "Cape Town", at: { lat: -33.9, lon: 18.4 } },
    routes: [
      {
        // short: from the equator, down the west coast.
        journeyId: "short",
        points: [
          { lat: 0.4, lon: 9.5 }, // Libreville
          { lat: -8.8, lon: 13.2 }, // Luanda
          { lat: -22.6, lon: 17.1 }, // Windhoek
          { lat: -33.9, lon: 18.4 },
        ],
      },
      {
        // medium: from the Horn, across the southern cone.
        journeyId: "medium",
        points: [
          { lat: 9.0, lon: 38.7 }, // Addis Ababa
          { lat: -1.3, lon: 36.8 }, // Nairobi
          { lat: -17.9, lon: 25.9 }, // Victoria Falls
          { lat: -26.2, lon: 28.0 }, // Johannesburg
          { lat: -33.9, lon: 18.4 },
        ],
      },
      {
        // long: from Europe, the full length of Africa.
        journeyId: "long",
        points: [
          { lat: 41.9, lon: 12.5 }, // Rome
          { lat: 30.0, lon: 31.2 }, // Cairo
          { lat: -1.3, lon: 36.8 }, // Nairobi
          { lat: -17.9, lon: 25.9 }, // Victoria Falls
          { lat: -26.2, lon: 28.0 }, // Johannesburg
          { lat: -33.9, lon: 18.4 },
        ],
      },
    ],
  },
  {
    // End: Ushuaia, the end of the world.
    destination: { name: "Ushuaia", at: { lat: -54.8, lon: -68.3 } },
    routes: [
      {
        // short: from the River Plate, down the Atlantic coast of Patagonia.
        journeyId: "short",
        points: [
          { lat: -34.6, lon: -58.4 }, // Buenos Aires
          { lat: -38.0, lon: -57.5 }, // Mar del Plata
          { lat: -45.9, lon: -67.5 }, // Comodoro Rivadavia
          { lat: -54.8, lon: -68.3 },
        ],
      },
      {
        // medium: from the Andes, down the Pacific side.
        journeyId: "medium",
        points: [
          { lat: -12.0, lon: -77.0 }, // Lima
          { lat: -33.4, lon: -70.7 }, // Santiago
          { lat: -41.5, lon: -72.9 }, // Puerto Montt
          { lat: -51.6, lon: -69.2 }, // Rio Gallegos
          { lat: -54.8, lon: -68.3 },
        ],
      },
      {
        // long: from North America, the whole hemisphere.
        journeyId: "long",
        points: [
          { lat: 19.4, lon: -99.1 }, // Mexico City
          { lat: 4.7, lon: -74.1 }, // Bogota
          { lat: -16.5, lon: -68.1 }, // La Paz
          { lat: -34.6, lon: -58.4 }, // Buenos Aires
          { lat: -45.9, lon: -67.5 }, // Comodoro Rivadavia
          { lat: -54.8, lon: -68.3 },
        ],
      },
    ],
  },
  {
    // End: Lhasa, roof of the world.
    destination: { name: "Lhasa", at: { lat: 29.7, lon: 91.1 } },
    routes: [
      {
        // short: from southern India, over the Himalaya.
        journeyId: "short",
        points: [
          { lat: 13.1, lon: 80.3 }, // Chennai
          { lat: 22.6, lon: 88.4 }, // Kolkata
          { lat: 27.7, lon: 85.3 }, // Kathmandu
          { lat: 29.3, lon: 88.9 }, // Shigatse
          { lat: 29.7, lon: 91.1 },
        ],
      },
      {
        // medium: from Japan, across China onto the plateau.
        journeyId: "medium",
        points: [
          { lat: 35.7, lon: 139.7 }, // Tokyo
          { lat: 31.2, lon: 121.5 }, // Shanghai
          { lat: 30.7, lon: 104.1 }, // Chengdu
          { lat: 29.7, lon: 94.4 }, // Nyingchi
          { lat: 29.7, lon: 91.1 },
        ],
      },
      {
        // long: from Anatolia, across Persia, India and the Himalaya.
        journeyId: "long",
        points: [
          { lat: 41.0, lon: 29.0 }, // Istanbul
          { lat: 35.7, lon: 51.4 }, // Tehran
          { lat: 24.9, lon: 67.0 }, // Karachi
          { lat: 28.6, lon: 77.2 }, // Delhi
          { lat: 27.7, lon: 85.3 }, // Kathmandu
          { lat: 29.7, lon: 91.1 },
        ],
      },
    ],
  },
  {
    // End: Timbuktu, edge of the Sahara.
    destination: { name: "Timbuktu", at: { lat: 16.8, lon: -3.0 } },
    routes: [
      {
        // short: from the Gulf of Guinea, up through the Sahel.
        journeyId: "short",
        points: [
          { lat: 0.4, lon: 9.5 }, // Libreville
          { lat: 6.5, lon: 3.4 }, // Lagos
          { lat: 12.0, lon: 8.5 }, // Kano
          { lat: 16.3, lon: -0.0 }, // Gao
          { lat: 16.8, lon: -3.0 },
        ],
      },
      {
        // medium: from the Levant, across the Sahara.
        journeyId: "medium",
        points: [
          { lat: 30.0, lon: 31.2 }, // Cairo
          { lat: 32.9, lon: 13.2 }, // Tripoli
          { lat: 22.8, lon: 5.5 }, // Tamanrasset
          { lat: 16.3, lon: -0.0 }, // Gao
          { lat: 16.8, lon: -3.0 },
        ],
      },
      {
        // long: from Russia, the length of Europe then across the Sahara.
        journeyId: "long",
        points: [
          { lat: 55.8, lon: 37.6 }, // Moscow
          { lat: 52.5, lon: 13.4 }, // Berlin
          { lat: 48.9, lon: 2.4 }, // Paris
          { lat: 40.4, lon: -3.7 }, // Madrid
          { lat: 31.6, lon: -8.0 }, // Marrakech
          { lat: 16.8, lon: -3.0 },
        ],
      },
    ],
  },
  {
    // End: Petra, the rose city.
    destination: { name: "Petra", at: { lat: 30.3, lon: 35.5 } },
    routes: [
      {
        // short: from the Iranian plateau, across Mesopotamia and the Levant.
        journeyId: "short",
        points: [
          { lat: 35.7, lon: 51.4 }, // Tehran
          { lat: 33.3, lon: 44.4 }, // Baghdad
          { lat: 33.5, lon: 36.3 }, // Damascus
          { lat: 31.9, lon: 35.9 }, // Amman
          { lat: 30.3, lon: 35.5 },
        ],
      },
      {
        // medium: from India, across the Gulf and Arabia.
        journeyId: "medium",
        points: [
          { lat: 28.6, lon: 77.2 }, // Delhi
          { lat: 24.9, lon: 67.0 }, // Karachi
          { lat: 25.3, lon: 55.3 }, // Dubai
          { lat: 24.7, lon: 46.7 }, // Riyadh
          { lat: 24.5, lon: 39.6 }, // Medina
          { lat: 30.3, lon: 35.5 },
        ],
      },
      {
        // long: from East Asia, across Central Asia and Mesopotamia.
        journeyId: "long",
        points: [
          { lat: 39.9, lon: 116.4 }, // Beijing
          { lat: 43.3, lon: 76.9 }, // Almaty
          { lat: 39.7, lon: 67.0 }, // Samarkand
          { lat: 35.7, lon: 51.4 }, // Tehran
          { lat: 33.3, lon: 44.4 }, // Baghdad
          { lat: 30.3, lon: 35.5 },
        ],
      },
    ],
  },
  {
    // End: Hanoi.
    destination: { name: "Hanoi", at: { lat: 21.0, lon: 105.8 } },
    routes: [
      {
        // short: from maritime Southeast Asia, up the Indochina coast.
        journeyId: "short",
        points: [
          { lat: 1.4, lon: 103.8 }, // Singapore
          { lat: 13.8, lon: 100.5 }, // Bangkok
          { lat: 11.6, lon: 104.9 }, // Phnom Penh
          { lat: 16.5, lon: 107.6 }, // Hue
          { lat: 21.0, lon: 105.8 },
        ],
      },
      {
        // medium: from India, across mainland Southeast Asia.
        journeyId: "medium",
        points: [
          { lat: 19.1, lon: 72.9 }, // Mumbai
          { lat: 22.6, lon: 88.4 }, // Kolkata
          { lat: 16.8, lon: 96.2 }, // Yangon
          { lat: 17.9, lon: 102.6 }, // Vientiane
          { lat: 21.0, lon: 105.8 },
        ],
      },
      {
        // long: from western Europe, the full Trans-Eurasian crossing.
        journeyId: "long",
        points: [
          { lat: 48.9, lon: 2.4 }, // Paris
          { lat: 55.8, lon: 37.6 }, // Moscow
          { lat: 55.0, lon: 82.9 }, // Novosibirsk
          { lat: 39.9, lon: 116.4 }, // Beijing
          { lat: 22.8, lon: 108.3 }, // Nanning
          { lat: 21.0, lon: 105.8 },
        ],
      },
    ],
  },
  {
    // End: Zanzibar, spice island.
    destination: { name: "Zanzibar", at: { lat: -6.2, lon: 39.2 } },
    routes: [
      {
        // short: from the Horn, down the Swahili coast.
        journeyId: "short",
        points: [
          { lat: 9.0, lon: 38.7 }, // Addis Ababa
          { lat: 2.0, lon: 45.3 }, // Mogadishu
          { lat: -1.3, lon: 36.8 }, // Nairobi
          { lat: -4.0, lon: 39.7 }, // Mombasa
          { lat: -6.2, lon: 39.2 },
        ],
      },
      {
        // medium: from India, across the Arabian Sea and down the coast.
        journeyId: "medium",
        points: [
          { lat: 19.1, lon: 72.9 }, // Mumbai
          { lat: 23.6, lon: 58.5 }, // Muscat
          { lat: 15.4, lon: 44.2 }, // Sanaa
          { lat: 2.0, lon: 45.3 }, // Mogadishu
          { lat: -4.0, lon: 39.7 }, // Mombasa
          { lat: -6.2, lon: 39.2 },
        ],
      },
      {
        // long: from Europe, down through Africa to the Indian Ocean.
        journeyId: "long",
        points: [
          { lat: 41.9, lon: 12.5 }, // Rome
          { lat: 30.0, lon: 31.2 }, // Cairo
          { lat: 15.6, lon: 32.5 }, // Khartoum
          { lat: -1.3, lon: 36.8 }, // Nairobi
          { lat: -4.0, lon: 39.7 }, // Mombasa
          { lat: -6.2, lon: 39.2 },
        ],
      },
    ],
  },
  {
    // End: Valparaiso, Pacific port of Chile.
    destination: { name: "Valparaiso", at: { lat: -33.0, lon: -71.6 } },
    routes: [
      {
        // short: from the Altiplano, down to the coast.
        journeyId: "short",
        points: [
          { lat: -16.5, lon: -68.1 }, // La Paz
          { lat: -18.5, lon: -70.3 }, // Arica
          { lat: -23.7, lon: -70.4 }, // Antofagasta
          { lat: -33.4, lon: -70.7 }, // Santiago
          { lat: -33.0, lon: -71.6 },
        ],
      },
      {
        // medium: from Brazil's northeast, down the Atlantic and over the Andes.
        journeyId: "medium",
        points: [
          { lat: -8.1, lon: -34.9 }, // Recife
          { lat: -22.9, lon: -43.2 }, // Rio de Janeiro
          { lat: -34.6, lon: -58.4 }, // Buenos Aires
          { lat: -32.9, lon: -68.8 }, // Mendoza
          { lat: -33.0, lon: -71.6 },
        ],
      },
      {
        // long: from North America, the length of the Pacific coast.
        journeyId: "long",
        points: [
          { lat: 19.4, lon: -99.1 }, // Mexico City
          { lat: 9.0, lon: -79.5 }, // Panama City
          { lat: 4.7, lon: -74.1 }, // Bogota
          { lat: -12.0, lon: -77.0 }, // Lima
          { lat: -23.7, lon: -70.4 }, // Antofagasta
          { lat: -33.0, lon: -71.6 },
        ],
      },
    ],
  },
  {
    // End: Bergen, among the fjords.
    destination: { name: "Bergen", at: { lat: 60.4, lon: 5.3 } },
    routes: [
      {
        // short: from Italy, up through central Europe and the lowlands.
        journeyId: "short",
        points: [
          { lat: 41.9, lon: 12.5 }, // Rome
          { lat: 52.5, lon: 13.4 }, // Berlin
          { lat: 55.7, lon: 12.6 }, // Copenhagen
          { lat: 59.9, lon: 10.8 }, // Oslo
          { lat: 60.4, lon: 5.3 },
        ],
      },
      {
        // medium: from North Africa, up the Atlantic facade of Europe.
        journeyId: "medium",
        points: [
          { lat: 30.0, lon: 31.2 }, // Cairo
          { lat: 41.9, lon: 12.5 }, // Rome
          { lat: 48.9, lon: 2.4 }, // Paris
          { lat: 51.5, lon: -0.1 }, // London
          { lat: 60.4, lon: 5.3 },
        ],
      },
      {
        // long: from India, across Persia and the whole of Europe.
        journeyId: "long",
        points: [
          { lat: 28.6, lon: 77.2 }, // Delhi
          { lat: 35.7, lon: 51.4 }, // Tehran
          { lat: 41.0, lon: 29.0 }, // Istanbul
          { lat: 41.9, lon: 12.5 }, // Rome
          { lat: 48.9, lon: 2.4 }, // Paris
          { lat: 60.4, lon: 5.3 },
        ],
      },
    ],
  },
  {
    // End: Dubrovnik, pearl of the Adriatic.
    destination: { name: "Dubrovnik", at: { lat: 42.6, lon: 18.1 } },
    routes: [
      {
        // short: from the Levant, across Anatolia and the Balkans.
        journeyId: "short",
        points: [
          { lat: 33.9, lon: 35.5 }, // Beirut
          { lat: 41.0, lon: 29.0 }, // Istanbul
          { lat: 42.7, lon: 23.3 }, // Sofia
          { lat: 44.8, lon: 20.5 }, // Belgrade
          { lat: 42.6, lon: 18.1 },
        ],
      },
      {
        // medium: from the Persian Gulf, through Mesopotamia and the Balkans.
        journeyId: "medium",
        points: [
          { lat: 25.3, lon: 55.3 }, // Dubai
          { lat: 33.3, lon: 44.4 }, // Baghdad
          { lat: 41.0, lon: 29.0 }, // Istanbul
          { lat: 42.7, lon: 23.3 }, // Sofia
          { lat: 44.8, lon: 20.5 }, // Belgrade
          { lat: 42.6, lon: 18.1 },
        ],
      },
      {
        // long: from East Asia, across Central Asia and Anatolia.
        journeyId: "long",
        points: [
          { lat: 39.9, lon: 116.4 }, // Beijing
          { lat: 43.3, lon: 76.9 }, // Almaty
          { lat: 35.7, lon: 51.4 }, // Tehran
          { lat: 41.0, lon: 29.0 }, // Istanbul
          { lat: 44.8, lon: 20.5 }, // Belgrade
          { lat: 42.6, lon: 18.1 },
        ],
      },
    ],
  },
  {
    // End: Queenstown, New Zealand.
    destination: { name: "Queenstown", at: { lat: -45.0, lon: 168.7 } },
    routes: [
      {
        // short: from eastern Australia, across the Tasman.
        journeyId: "short",
        points: [
          { lat: -27.5, lon: 153.0 }, // Brisbane
          { lat: -33.9, lon: 151.2 }, // Sydney
          { lat: -36.8, lon: 174.8 }, // Auckland
          { lat: -43.5, lon: 172.6 }, // Christchurch
          { lat: -45.0, lon: 168.7 },
        ],
      },
      {
        // medium: from Indonesia, down through Australia.
        journeyId: "medium",
        points: [
          { lat: -6.2, lon: 106.8 }, // Jakarta
          { lat: -31.9, lon: 115.9 }, // Perth
          { lat: -33.9, lon: 151.2 }, // Sydney
          { lat: -41.3, lon: 174.8 }, // Wellington
          { lat: -45.0, lon: 168.7 },
        ],
      },
      {
        // long: from East Asia, the whole Pacific descent.
        journeyId: "long",
        points: [
          { lat: 35.7, lon: 139.7 }, // Tokyo
          { lat: 14.6, lon: 121.0 }, // Manila
          { lat: -6.2, lon: 106.8 }, // Jakarta
          { lat: -33.9, lon: 151.2 }, // Sydney
          { lat: -41.3, lon: 174.8 }, // Wellington
          { lat: -45.0, lon: 168.7 },
        ],
      },
    ],
  },
  {
    // End: Kathmandu, in the Himalayan foothills.
    destination: { name: "Kathmandu", at: { lat: 27.7, lon: 85.3 } },
    routes: [
      {
        // short: from southern India, up the subcontinent.
        journeyId: "short",
        points: [
          { lat: 13.1, lon: 80.3 }, // Chennai
          { lat: 17.4, lon: 78.5 }, // Hyderabad
          { lat: 22.6, lon: 88.4 }, // Kolkata
          { lat: 26.7, lon: 83.4 }, // Gorakhpur
          { lat: 27.7, lon: 85.3 },
        ],
      },
      {
        // medium: from Arabia, across Persia and the Indus.
        journeyId: "medium",
        points: [
          { lat: 25.3, lon: 55.3 }, // Dubai
          { lat: 24.9, lon: 67.0 }, // Karachi
          { lat: 28.6, lon: 77.2 }, // Delhi
          { lat: 26.8, lon: 80.9 }, // Lucknow
          { lat: 27.7, lon: 85.3 },
        ],
      },
      {
        // long: from Japan, across China and over Tibet.
        journeyId: "long",
        points: [
          { lat: 35.7, lon: 139.7 }, // Tokyo
          { lat: 39.9, lon: 116.4 }, // Beijing
          { lat: 30.7, lon: 104.1 }, // Chengdu
          { lat: 29.7, lon: 91.1 }, // Lhasa
          { lat: 29.3, lon: 88.9 }, // Shigatse
          { lat: 27.7, lon: 85.3 },
        ],
      },
    ],
  },
  {
    // End: Salvador, Bahia.
    destination: { name: "Salvador", at: { lat: -12.97, lon: -38.5 } },
    routes: [
      {
        // short: from the Amazon mouth, down the northeast coast.
        journeyId: "short",
        points: [
          { lat: -1.5, lon: -48.5 }, // Belem
          { lat: -3.7, lon: -38.5 }, // Fortaleza
          { lat: -8.1, lon: -34.9 }, // Recife
          { lat: -10.9, lon: -37.1 }, // Aracaju
          { lat: -12.97, lon: -38.5 },
        ],
      },
      {
        // medium: from the Rio Plata, up the Atlantic coast.
        journeyId: "medium",
        points: [
          { lat: -34.6, lon: -58.4 }, // Buenos Aires
          { lat: -30.0, lon: -51.2 }, // Porto Alegre
          { lat: -23.6, lon: -46.6 }, // Sao Paulo
          { lat: -22.9, lon: -43.2 }, // Rio de Janeiro
          { lat: -12.97, lon: -38.5 },
        ],
      },
      {
        // long: from West Africa, the Atlantic crossing of the trade winds.
        journeyId: "long",
        points: [
          { lat: 6.5, lon: 3.4 }, // Lagos
          { lat: 5.6, lon: -0.2 }, // Accra
          { lat: 14.7, lon: -17.4 }, // Dakar
          { lat: -8.1, lon: -34.9 }, // Recife
          { lat: -10.9, lon: -37.1 }, // Aracaju
          { lat: -12.97, lon: -38.5 },
        ],
      },
    ],
  },
  {
    // End: Tbilisi, in the Caucasus.
    destination: { name: "Tbilisi", at: { lat: 41.7, lon: 44.8 } },
    routes: [
      {
        // short: from the Gulf, up through Mesopotamia and Persia.
        journeyId: "short",
        points: [
          { lat: 25.3, lon: 55.3 }, // Dubai
          { lat: 33.3, lon: 44.4 }, // Baghdad
          { lat: 35.7, lon: 51.4 }, // Tehran
          { lat: 40.4, lon: 49.9 }, // Baku
          { lat: 41.7, lon: 44.8 },
        ],
      },
      {
        // medium: from the Atlantic, across the whole of Europe.
        journeyId: "medium",
        points: [
          { lat: 38.7, lon: -9.1 }, // Lisbon
          { lat: 41.9, lon: 12.5 }, // Rome
          { lat: 41.0, lon: 29.0 }, // Istanbul
          { lat: 40.2, lon: 44.5 }, // Yerevan
          { lat: 41.7, lon: 44.8 },
        ],
      },
      {
        // long: from East Asia, across Central Asia to the Caucasus.
        journeyId: "long",
        points: [
          { lat: 39.9, lon: 116.4 }, // Beijing
          { lat: 43.3, lon: 76.9 }, // Almaty
          { lat: 39.7, lon: 67.0 }, // Samarkand
          { lat: 35.7, lon: 51.4 }, // Tehran
          { lat: 40.4, lon: 49.9 }, // Baku
          { lat: 41.7, lon: 44.8 },
        ],
      },
    ],
  },
  {
    // End: Ulaanbaatar, on the steppe.
    destination: { name: "Ulaanbaatar", at: { lat: 47.9, lon: 106.9 } },
    routes: [
      {
        // short: from eastern China, up across the Gobi.
        journeyId: "short",
        points: [
          { lat: 31.2, lon: 121.5 }, // Shanghai
          { lat: 39.9, lon: 116.4 }, // Beijing
          { lat: 40.8, lon: 111.7 }, // Hohhot
          { lat: 43.6, lon: 112.1 }, // Erenhot
          { lat: 47.9, lon: 106.9 },
        ],
      },
      {
        // medium: from the Gulf, across Central Asia and the steppe.
        journeyId: "medium",
        points: [
          { lat: 25.3, lon: 55.3 }, // Dubai
          { lat: 41.3, lon: 69.3 }, // Tashkent
          { lat: 43.3, lon: 76.9 }, // Almaty
          { lat: 55.0, lon: 82.9 }, // Novosibirsk
          { lat: 47.9, lon: 106.9 },
        ],
      },
      {
        // long: from western Europe, the Trans-Siberian arc.
        journeyId: "long",
        points: [
          { lat: 48.9, lon: 2.4 }, // Paris
          { lat: 55.8, lon: 37.6 }, // Moscow
          { lat: 55.0, lon: 82.9 }, // Novosibirsk
          { lat: 52.3, lon: 104.3 }, // Irkutsk
          { lat: 50.3, lon: 106.5 }, // Kyakhta
          { lat: 47.9, lon: 106.9 },
        ],
      },
    ],
  },
  {
    // End: Honolulu, mid-Pacific.
    destination: { name: "Honolulu", at: { lat: 21.3, lon: -157.9 } },
    routes: [
      {
        // short: from the US west coast, out across the Pacific.
        journeyId: "short",
        points: [
          { lat: 47.6, lon: -122.3 }, // Seattle
          { lat: 37.6, lon: -122.4 }, // San Francisco
          { lat: 34.1, lon: -118.2 }, // Los Angeles
          { lat: 21.3, lon: -157.9 },
        ],
      },
      {
        // medium: from Mexico, up the coast and across the ocean.
        journeyId: "medium",
        points: [
          { lat: 19.4, lon: -99.1 }, // Mexico City
          { lat: 34.1, lon: -118.2 }, // Los Angeles
          { lat: 37.6, lon: -122.4 }, // San Francisco
          { lat: 21.3, lon: -157.9 },
        ],
      },
      {
        // long: from East Asia, island-hopping across the whole Pacific.
        journeyId: "long",
        points: [
          { lat: 31.2, lon: 121.5 }, // Shanghai
          { lat: 35.7, lon: 139.7 }, // Tokyo
          { lat: 13.5, lon: 144.8 }, // Guam
          { lat: 7.1, lon: 171.4 }, // Majuro
          { lat: 21.3, lon: -157.9 },
        ],
      },
    ],
  },
];
