export type MapId = 'suna' | 'miru' | 'khidi' | 'cliffside' | 'frio' | 'kiiro';

export interface MapConfig {
  id: MapId;
  name: string;
  subtitle: string;
  description: string;
  environment: string;
  difficulty: string;
  color: string;
  accentColor: string;
  sites: string[];
  callouts: string[];
  folder: string;
  /** Marks the map as work-in-progress - UI shows a WIP badge. */
  wip?: boolean;
  /** The callouts overlay for this map isn't ready, so the callouts feature is
   *  switched off on it even though the map itself is fine to use. */
  calloutsWip?: boolean;
  /** Bump this when the map.png gets swapped for a new image under the same
   *  filename. It rides on the URL as ?v=N so browsers fetch the new one
   *  instead of handing back the old cached copy. */
  mapRev?: number;
}

export const MAPS: readonly MapConfig[] = [
  {
    id: 'suna',
    name: 'SUNA',
    subtitle: 'Desert Operations Base',
    description:
      "A sun-baked desert outpost and one of VAIL's most iconic maps. Structurally similar to Dust 2, Suna features a classic three-lane layout with two artifact sites.",
    environment: 'Desert / Arid',
    difficulty: 'Medium',
    color: '#C4873A',
    accentColor: '#E8A84A',
    sites: ['A', 'B'],
    callouts: ['A Long', 'Mid', 'B Tunnels', 'Catwalk', 'Sandwich'],
    folder: 'assets/maps/suna',
  },
  {
    id: 'miru',
    name: 'MIRU',
    subtitle: 'Urban Infrastructure',
    description:
      "A dense urban map set within REYAB's civilian infrastructure network.",
    environment: 'Urban / Industrial',
    difficulty: 'High',
    color: '#4A7FC4',
    accentColor: '#5A9FE4',
    sites: ['A', 'B'],
    callouts: ['Mid', 'Ramp', 'Shipping', 'Gen', 'Scaf', 'Picnic'],
    folder: 'assets/maps/miru',
  },
  {
    id: 'khidi',
    name: 'KHIDI',
    subtitle: 'Data Transmission Hub',
    description:
      "A deceptively open civilian district concealing REYAB's Etana data network.",
    environment: 'Civilian / Open-Air',
    difficulty: 'High',
    color: '#7BC44A',
    accentColor: '#9BE46A',
    sites: ['A', 'B'],
    callouts: ['Ninja', 'Mouse', 'Nightclub', 'Headglitch', 'Cave'],
    folder: 'assets/maps/khidi',
  },
  {
    id: 'cliffside',
    name: 'CLIFFSIDE',
    subtitle: 'Coastal Black Market',
    description:
      'Tucked into tropical coastal caves, Cliffside features tight cave systems and open bazaar areas.',
    environment: 'Tropical / Cave',
    difficulty: 'Medium',
    color: '#4AC4A8',
    accentColor: '#5AE4C8',
    sites: ['A', 'B'],
    callouts: ['Cave', 'Bazaar', 'Dock', 'Nightclub'],
    folder: 'assets/maps/cliffside',
  },
  {
    id: 'frio',
    name: 'FRIO',
    subtitle: 'Arctic Power Sector',
    description:
      'A subterranean arctic research facility. Cryogenic corridors and industrial lab spaces create complex three-dimensional engagements.',
    environment: 'Arctic / Industrial',
    difficulty: 'Medium-High',
    color: '#6A9AC4',
    accentColor: '#8ABAE4',
    sites: ['A', 'B'],
    callouts: ['Labs', 'Cryo', 'Shipyard', 'Power', 'Tunnels'],
    folder: 'assets/maps/frio',
  },
  {
    id: 'kiiro',
    name: 'KIIRO',
    subtitle: 'Back in rotation',
    description: 'Kiiro is back in the rotation, callouts included.',
    environment: 'TBD',
    difficulty: 'TBD',
    color: '#C4B84A',
    accentColor: '#E4D86A',
    sites: ['A', 'B'],
    callouts: ['A Long', 'Mid', 'Heaven', 'Highway', 'Yard'],
    folder: 'assets/maps/kiiro',
    mapRev: 2,
  },
];

export function getMap(id: MapId): MapConfig {
  const m = MAPS.find((m) => m.id === id);
  if (!m) throw new Error(`Unknown map id: ${id}`);
  return m;
}

/** Whether the callouts overlay feature is usable on a map. False for maps
 *  flagged calloutsWip, whose overlay isn't ready yet. */
export function mapSupportsCallouts(id: MapId): boolean {
  return !getMap(id).calloutsWip;
}
