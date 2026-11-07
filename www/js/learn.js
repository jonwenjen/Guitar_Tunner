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
      'Every guitar plays fretted notes a little sharp, and by a different amount on each string: pressing a string onto a fret stretches it, more with high action, heavy strings or a stiff core (Varieschi & Gower 2010). The saddle setback cancels most of it at the 12th fret; what is left differs from one guitar to the next. “Measure a guitar” on the Sweeten tab records the open strings and a barre at frets 2, 7 and 12, each strummed several times, keeps the median of every string so one bad strum cannot skew it, and fits each string’s error curve.',
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
  {
    id: 'design',
    title: 'How a steel-string guitar holds its shape',
    body: [
      'Six steel strings pull on a guitar with roughly 70 kg in total (a set of 12-53 lights in standard tuning — see Sweeten → Strings). The neck resists that pull with a truss rod, the top resists it with braces and a hardwood bridge plate under the bridge, and the joint between them sets the neck angle. Every playing property — action, buzz, intonation — follows from how these parts sit, and all of them move slowly with string tension, humidity and age.',
      'Relief. A neck under string tension bows forward a little. A small, even bow — 0.15 to 0.30 mm at the 7th–8th fret on an acoustic (StewMac) — gives a vibrating string room to swing without touching the frets in the middle of the neck. The truss rod sets it: tightening straightens the neck, loosening lets it bow. It adjusts relief, not action, although the action follows.',
      'Nut and saddle. The strings rest on the nut at one end and the saddle at the other. The nut sets the action at the first frets: a slot cut too high makes the first frets hard to press and sharp, too low makes the open string buzz (MusicNomad gives 0.50 mm above the 1st fret on the bass side and 0.40 mm on the treble). The saddle sets the action higher up: because the 12th fret is halfway, the saddle must move twice as far as the action at the 12th fret (Haze Guitars). The saddle also sits a few millimetres behind the theoretical scale length — the compensation that cancels the sharpening caused by pressing a string to a fret (Varieschi & Gower 2010).',
      'Neck angle. The neck is set at a slight angle so that the plane of the fret tops meets the top of the bridge, which leaves room for a saddle standing about 2.5–4 mm proud (Keith 2022; Joe’s Vintage Guitars). Over decades the string pull rotates the neck forward and bulges the top behind the bridge: the fret plane drops below the bridge top, the action rises and the saddle runs out of height. The fix is a neck reset — the luthier removes the neck and recuts the heel. Glued necks are steamed off; bolt-on necks are simpler.',
      'Humidity. Wood swells and shrinks with moisture, mostly across the grain. Taylor Guitars recommends keeping guitars at 45–55 % relative humidity. A dry guitar shows low action, a top sunk between bridge and soundhole, fret ends sticking out of a shrunken fingerboard, a hump where the neck meets the body and a fret plane above the bridge; a wet one shows high action, a swollen top and a dull sound. Solid wood moves more than laminate, so solid-top and all-solid guitars need the closest care.',
    ],
  },
  {
    id: 'checkup',
    title: 'How the check-up works',
    body: [
      'The check-up follows the order in which a technician sets up a guitar, because each step changes the next (Haze Guitars): first the guitar at normal humidity with settled strings, then the relief, then the nut, then the saddle height, and only then the intonation. A finding further down the list is provisional until those above it are fixed — the app says so when, for example, the relief is out of range and the action is high.',
      'From each measurement the app works out what to change. Relief outside the target gives a truss-rod direction in 1/8-turn steps (StewMac). Action above the target gives the amount to take off the bottom of the saddle — twice the change at the 12th fret — and how much saddle would remain. Nut height above the target gives the depth to file. The action targets follow Martin’s factory range at the 12th fret (2.38–2.78 mm bass, 1.59–1.98 mm treble), shifted down for a light touch or up for hard strumming and slide.',
      'The strobe measurement adds what a ruler cannot see. Its 12th-fret error per string tells how far each string’s break point on the saddle should move (1731/L cents per millimetre). Because higher action stretches a fretted string more, the app first predicts how the planned action change moves that error — about 0.6 ¢ per 0.1 mm on the 6th string with light strings — and gives saddle compensation only for what remains. More than about 1 mm is beyond what reshaping a 3 mm saddle can do and calls for a compensated saddle or a recut slot. Extra sharpness at the first frets points at the nut.',
      'A neck reset is the decision with the most at stake, so the app proposes it only when three things agree: the action is too high, a straightedge on the frets hits the front of the bridge below its top, and lowering the saddle enough would leave less than about 2.5 mm above the bridge. With only some of these it says what to check next. Shaving the bridge is a cheaper alternative some shops offer, at the cost of a weaker bridge and less string drive on the top (Keith 2022); on a laminate guitar a reset can cost more than the instrument.',
      'Some findings always go to a luthier: a bridge lifting at its back edge (a slip of paper slides under it — Ford), cracks, a truss rod with no adjustment left, and a pronounced belly with high action. The check-up cannot see inside the guitar or judge glue joints, so treat it as preparation for a visit: it tells you what to ask, and lets you see whether an adjustment worked.',
      'The three built-in guitars start from published data where it exists. The Yamaha APX-4A is a thinline cutaway with a 634 mm scale, an under-saddle piezo pickup and the truss rod at the headstock. The Stanford Performer PSOM-20 is an all-solid OM (Sitka spruce, rosewood, ebony, bone nut and saddle, scalloped forward-shifted X bracing) from the Chinese-made Performer line. Truetone does not publish the GC-8CSS specs, so it starts from typical grand-concert values. Values no source confirms are marked with an asterisk: measure them and correct them.',
    ],
  },
];

export const LEARN_REFS = [
  'fletcher1964', 'mcleod2005', 'decheveigne2002', 'barbour1951', 'sethares2005', 'varieschi2010', 'feiten1997',
  'petersonHDC', 'petersonSC5000', 'petersonFeiten', 'umgf', 'villegas2010', 'leimu2017', 'winston', 'sethares',
  'griewank2010', 'anderson2015', 'tamm1990', 'weissman2006', 'jones2023', 'robson2023',
  'giordano2015', 'hinrichsen2012', 'jaatinen2022', 'plomp1965', 'sethares1994', 'stange2018', 'barbancho2012',
  'hodgkinson2010', 'polytune', 'polyPatent', 'mottola2017', 'mottola2018', 'hallhess1984', 'vos1986',
  // String catalog (Sweeten → Strings): where each set's gauges and the tension check came from.
  'stringsDaddarioEJ16', 'stringsDaddarioEJ11', 'stringsDaddario', 'stringsDaddarioEZ', 'stringsElixir', 'stringsElixir8020',
  'stringsMartin', 'stringsErnieBall', 'stringsGibson', 'stringsDR',
  // Guitar check-up: setup standards and the built-in guitars.
  'taylorDry', 'taylorWet', 'stewmacRelief', 'martinSC13E', 'martinAction', 'musicnomadNut', 'hazeSaddle', 'joesReset',
  'keith2022', 'fordBridge', 'yamahaAPX4aBentley', 'yamahaAPX4aCME', 'yamahaAPX', 'stanfordPSOM20', 'stanfordPSRD20',
  'stanfordOrigin', 'truetoneGM1CSS', 'truetoneGM1C',
];
