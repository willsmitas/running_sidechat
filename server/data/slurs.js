// Language that blocks a post outright. This file contains slurs so the
// filter can recognize them; it exists only to keep them off the boards.
//
// Each entry is matched against whole words after normalizing leetspeak
// (n1gg3r), stretched letters (niiiigger), symbols inside words (n!gger),
// and spaced-out letters (n i g g e r). A trailing s/es/z/y is allowed.
// `inside: true` also matches the slur within a longer word (sandn*gger),
// for slurs that don't occur inside ordinary English words.
//
// Admins can block more words at runtime in Admin → Settings → Banned words.

export const SLURS = [
  { word: 'nigger', inside: true },
  { word: 'nigga', inside: true },
  { word: 'niggah' },
  { word: 'negroid' },
  { word: 'faggot', inside: true },
  { word: 'fagot' },
  { word: 'fag' },
  { word: 'faggy' },
  { word: 'dyke' },
  { word: 'tranny', inside: true },
  { word: 'trannie' },
  { word: 'shemale' },
  { word: 'retard' },
  { word: 'retarded' },
  { word: 'tard' },
  { word: 'kike' },
  { word: 'spic' },
  { word: 'spick' },
  { word: 'chink' },
  { word: 'gook' },
  { word: 'wetback', inside: true },
  { word: 'beaner' },
  { word: 'coon' },
  { word: 'jigaboo', inside: true },
  { word: 'porchmonkey', inside: true },
  { word: 'raghead', inside: true },
  { word: 'towelhead', inside: true },
  { word: 'sandnigger', inside: true },
  { word: 'paki' },
  { word: 'wop' },
  { word: 'dago' },
  { word: 'jap' },
  { word: 'gyppo' },
];

// Real words that contain a slur matched with `inside: true`.
export const SLUR_ALLOWLIST = ['snigger', 'sniggers', 'sniggered', 'sniggering'];
