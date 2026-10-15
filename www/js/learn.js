// Text for the Learn tab. Plain data so it can be rendered without a framework.

export const ARTICLES = [
  {
    id: 'strobe',
    title: 'Reading the strobe',
    body: [
      'The disc has four rings. The inner ring follows the string’s fundamental; the outer three follow its 2nd, 3rd and 4th harmonics. When the string matches the target, every ring stands still.',
      'A ring turning clockwise means the string is sharp: loosen it. Anticlockwise means flat: tighten it. The speed is the size of the error — the outer rings turn two, three and four times faster than the inner one, so they show the last tenth of a cent.',
      'Under the hood the app does what a mechanical strobe does with a spinning disc: it multiplies the signal by an oscillator at the target pitch and watches the phase of what is left (heterodyning). The phase drift is the beat between string and target, measured over a third of a second, which gives sub-cent resolution without the bin limits of an FFT tuner.',
      'In tests on synthetic plucked strings with realistic stiffness and background noise, the strobe reading stayed within a few hundredths of a cent of the true fundamental, while a conventional autocorrelation estimate read 0.3–2 ¢ sharp — more for stiffer strings. Stiff strings push their overtones sharp (Fletcher 1964), and methods that use the whole waveform inherit that bias. The app uses the McLeod Pitch Method (McLeod & Wyvill 2005) only to recognise the note and the string, then hands over to the strobe. With a real microphone, room noise and the pitch drift of a decaying string set the practical limit, so watch the outer rings settle rather than trusting a single number.',
    ],
  },
  {
    id: 'sweeten',
    title: 'Why sweeten a tuning?',
    body: [
      'Equal temperament makes every key identical by spreading the Pythagorean comma over all twelve fifths. The price: a major third is 13.7 ¢ wider than a pure 5:4, a minor third 15.6 ¢ narrower than 6:5, and a fifth 2 ¢ narrower than 3:2 (Barbour 1951). Open-string chords make these differences easy to hear as beating.',
      'A guitar adds its own error. Pressing a string to a fret stretches it, so fretted notes come out sharp — more with high action, heavy strings or a firm grip. Varieschi & Gower (2010) model this and show why saddles and nuts need setback compensation.',
      'Sweetened tunings answer both with small per-string offsets. Peterson’s StroboPLUS HDC ships over 180 presets; the Buzz Feiten system pairs open-string offsets with separate 12th-fret targets and a shifted nut (Feiten 1997).',
      'Two cautions. First, listening studies do not show a universal preference for pure intervals: Villegas et al. (2010) found just-intonation renditions the roughest and least preferred, and in Leimu (2017) about 68 % of musicians preferred equal temperament, most likely from familiarity. Second, frets are equal-tempered: this app’s open-chord fit finds that the best the six open strings can do for the common first-position chords is under 1.5 ¢ per string. Keep sweeteners gentle and let your ears decide.',
      'The just-chord sweetener is stronger because an open tuning is one chord: at 85 % sweetness it gives DADGAD offsets of −0.3, +1.4, −0.3, −1.9, +1.4, −0.3 ¢, close to the values players have measured from Peterson’s DADGAD preset (−0.6, +1.1, −0.6, −1.2, +1.1, −0.6).',
    ],
  },
  {
    id: 'tunings',
    title: 'Families of tunings',
    body: [
      'Standard tuning stacks fourths with a single major third between the G and B strings; lowered standards keep the shapes and change the pitch. Drop tunings lower only the 6th string for a root-and-fifth power chord under one finger.',
      'Open tunings sound a chord on the open strings, which suits slide and drone-based fingerstyle. Modal tunings such as DADGAD leave out the third so the same open strings work for major and minor melodies. Hawaiian slack-key players catalogue dozens of open tunings under family names — Taropatch, Wahine, Mauna Loa (Winston; Tatar 1979).',
      'Regular tunings use one interval everywhere, so every shape moves freely across strings (Sethares 2001). All-fourths is the closest to standard. Major thirds repeat every three strings; Griewank (2010) argues it simplifies reading, and Anderson et al. (2015) found novices learned chords faster on a major-thirds grid. Robert Fripp’s New Standard Tuning stacks fifths (Tamm 1990).',
      'Tunings also shape composition: Jones (2023) reads Joni Mitchell’s many open tunings as part of the music’s material rather than a convenience, and Robson (2023) studies how scordatura changes practice and performance on the classical guitar.',
    ],
  },
  {
    id: 'intonation',
    title: 'Setting intonation with the 12th fret',
    body: [
      'Turn on 12th-fret mode on the Tune tab. Tune the open string, then play the same string at the 12th fret (not the harmonic — Feiten-style sweeteners use different targets for the two).',
      'If the fretted note is sharp, the vibrating length is too short: move that string’s saddle away from the neck. If it is flat, move the saddle toward the neck. Retune the open string and repeat until both read still.',
    ],
  },
];

export const LEARN_REFS = [
  'fletcher1964', 'mcleod2005', 'decheveigne2002', 'barbour1951', 'sethares2005', 'varieschi2010', 'feiten1997',
  'petersonHDC', 'petersonSC5000', 'petersonFeiten', 'umgf', 'villegas2010', 'leimu2017', 'winston', 'sethares',
  'griewank2010', 'anderson2015', 'tamm1990', 'weissman2006', 'jones2023', 'robson2023',
];
