// Six-string tuning library. Notes run from the 6th (lowest) string to the 1st.
// `shape`: 'std' = standard interval pattern (P4 P4 P4 M3 P4) at any pitch,
//          'drop' = standard with the 6th string a whole tone lower.
//          Used by the open-chord sweetener, which needs familiar chord shapes.
// `root`:  pitch-class root of a chordal tuning, used by the just-chord sweetener.

export const CATEGORIES = [
  { id: 'standard', name: 'Standard and lowered' },
  { id: 'drop', name: 'Drop tunings' },
  { id: 'open', name: 'Open chords' },
  { id: 'modal', name: 'Modal and suspended' },
  { id: 'slack', name: 'Hawaiian slack key' },
  { id: 'regular', name: 'Regular (symmetric)' },
  { id: 'historic', name: 'Historical and instrumental' },
  { id: 'artist', name: 'Songwriter tunings' },
];

export const TUNINGS = [
  // ── Standard and lowered ───────────────────────────────────────────────
  { id: 'standard', category: 'standard', name: 'Standard', notes: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], shape: 'std',
    about: 'Fourths between every pair of strings except one major third (G–B). The compromise that makes scales and chord shapes fit under one hand; the reference every other tuning is described against.',
    sources: ['weissman2006'] },
  { id: 'eb-standard', category: 'standard', name: 'E♭ standard (half step down)', notes: ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'], shape: 'std',
    about: 'Standard shapes a semitone lower: slinkier strings for bends and a darker tone. Long associated with Jimi Hendrix, Stevie Ray Vaughan and Eddie Van Halen.',
    sources: ['weissman2006'] },
  { id: 'd-standard', category: 'standard', name: 'D standard (whole step down)', notes: ['D2', 'G2', 'C3', 'F3', 'A3', 'D4'], shape: 'std',
    about: 'Standard shapes a whole tone lower. Common in heavier rock and for singers who want songs a step down without relearning fingerings.',
    sources: ['weissman2006'] },
  { id: 'c-standard', category: 'standard', name: 'C standard', notes: ['C2', 'F2', 'Bb2', 'Eb3', 'G3', 'C4'], shape: 'std',
    about: 'Standard shapes two whole tones down. Needs heavier strings (≈ .012–.056) to keep tension.',
    sources: ['weissman2006'] },
  { id: 'baritone-b', category: 'standard', name: 'Baritone (B standard)', notes: ['B1', 'E2', 'A2', 'D3', 'F#3', 'B3'], shape: 'std',
    about: 'A fourth below standard, the usual tuning for long-scale (27″–30″) baritone guitars.',
    sources: ['weissman2006'] },
  { id: 'nashville', category: 'standard', name: 'Nashville (high-strung)', notes: ['E3', 'A3', 'D4', 'G4', 'B3', 'E4'], shape: 'std',
    about: 'The four wound strings are replaced by the thin octave strings of a 12-string set, so the guitar rings an octave up with standard fingerings. Used for shimmering doubled parts in studio work.',
    sources: ['weissman2006'] },

  // ── Drop ───────────────────────────────────────────────────────────────
  { id: 'drop-d', category: 'drop', name: 'Drop D', notes: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'], shape: 'drop',
    about: 'Only the 6th string goes down a tone, giving a low D drone and one-finger power chords. Standard practice in classical repertoire written in D and in heavy rock.',
    sources: ['weissman2006', 'robson2023'] },
  { id: 'double-drop-d', category: 'drop', name: 'Double drop D', notes: ['D2', 'A2', 'D3', 'G3', 'B3', 'D4'], shape: null,
    about: 'Both E strings dropped to D. Neil Young’s “Cinnamon Girl” and Foo Fighters’ “Everlong” are well-known examples.',
    sources: ['weissman2006'] },
  { id: 'drop-cs', category: 'drop', name: 'Drop C♯', notes: ['C#2', 'G#2', 'C#3', 'F#3', 'A#3', 'D#4'], shape: 'drop',
    about: 'Drop D lowered a semitone (E♭ standard with the 6th string dropped).',
    sources: ['weissman2006'] },
  { id: 'drop-c', category: 'drop', name: 'Drop C', notes: ['C2', 'G2', 'C3', 'F3', 'A3', 'D4'], shape: 'drop',
    about: 'Drop D lowered a whole tone. A staple of modern metal; use a heavier 6th string.',
    sources: ['weissman2006'] },
  { id: 'drop-b', category: 'drop', name: 'Drop B', notes: ['B1', 'F#2', 'B2', 'E3', 'G#3', 'C#4'], shape: 'drop',
    about: 'Drop tuning on a baritone or with a heavy set (≈ .013–.062).',
    sources: ['weissman2006'] },

  // ── Open ───────────────────────────────────────────────────────────────
  { id: 'open-e', category: 'open', name: 'Open E', notes: ['E2', 'B2', 'E3', 'G#3', 'B3', 'E4'], root: 4,
    about: 'Strums an E major chord; same shapes as open D, a tone higher. A favourite for slide (Duane Allman). Raises three strings, so tension goes up.',
    sources: ['weissman2006', 'sethares'] },
  { id: 'open-d', category: 'open', name: 'Open D (Vestapol)', notes: ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'], root: 2,
    about: 'D major across the strings, called “Vestapol” by early blues players. Lower tension than open E, deep and resonant for slide and fingerstyle.',
    sources: ['weissman2006', 'sethares'] },
  { id: 'open-g', category: 'open', name: 'Open G (Spanish / Taropatch)', notes: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'], root: 7,
    about: 'G major with the root on the 5th string. Called “Spanish” in Delta blues and “Taropatch” in Hawaiian slack key; Keith Richards plays it with the 6th string removed.',
    sources: ['weissman2006', 'sethares', 'winston'] },
  { id: 'open-a', category: 'open', name: 'Open A', notes: ['E2', 'A2', 'E3', 'A3', 'C#4', 'E4'], root: 9,
    about: 'Open G shapes a tone higher. High tension; many players capo open G at the 2nd fret instead.',
    sources: ['weissman2006', 'sethares'] },
  { id: 'open-c', category: 'open', name: 'Open C', notes: ['C2', 'G2', 'C3', 'G3', 'C4', 'E4'], root: 0,
    about: 'A huge, low C major chord. Needs a heavier 6th string; the 5th and 6th strings drop a long way.',
    sources: ['sethares'] },
  { id: 'open-dm', category: 'open', name: 'Open D minor (cross-note)', notes: ['D2', 'A2', 'D3', 'F3', 'A3', 'D4'], root: 2, minor: true,
    about: 'Open D with the third lowered to F. The “cross-note” tuning of Skip James’ haunting Bentonia blues.',
    sources: ['weissman2006', 'sethares'] },
  { id: 'open-gm', category: 'open', name: 'Open G minor', notes: ['D2', 'G2', 'D3', 'G3', 'Bb3', 'D4'], root: 7, minor: true,
    about: 'Open G with the B lowered to B♭.',
    sources: ['sethares'] },

  // ── Modal ──────────────────────────────────────────────────────────────
  { id: 'dadgad', category: 'modal', name: 'DADGAD (D modal)', notes: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'], root: 2,
    about: 'D suspended fourth: neither major nor minor, so melodies in either mode ring against open drones. Popularised by Davy Graham in the early 1960s, central to Celtic guitar and Pierre Bensusan; Led Zeppelin’s “Kashmir”.',
    sources: ['weissman2006', 'sethares'] },
  { id: 'modal-g', category: 'modal', name: 'G modal (Gsus4)', notes: ['D2', 'G2', 'D3', 'G3', 'C4', 'D4'], root: 7,
    about: 'Open G with the B raised to C — the DADGAD idea built on G.',
    sources: ['sethares'] },

  // ── Slack key ──────────────────────────────────────────────────────────
  { id: 'g-wahine', category: 'slack', name: 'G Wahine', notes: ['D2', 'G2', 'D3', 'F#3', 'B3', 'D4'], root: 7,
    about: 'Taropatch with the 3rd string lowered to F♯, the major seventh. “Wahine” tunings include a major seventh.',
    sources: ['winston'] },
  { id: 'c-wahine', category: 'slack', name: 'C Wahine (Leonard’s C)', notes: ['C2', 'G2', 'D3', 'G3', 'B3', 'D4'], root: 0,
    about: 'Taropatch with the bass strings dropped to C and G: a Cmaj9 colour with no third on the open strings.',
    sources: ['winston'] },
  { id: 'mauna-loa-c', category: 'slack', name: 'Mauna Loa C', notes: ['C2', 'G2', 'E3', 'G3', 'A3', 'E4'], root: 0,
    about: 'A C6 chord with the sixth (A) and third (E) on the top strings — the high, close-voiced pair that defines the Mauna Loa family.',
    sources: ['winston'] },
  { id: 'atta-c', category: 'slack', name: 'C major (Atta’s C)', notes: ['C2', 'G2', 'E3', 'G3', 'C4', 'E4'], root: 0,
    about: 'Open C major with the third in the middle, associated with Atta Isaacs.',
    sources: ['winston'] },

  { id: 'open-c6', category: 'slack', name: 'C6 (CGCGAE)', notes: ['C2', 'G2', 'C3', 'G3', 'A3', 'E4'], root: 0,
    about: 'A C6 chord borrowed from Hawaiian steel guitar; Winston lists it as the “C6” slack-key tuning, and many fingerstyle songwriters use it.',
    sources: ['winston', 'sethares'] },

  // ── Regular ────────────────────────────────────────────────────────────
  { id: 'all-fourths', category: 'regular', name: 'All fourths', notes: ['E2', 'A2', 'D3', 'G3', 'C4', 'F4'], shape: null,
    about: 'Standard with the G–B third removed: every chord and scale shape is identical on every string set, like a bass guitar. Used by Stanley Jordan.',
    sources: ['sethares', 'griewank2010'] },
  { id: 'major-thirds', category: 'regular', name: 'Major thirds', notes: ['E2', 'G#2', 'C3', 'E3', 'G#3', 'C4'], shape: null,
    about: 'Every string a major third apart, so the pattern repeats every three strings and chords need at most four frets. Pioneered by Ralph Patt in 1964; Griewank (2010) argues it makes reading music on the fretboard simpler, and Anderson et al. (2015) found novices learned chords faster on a major-thirds grid.',
    sources: ['griewank2010', 'anderson2015', 'sethares'] },
  { id: 'all-fifths', category: 'regular', name: 'All fifths (mandoguitar)', notes: ['C2', 'G2', 'D3', 'A3', 'E4', 'B4'], shape: null,
    about: 'Fifths like a mandolin, violin or cello: wide range from C2 to B4, but the top B4 needs a very light string.',
    sources: ['sethares', 'griewank2010'] },
  { id: 'nst', category: 'regular', name: 'New Standard Tuning (NST)', notes: ['C2', 'G2', 'D3', 'A3', 'E4', 'G4'], shape: null,
    about: 'Robert Fripp’s 1983 tuning, taught through Guitar Craft: all fifths with the top string lowered to G to avoid breakage, giving open-voiced fifths and a minor third on top.',
    sources: ['tamm1990', 'sethares'] },
  { id: 'aug-fourths', category: 'regular', name: 'Augmented fourths', notes: ['C2', 'F#2', 'C3', 'F#3', 'C4', 'F#4'], shape: null,
    about: 'Tritones between every string; only two pitch classes open. A theoretical curiosity that repeats every two strings.',
    sources: ['sethares'] },

  // ── Historical and instrumental ────────────────────────────────────────
  { id: 'lute', category: 'historic', name: 'Lute / vihuela (G string to F♯)', notes: ['E2', 'A2', 'D3', 'F#3', 'B3', 'E4'], shape: null,
    about: 'Moves the major third down a string pair (fourth, fourth, third, fourth, fourth) to match the Renaissance lute and vihuela, so tablature transcribes directly.',
    sources: ['weissman2006'] },
  { id: 'dobro-g', category: 'historic', name: 'Resonator high G (Dobro)', notes: ['G2', 'B2', 'D3', 'G3', 'B3', 'D4'], root: 7,
    about: 'The standard square-neck resonator tuning: a G major chord with the third in the bass register.',
    sources: ['sethares'] },

  // ── Songwriter tunings ─────────────────────────────────────────────────
  { id: 'cgcfce', category: 'artist', name: 'CGCFCE (Nick Drake)', notes: ['C2', 'G2', 'C3', 'F3', 'C4', 'E4'], shape: null,
    about: 'One of Nick Drake’s signature tunings (for example “Pink Moon”): a low C drone with a suspended F and a major third on top.',
    sources: ['weissman2006'] },
  { id: 'pelican', category: 'artist', name: 'Pelican (DADEAD)', notes: ['D2', 'A2', 'D3', 'E3', 'A3', 'D4'], shape: null,
    about: 'A Dsus2 drone with a whole-tone rub between the 3rd and 4th strings. Catalogued by Sethares among tunings popularised by singer-songwriters.',
    sources: ['sethares'] },
  { id: 'magic-farmer', category: 'artist', name: 'Magic Farmer (CFCGAE)', notes: ['C2', 'F2', 'C3', 'G3', 'A3', 'E4'], shape: null,
    about: 'An Fmaj9-flavoured open tuning with a fourth in the bass; another songwriter tuning from Sethares’ catalogue.',
    sources: ['sethares'] },
];

export function findTuning(id) {
  return TUNINGS.find((t) => t.id === id) || null;
}
