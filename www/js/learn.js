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
    id: 'fit',
    title: 'Fit this guitar',
    body: [
      'Every guitar plays fretted notes a little sharp, and by a different amount on each string: pressing a string onto a fret stretches it, more with high action, heavy strings or a stiff core (Varieschi & Gower 2010). The saddle setback cancels most of it at the 12th fret; what is left differs from one guitar to the next. “Measure a guitar” on the Sweeten tab records four strums — the open strings, then a barre at frets 2, 7 and 12 — and fits each string’s error curve.',
      'One strum is enough to read six strings because each string’s overtones fall in different places. The analyser predicts every overtone of every string, ignores the ones two strings share — in standard tuning the high E and B fundamentals sit on overtones of the low strings, so they are read from higher overtones — and fits each string’s pitch and stiffness together. Barbancho et al. (2012) use the same inharmonicity relations to tell guitar strings apart, and polyphonic tuner designs pick partials to avoid shared harmonics. The first commercial polyphonic tuner, reviewed in 2010, quoted about ±1 cent and handled standard and drop tunings only; here any tuning works, but octave-doubled strings in open tunings are flagged “pluck alone” rather than guessed.',
      'The best tuning for that guitar is then a least-squares problem. Each open string gets an offset so that, across the chords played in the current tuning, fretted and open notes land closest to equal temperament — or, with the goal slider towards “sweetest chords”, so that overtones shared by two strings beat as little as possible. Using the guitar’s own slightly sharp overtones follows piano research: minimising sensory dissonance (Giordano 2015) or spectral entropy (Hinrichsen 2012) with an instrument’s real overtones reproduces the stretched tuning expert tuners choose, and listeners do hear stiff-string tones as higher (Jaatinen & Pätynen 2022). The saddle advice removes the slope of the error, so after moving a saddle, measure again.',
      'Keep expectations realistic. In a blind test with 32 experienced players and builders, Mottola (2017) found no significant preference between compensation schemes whose worst fretted notes were 1 to 8 cents off, and the same fretted note changes with finger pressure from one playing to the next (Mottola 2018). Fully adaptive just intonation, which retunes every chord as it is played (Sethares 1994; Stange, Wick & Hinrichsen 2018), needs an instrument whose pitch can move; on frets it can only be approximated. Fix the saddle first; the offsets polish what remains.',
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
  'giordano2015', 'hinrichsen2012', 'jaatinen2022', 'plomp1965', 'sethares1994', 'stange2018', 'barbancho2012',
  'hodgkinson2010', 'polytune', 'polyPatent', 'mottola2017', 'mottola2018', 'hallhess1984', 'vos1986',
];
