/**
 * Daily Dive — destination + route content (owned by Track B).
 *
 * Each entry is one destination city plus its three authored routes
 * (short/medium/long polylines of real waypoints) to it. `window.ts` (Track A)
 * picks one entry per day (seeded by date) and pairs it with the journey config.
 *
 * There are >= 22 hand-authored entries so destinations don't repeat within a
 * rolling 7-day window. Each route's LAST point equals `destination.at` exactly;
 * longer journeys wander through more real intermediate cities before arriving.
 * All coordinates are degrees; the client projects lat/lon directly.
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
    destination: { name: "Istanbul", at: { lat: 41.0, lon: 29.0 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: 37.9, lon: 23.7 }, // Athens
          { lat: 40.6, lon: 22.9 }, // Thessaloniki
          { lat: 41.0, lon: 29.0 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: 41.9, lon: 12.5 }, // Rome
          { lat: 44.4, lon: 26.1 }, // Bucharest
          { lat: 42.7, lon: 23.3 }, // Sofia
          { lat: 41.0, lon: 29.0 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 38.7, lon: -9.1 }, // Lisbon
          { lat: 48.9, lon: 2.4 }, // Paris
          { lat: 52.5, lon: 13.4 }, // Berlin
          { lat: 47.5, lon: 19.0 }, // Budapest
          { lat: 41.0, lon: 29.0 },
        ],
      },
    ],
  },
  {
    destination: { name: "Cairo", at: { lat: 30.0, lon: 31.2 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: 31.2, lon: 29.9 }, // Alexandria
          { lat: 30.0, lon: 31.2 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: 32.9, lon: 13.2 }, // Tripoli
          { lat: 31.6, lon: 25.1 }, // Tobruk
          { lat: 30.0, lon: 31.2 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 36.8, lon: 10.2 }, // Tunis
          { lat: 32.9, lon: 13.2 }, // Tripoli
          { lat: 32.1, lon: 20.1 }, // Benghazi
          { lat: 31.2, lon: 29.9 }, // Alexandria
          { lat: 30.0, lon: 31.2 },
        ],
      },
    ],
  },
  {
    destination: { name: "Nairobi", at: { lat: -1.3, lon: 36.8 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: 9.0, lon: 38.7 }, // Addis Ababa
          { lat: -1.3, lon: 36.8 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: 15.3, lon: 32.5 }, // Khartoum
          { lat: 9.0, lon: 38.7 }, // Addis Ababa
          { lat: 0.3, lon: 32.6 }, // Kampala
          { lat: -1.3, lon: 36.8 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 30.0, lon: 31.2 }, // Cairo
          { lat: 15.6, lon: 32.5 }, // Khartoum
          { lat: 9.0, lon: 38.7 }, // Addis Ababa
          { lat: 2.0, lon: 45.3 }, // Mogadishu
          { lat: -1.3, lon: 36.8 },
        ],
      },
    ],
  },
  {
    destination: { name: "Kyoto", at: { lat: 35.0, lon: 135.8 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: 35.7, lon: 139.7 }, // Tokyo
          { lat: 34.7, lon: 135.5 }, // Osaka
          { lat: 35.0, lon: 135.8 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: 37.6, lon: 126.9 }, // Seoul
          { lat: 35.1, lon: 129.0 }, // Busan
          { lat: 33.6, lon: 130.4 }, // Fukuoka
          { lat: 35.0, lon: 135.8 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 39.9, lon: 116.4 }, // Beijing
          { lat: 38.0, lon: 125.0 }, // Yellow Sea crossing
          { lat: 37.6, lon: 126.9 }, // Seoul
          { lat: 35.7, lon: 139.7 }, // Tokyo
          { lat: 35.0, lon: 135.8 },
        ],
      },
    ],
  },
  {
    destination: { name: "Reykjavik", at: { lat: 64.1, lon: -21.9 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: 55.7, lon: 12.6 }, // Copenhagen
          { lat: 62.0, lon: -6.8 }, // Torshavn
          { lat: 64.1, lon: -21.9 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: 53.3, lon: -6.3 }, // Dublin
          { lat: 55.9, lon: -4.3 }, // Glasgow
          { lat: 62.0, lon: -6.8 }, // Torshavn
          { lat: 64.1, lon: -21.9 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 60.2, lon: 25.0 }, // Helsinki
          { lat: 59.3, lon: 18.1 }, // Stockholm
          { lat: 59.9, lon: 10.8 }, // Oslo
          { lat: 62.0, lon: -6.8 }, // Torshavn
          { lat: 64.1, lon: -21.9 },
        ],
      },
    ],
  },
  {
    destination: { name: "Cusco", at: { lat: -13.5, lon: -72.0 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: -12.0, lon: -77.0 }, // Lima
          { lat: -13.5, lon: -72.0 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: -2.2, lon: -79.9 }, // Guayaquil
          { lat: -12.0, lon: -77.0 }, // Lima
          { lat: -16.4, lon: -71.5 }, // Arequipa
          { lat: -13.5, lon: -72.0 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 4.7, lon: -74.1 }, // Bogota
          { lat: -0.2, lon: -78.5 }, // Quito
          { lat: -12.0, lon: -77.0 }, // Lima
          { lat: -16.5, lon: -68.1 }, // La Paz
          { lat: -13.5, lon: -72.0 },
        ],
      },
    ],
  },
  {
    destination: { name: "Marrakech", at: { lat: 31.6, lon: -8.0 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: 36.1, lon: -5.4 }, // Gibraltar strait
          { lat: 33.6, lon: -7.6 }, // Casablanca
          { lat: 31.6, lon: -8.0 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: 40.4, lon: -3.7 }, // Madrid
          { lat: 37.4, lon: -6.0 }, // Seville
          { lat: 34.0, lon: -6.8 }, // Rabat
          { lat: 31.6, lon: -8.0 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 48.9, lon: 2.4 }, // Paris
          { lat: 41.4, lon: 2.2 }, // Barcelona
          { lat: 40.4, lon: -3.7 }, // Madrid
          { lat: 33.6, lon: -7.6 }, // Casablanca
          { lat: 31.6, lon: -8.0 },
        ],
      },
    ],
  },
  {
    destination: { name: "Samarkand", at: { lat: 39.7, lon: 67.0 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: 41.3, lon: 69.3 }, // Tashkent
          { lat: 39.7, lon: 67.0 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: 35.7, lon: 51.4 }, // Tehran
          { lat: 37.9, lon: 58.4 }, // Ashgabat
          { lat: 39.8, lon: 64.4 }, // Bukhara
          { lat: 39.7, lon: 67.0 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 41.0, lon: 29.0 }, // Istanbul
          { lat: 40.2, lon: 44.5 }, // Yerevan
          { lat: 40.4, lon: 49.9 }, // Baku
          { lat: 41.3, lon: 69.3 }, // Tashkent
          { lat: 39.7, lon: 67.0 },
        ],
      },
    ],
  },
  {
    destination: { name: "Cape Town", at: { lat: -33.9, lon: 18.4 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: -22.6, lon: 17.1 }, // Windhoek
          { lat: -28.7, lon: 16.9 }, // Alexander Bay
          { lat: -33.9, lon: 18.4 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: -8.8, lon: 13.2 }, // Luanda
          { lat: -22.6, lon: 17.1 }, // Windhoek
          { lat: -26.2, lon: 28.0 }, // Johannesburg
          { lat: -33.9, lon: 18.4 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 6.5, lon: 3.4 }, // Lagos
          { lat: -4.3, lon: 15.3 }, // Kinshasa
          { lat: -8.8, lon: 13.2 }, // Luanda
          { lat: -22.6, lon: 17.1 }, // Windhoek
          { lat: -33.9, lon: 18.4 },
        ],
      },
    ],
  },
  {
    destination: { name: "Ushuaia", at: { lat: -54.8, lon: -68.3 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: -51.6, lon: -69.2 }, // Rio Gallegos
          { lat: -53.8, lon: -67.7 }, // Rio Grande
          { lat: -54.8, lon: -68.3 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: -34.6, lon: -58.4 }, // Buenos Aires
          { lat: -43.3, lon: -65.1 }, // Trelew
          { lat: -51.6, lon: -69.2 }, // Rio Gallegos
          { lat: -54.8, lon: -68.3 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: -23.6, lon: -46.6 }, // Sao Paulo
          { lat: -34.6, lon: -58.4 }, // Buenos Aires
          { lat: -38.0, lon: -57.5 }, // Mar del Plata
          { lat: -45.9, lon: -67.5 }, // Comodoro Rivadavia
          { lat: -54.8, lon: -68.3 },
        ],
      },
    ],
  },
  {
    destination: { name: "Lhasa", at: { lat: 29.7, lon: 91.1 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: 27.7, lon: 85.3 }, // Kathmandu
          { lat: 28.4, lon: 87.0 }, // Shigatse approach
          { lat: 29.7, lon: 91.1 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: 28.6, lon: 77.2 }, // Delhi
          { lat: 27.7, lon: 85.3 }, // Kathmandu
          { lat: 29.3, lon: 88.9 }, // Shigatse
          { lat: 29.7, lon: 91.1 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 39.9, lon: 116.4 }, // Beijing
          { lat: 34.3, lon: 108.9 }, // Xi'an
          { lat: 30.7, lon: 104.1 }, // Chengdu
          { lat: 29.7, lon: 94.4 }, // Nyingchi
          { lat: 29.7, lon: 91.1 },
        ],
      },
    ],
  },
  {
    destination: { name: "Timbuktu", at: { lat: 16.8, lon: -3.0 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: 12.6, lon: -8.0 }, // Bamako
          { lat: 14.5, lon: -4.2 }, // Mopti
          { lat: 16.8, lon: -3.0 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: 14.7, lon: -17.4 }, // Dakar
          { lat: 12.6, lon: -8.0 }, // Bamako
          { lat: 16.3, lon: -0.0 }, // Gao approach
          { lat: 16.8, lon: -3.0 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 36.8, lon: 3.1 }, // Algiers
          { lat: 22.8, lon: 5.5 }, // Tamanrasset
          { lat: 16.8, lon: 3.0 }, // Niger bend
          { lat: 16.3, lon: -0.0 }, // Gao
          { lat: 16.8, lon: -3.0 },
        ],
      },
    ],
  },
  {
    destination: { name: "Petra", at: { lat: 30.3, lon: 35.5 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: 31.9, lon: 35.9 }, // Amman
          { lat: 30.3, lon: 35.5 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: 31.8, lon: 35.2 }, // Jerusalem
          { lat: 31.9, lon: 35.9 }, // Amman
          { lat: 29.5, lon: 35.0 }, // Aqaba
          { lat: 30.3, lon: 35.5 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 33.5, lon: 36.3 }, // Damascus
          { lat: 33.9, lon: 35.5 }, // Beirut
          { lat: 32.1, lon: 34.8 }, // Tel Aviv
          { lat: 31.9, lon: 35.9 }, // Amman
          { lat: 30.3, lon: 35.5 },
        ],
      },
    ],
  },
  {
    destination: { name: "Hanoi", at: { lat: 21.0, lon: 105.8 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: 22.8, lon: 108.3 }, // Nanning
          { lat: 21.6, lon: 106.0 }, // Lang Son
          { lat: 21.0, lon: 105.8 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: 13.8, lon: 100.5 }, // Bangkok
          { lat: 17.9, lon: 102.6 }, // Vientiane
          { lat: 18.7, lon: 105.7 }, // Vinh
          { lat: 21.0, lon: 105.8 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 1.4, lon: 103.8 }, // Singapore
          { lat: 3.1, lon: 101.7 }, // Kuala Lumpur
          { lat: 13.8, lon: 100.5 }, // Bangkok
          { lat: 16.5, lon: 107.6 }, // Hue
          { lat: 21.0, lon: 105.8 },
        ],
      },
    ],
  },
  {
    destination: { name: "Zanzibar", at: { lat: -6.2, lon: 39.2 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: -6.8, lon: 39.3 }, // Dar es Salaam
          { lat: -6.2, lon: 39.2 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: -1.3, lon: 36.8 }, // Nairobi
          { lat: -4.0, lon: 39.7 }, // Mombasa
          { lat: -6.8, lon: 39.3 }, // Dar es Salaam
          { lat: -6.2, lon: 39.2 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 9.0, lon: 38.7 }, // Addis Ababa
          { lat: -1.3, lon: 36.8 }, // Nairobi
          { lat: -3.4, lon: 37.3 }, // Moshi (Kilimanjaro)
          { lat: -4.0, lon: 39.7 }, // Mombasa
          { lat: -6.2, lon: 39.2 },
        ],
      },
    ],
  },
  {
    destination: { name: "Valparaiso", at: { lat: -33.0, lon: -71.6 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: -33.4, lon: -70.7 }, // Santiago
          { lat: -33.0, lon: -71.6 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: -16.5, lon: -68.1 }, // La Paz
          { lat: -23.7, lon: -70.4 }, // Antofagasta
          { lat: -33.4, lon: -70.7 }, // Santiago
          { lat: -33.0, lon: -71.6 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: -12.0, lon: -77.0 }, // Lima
          { lat: -18.5, lon: -70.3 }, // Arica
          { lat: -23.7, lon: -70.4 }, // Antofagasta
          { lat: -29.9, lon: -71.3 }, // La Serena
          { lat: -33.0, lon: -71.6 },
        ],
      },
    ],
  },
  {
    destination: { name: "Bergen", at: { lat: 60.4, lon: 5.3 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: 59.9, lon: 10.8 }, // Oslo
          { lat: 58.1, lon: 7.0 }, // Kristiansand
          { lat: 60.4, lon: 5.3 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: 55.7, lon: 12.6 }, // Copenhagen
          { lat: 57.7, lon: 11.97 }, // Gothenburg
          { lat: 59.9, lon: 10.8 }, // Oslo
          { lat: 60.4, lon: 5.3 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 52.4, lon: 4.9 }, // Amsterdam
          { lat: 53.5, lon: 10.0 }, // Hamburg
          { lat: 55.7, lon: 12.6 }, // Copenhagen
          { lat: 59.9, lon: 10.8 }, // Oslo
          { lat: 60.4, lon: 5.3 },
        ],
      },
    ],
  },
  {
    destination: { name: "Dubrovnik", at: { lat: 42.6, lon: 18.1 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: 45.8, lon: 16.0 }, // Zagreb
          { lat: 43.5, lon: 16.4 }, // Split
          { lat: 42.6, lon: 18.1 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: 41.9, lon: 12.5 }, // Rome
          { lat: 45.4, lon: 12.3 }, // Venice
          { lat: 43.5, lon: 16.4 }, // Split
          { lat: 42.6, lon: 18.1 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 48.2, lon: 16.4 }, // Vienna
          { lat: 46.1, lon: 14.5 }, // Ljubljana
          { lat: 45.8, lon: 16.0 }, // Zagreb
          { lat: 44.1, lon: 15.2 }, // Zadar
          { lat: 42.6, lon: 18.1 },
        ],
      },
    ],
  },
  {
    destination: { name: "Queenstown", at: { lat: -45.0, lon: 168.7 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: -43.5, lon: 172.6 }, // Christchurch
          { lat: -45.9, lon: 170.5 }, // Dunedin
          { lat: -45.0, lon: 168.7 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: -36.8, lon: 174.8 }, // Auckland
          { lat: -41.3, lon: 174.8 }, // Wellington
          { lat: -43.5, lon: 172.6 }, // Christchurch
          { lat: -45.0, lon: 168.7 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: -33.9, lon: 151.2 }, // Sydney
          { lat: -37.8, lon: 145.0 }, // Melbourne
          { lat: -41.3, lon: 174.8 }, // Wellington
          { lat: -43.5, lon: 172.6 }, // Christchurch
          { lat: -45.0, lon: 168.7 },
        ],
      },
    ],
  },
  {
    destination: { name: "Kathmandu", at: { lat: 27.7, lon: 85.3 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: 28.6, lon: 77.2 }, // Delhi
          { lat: 26.5, lon: 80.3 }, // Kanpur
          { lat: 27.7, lon: 85.3 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: 23.8, lon: 90.4 }, // Dhaka
          { lat: 22.6, lon: 88.4 }, // Kolkata
          { lat: 26.7, lon: 83.4 }, // Gorakhpur
          { lat: 27.7, lon: 85.3 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 24.9, lon: 67.0 }, // Karachi
          { lat: 28.6, lon: 77.2 }, // Delhi
          { lat: 26.8, lon: 80.9 }, // Lucknow
          { lat: 27.6, lon: 84.4 }, // Bharatpur
          { lat: 27.7, lon: 85.3 },
        ],
      },
    ],
  },
  {
    destination: { name: "Salvador", at: { lat: -12.97, lon: -38.5 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: -8.1, lon: -34.9 }, // Recife
          { lat: -9.7, lon: -35.7 }, // Maceio
          { lat: -12.97, lon: -38.5 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: -3.7, lon: -38.5 }, // Fortaleza
          { lat: -8.1, lon: -34.9 }, // Recife
          { lat: -10.9, lon: -37.1 }, // Aracaju
          { lat: -12.97, lon: -38.5 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: -23.6, lon: -46.6 }, // Sao Paulo
          { lat: -22.9, lon: -43.2 }, // Rio de Janeiro
          { lat: -19.9, lon: -43.9 }, // Belo Horizonte
          { lat: -16.3, lon: -39.0 }, // Porto Seguro
          { lat: -12.97, lon: -38.5 },
        ],
      },
    ],
  },
  {
    destination: { name: "Tbilisi", at: { lat: 41.7, lon: 44.8 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: 40.2, lon: 44.5 }, // Yerevan
          { lat: 41.7, lon: 44.8 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: 40.4, lon: 49.9 }, // Baku
          { lat: 41.3, lon: 48.3 }, // Quba
          { lat: 41.6, lon: 45.8 }, // Rustavi approach
          { lat: 41.7, lon: 44.8 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 41.0, lon: 29.0 }, // Istanbul
          { lat: 39.9, lon: 32.9 }, // Ankara
          { lat: 41.0, lon: 39.7 }, // Trabzon
          { lat: 41.7, lon: 44.8 },
        ],
      },
    ],
  },
  {
    destination: { name: "Ulaanbaatar", at: { lat: 47.9, lon: 106.9 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: 43.6, lon: 112.1 }, // Erenhot
          { lat: 45.5, lon: 106.3 }, // Dalanzadgad approach
          { lat: 47.9, lon: 106.9 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: 39.9, lon: 116.4 }, // Beijing
          { lat: 40.8, lon: 111.7 }, // Hohhot
          { lat: 43.6, lon: 112.1 }, // Erenhot
          { lat: 47.9, lon: 106.9 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 52.3, lon: 104.3 }, // Irkutsk
          { lat: 51.7, lon: 103.0 }, // Baikal shore
          { lat: 50.3, lon: 106.5 }, // Kyakhta
          { lat: 48.7, lon: 106.3 }, // Darkhan
          { lat: 47.9, lon: 106.9 },
        ],
      },
    ],
  },
  {
    destination: { name: "Honolulu", at: { lat: 21.3, lon: -157.9 } },
    routes: [
      {
        journeyId: "short",
        points: [
          { lat: 37.6, lon: -122.4 }, // San Francisco
          { lat: 21.3, lon: -157.9 },
        ],
      },
      {
        journeyId: "medium",
        points: [
          { lat: 47.6, lon: -122.3 }, // Seattle
          { lat: 37.6, lon: -122.4 }, // San Francisco
          { lat: 32.7, lon: -117.2 }, // San Diego
          { lat: 21.3, lon: -157.9 },
        ],
      },
      {
        journeyId: "long",
        points: [
          { lat: 35.7, lon: 139.7 }, // Tokyo
          { lat: 13.5, lon: 144.8 }, // Guam
          { lat: 7.1, lon: 171.4 }, // Majuro
          { lat: 1.4, lon: 173.0 }, // Tarawa
          { lat: 21.3, lon: -157.9 },
        ],
      },
    ],
  },
];
