# Research notes

What the app borrows from Peterson's strobe tuners, how the measurement works, how the sweetened tunings are derived, the literature behind the tuning library, what research says about better ways to tune, and how the app fits a tuning to one particular guitar.

## 1. Feature parity with the reference tuners

| Feature | Peterson StroboPLUS HDC | Peterson Strobe Center 5000-II | This app |
|---|---|---|---|
| Display | Virtual strobe on an HD colour screen, user-selectable colours | 12 motor-driven analog discs, one per note | Virtual strobe disc, four rings (harmonics 1–4), clockwise = sharp; four light colours |
| Stated accuracy | ±0.1 ¢ | 0.1 ¢ | Strobe readout within ±0.02 ¢ on synthetic strings (table below); real-world limit is the microphone and room |
| Calibration | A4 390–490 Hz | A4 350–550 Hz, global ±50 ¢ | A4 350–550 Hz in 0.1 Hz steps, global ±50 ¢ |
| Sweetened tunings | 180+ presets, custom sweeteners via Peterson Connect | — | Just chord, open-chord fit, measured "GTR"-style, custom (open + 12th fret) |
| Temperaments | — | 8 (EQU, PYT, JMI, 4MT, KLN, KRN, WK3, YNG) + user tables | The same 8, computed from their definitions, any key |
| Guided tunings | Drop, alternate, artist and standard string-number presets | — | 35 tunings in 8 families, auto string detection, headstock guide |
| Harmonic view | Not listed | Chord and overtone viewing | Rings 2–4 show the 2nd–4th harmonics |
| Intonation | Feiten presets with separate 12th-fret values (BFE) | — | 12th-fret mode with saddle directions and per-string 12th-fret targets |
| Reference tone | Not listed (has a metronome) | No speaker | Tone generator at the exact target pitch |
| Capo / transposition | Not listed | Keys of C, B♭, F, E♭ | Capo 0–9 |
| All strings at once | — | — | Strum check: one strum reads all six strings (any tuning; strings whose overtones collide are flagged, not guessed) |
| Per-guitar sweetening | Fixed presets | — | *This guitar (measured)*: four strums give the guitar's fretting error, saddle advice and open-string offsets fitted to it |

Sources: Peterson SC-5000-II product page and instruction manual; StroboPLUS HDC retailer specification (Andertons); Peterson's Buzz Feiten preset page. The app is independent and not affiliated with Peterson Electro-Musical Products.

## 2. How the measurement works

### Note and string recognition — McLeod Pitch Method

Every ~33 ms the last 4096 samples are analysed with the normalised square difference function (McLeod & Wyvill 2005), computed through an FFT. The first key maximum above 0.9 × the highest peak gives the period; a second pass interpolates the NSDF peak at *k* periods and divides by *k* to reduce interpolation error. This is robust against octave errors (tested with a fundamental attenuated to 15 % — typical of phone microphones on the low E) and fast enough for mobile.

The detected frequency is matched to the nearest string target in cents. A string change needs two consecutive agreeing frames, and the current string is kept while it stays within 60 ¢, so the display does not jump between neighbours.

### Fine reading — heterodyne strobe

Once the target is known, the signal is multiplied by complex oscillators at *h*·f<sub>ref</sub> (h = 1…4), low-passed by two one-pole stages (corner max(3 Hz, 0.03·f<sub>ref</sub>)), and the phase of each product is tracked. That phase is exactly the angle of a strobe disc's pattern: constant when in tune, rotating at the beat frequency otherwise. A weighted least-squares slope of the unwrapped phase over 0.35 s gives Δf; if the fundamental is weaker than a quarter of the 2nd harmonic, the 2nd harmonic is used instead.

Because only the band around the fundamental is used, string stiffness does not bias the result. A stiff string's partials sit at *n*·f<sub>0</sub>·√(1 + B n²) (Fletcher 1964), so methods that fit the whole waveform read sharp:

| String | Inharmonicity B | MPM mean error (¢) | MPM worst (¢) | Strobe mean error (¢) | Strobe worst (¢) |
|---|---|---|---|---|---|
| E2 | 2.0e-5 | +0.29 | 0.58 | −0.00 | 0.02 |
| E4 | 2.0e-5 | +0.28 | 0.48 | +0.00 | 0.01 |
| E2 | 6.0e-5 | +0.88 | 1.66 | −0.00 | 0.02 |
| E4 | 6.0e-5 | +0.71 | 1.11 | +0.00 | 0.01 |
| E2 | 1.5e-4 | +2.04 | 3.50 | −0.00 | 0.02 |
| E4 | 1.5e-4 | +1.44 | 2.05 | +0.00 | 0.01 |

Synthetic plucked strings, 48 kHz, −50 dB noise, three detunings each; errors are against the true first partial. Full table: `npm run accuracy` (also printed in every CI run).

## 3. Sweetened tunings — derivations

Peterson describes its sweeteners as "several degrees of harmony or consonance"; the tables themselves are not published. The app builds its sweeteners from stated principles instead, so every number can be checked.

**Equal temperament errors** (Barbour 1951). Relative to pure ratios, ET intervals deviate by: fifth −1.96 ¢, fourth +1.96 ¢, major third +13.69 ¢, minor third −15.64 ¢, major sixth +15.64 ¢, major second +3.91 ¢.

**Just chord** (open, modal, slack-key and resonator tunings). For string *s* at *k* semitones above the declared root:
offset<sub>s</sub> = σ · J(k) − mean, where J is the 5-limit just deviation (1/1, 16/15, 9/8, 6/5, 5/4, 4/3, 45/32, 3/2, 8/5, 5/3, 16/9, 15/8) and σ ∈ [0, 1] is the sweetness. Centring keeps the chord at concert pitch; "root strings" anchoring leaves the roots at 0 instead. At σ = 0.85 DADGAD gives −0.3, +1.4, −0.3, −1.9, +1.4, −0.3 ¢ — close to user measurements of Peterson's DADGAD preset (−0.6, +1.1, −0.6, −1.2, +1.1, −0.6 ¢; UMGF forum).

**Open-chord fit** (standard and drop shapes). Unknowns: six string offsets *o* and a free reference *r<sub>c</sub>* for each of the chords E, A, D, G, C, Em, Am, Dm in first position. Minimise
Σ<sub>c</sub> Σ<sub>s∈c</sub> (o<sub>s</sub> − r<sub>c</sub> − J<sub>cs</sub>)² + λ Σ o<sub>s</sub>², with λ = 3(1 − σ)/σ + 0.05.
Frets are equal-tempered, so one string's offset helps some chords and hurts others. The unregularised optimum is small (|o| < 1.5 ¢, mostly a slightly raised G string), which is a useful finding: open-string offsets alone cannot fix chord intonation on a fretted guitar; Feiten-style systems also move the nut (Feiten 1997), and Varieschi & Gower (2010) show why fretting itself pushes notes sharp.

**Strobe-style GTR (measured).** −2.3, 0, 0, −0.4, −2.1, −2.3 ¢ (6th → 1st), as measured by guitarists from a Peterson StroboFlip and posted on the UMGF forum. Unofficial.

**Custom.** Separate open-string and 12th-fret offsets per string — the structure Peterson uses for its Buzz Feiten presets (BFE, BFA, BF12…), which advise against checking intonation with harmonics because the two targets differ.

**Evidence check.** Listening studies do not support strong sweetening by default: Villegas et al. (2010) measured just-intonation renditions as the roughest and least preferred of three intonations; in Leimu (2017), about 68 % of 34 musicians preferred equal temperament, most likely through familiarity. The app therefore defaults to Equal and keeps the derived sweeteners small.

## 4. Temperaments

Each temperament is generated as a circle of fifths with sizes 700 ¢ + δ (Barbour 1951):

- Pythagorean: 11 pure fifths E♭…G♯, wolf G♯–E♭.
- ¼-comma meantone: fifths narrowed by ¼ syntonic comma (696.58 ¢), wolf G♯–E♭.
- Werckmeister III: C–G, G–D, D–A, B–F♯ narrowed by ¼ Pythagorean comma.
- Kirnberger III: C–G–D–A–E narrowed by ¼ syntonic comma, F♯–C♯ by a schisma.
- Young II: C–G–D–A–E–B–F♯ narrowed by ⅙ Pythagorean comma.
- Kellner: C–G–D–A–E and B–F♯ narrowed by ⅕ Pythagorean comma.
- Just major: 5-limit ratios on the chosen key.

Offsets are normalised so A stays at 0 ¢ (A4 remains the calibration note); the unit tests check Werckmeister III against its published table.

## 5. Tuning literature used for the library

- **Regular tunings.** Sethares' *Alternate Tuning Guide* classifies open, instrumental, regular and "special" tunings and gives chord charts. Griewank (2010) argues for major-thirds tuning on the grounds that the fretboard pattern repeats every three strings, simplifying reading; Anderson et al. (NIME 2015) found that new users learned basic chords markedly faster on a major-thirds grid than on a fourths grid, including users with guitar experience. Fripp's New Standard Tuning (Tamm 1990) stacks fifths with a minor third on top.
- **Slack key.** Tuning families (Taropatch, Wahine, Mauna Loa, Atta's C) follow the Dancing Cat chart compiled by George Winston and Mike McClellan, with Tatar (1979) for history.
- **Songwriting and repertoire.** Jones (2023, University of Birmingham) treats Joni Mitchell's scordatura as part of the music's material; Robson (2023, University of Adelaide) studies how scordatura changes practice and performance on the classical guitar.
- **Compendium.** Weissman (2006) for the standard, lowered, drop and open families.

Every tuning in the app links to its sources; the generated list with frequencies is in [TUNINGS.md](TUNINGS.md).

## 6. Is there a better way to tune? What the literature says

The question behind the *Fit this guitar* feature: since every guitar's compensation is different, can a few measurements of the instrument itself give a better tuning than any fixed preset? The research points in four directions.

**Tune to the instrument's real overtones, not to ideal ratios.** Piano tuners stretch octaves because stiff strings have sharp overtones (Railsback stretch). Giordano (2015) showed that minimising sensory dissonance — the roughness model of Plomp & Levelt (1965) — computed from a piano's *measured* inharmonic partials reproduces the stretch expert tuners choose. Hinrichsen (2012) reached the same curve by minimising the spectral entropy of the summed sound. Jaatinen & Pätynen (2022) confirmed that listeners hear stiff-string tones as higher than their fundamental, so the stretch is perceptual, not just habit. A guitar's strings are far less stiff than a piano's (B ≈ 10⁻⁵–10⁻⁴), but the same principle applies: an optimiser that knows the guitar's real overtones can make shared partials of two strings coincide.

**Correct the fretting error, which is larger than any sweetener.** Varieschi & Gower (2010) model why fretted notes are sharp — the string is stretched when pressed — and how saddle setback and nut height compensate. What remains differs from guitar to guitar and from string to string, typically 1–5 ¢. A fixed sweetener cannot know it; a measurement can. Saddle setback cancels an error that grows like 2^(k/12) − 1 up the neck, nut height one that fades up the neck, so three fretted measurements per string separate the two.

**Read all strings from one strum.** Polyphonic tuners read six strings at once by choosing partials that are not shared between strings (US Patent 9,076,416); the first commercial one, TC Electronic's PolyTune, was specified at about ±1 ¢ in polyphonic mode and handled standard and drop tunings only when reviewed (Sound On Sound 2010). Barbancho et al. (2012) identify which string played a note from its inharmonicity alone. Hodgkinson et al. (2010) measured the pitch glide of a freshly plucked steel string (tension modulation, a few cents decaying in tenths of a second), which is why the analysis waits about half a second after the strum.

**Adaptive just intonation — the ideal a fretted guitar can only approach.** Sethares (1994) and Stange, Wick & Hinrichsen (2018) retune every note while the music plays so each chord is beat-free. With fixed frets that is impossible; the best a guitar can do is a compromise across the chords it is played in, which is what a least-squares fit computes.

**Limits.** Small differences are hard to hear. In Mottola's (2017) blind test, 32 experienced players and builders showed no significant preference among compensation schemes whose worst fretted notes were 1–8 ¢ off; the same fretted note varies with finger pressure from one playing to the next (Mottola 2018). Interval-purity studies find tolerance of several cents for fifths and more for thirds (Hall & Hess 1984; Vos 1986). The app therefore keeps the result small, explains it, and makes saddle adjustment — not open-string offsets — the first fix.

## 7. Fit this guitar — method and accuracy

**Measuring.** The wizard records four strums: open strings, then a barre at frets 2, 7 and 12. Each strum is captured by an onset detector (energy jump ×8 above a −50 dB gate) and analysed from 0.55 s to 2.15 s after the onset:

1. Blackman window, zero-padded FFT.
2. Every partial of every string is predicted from the target pitch and a default stiffness. Partials of different strings closer than the resolvable bandwidth (plus the uncertainty of the estimate) are excluded; in standard tuning this removes the high E and B fundamentals, which coincide with overtones of the low strings, so those strings are read from higher partials.
3. A harmonic-sum scan over ±60 ¢ finds each string coarsely; then a robust (Tukey-weighted) least-squares fit of (f<sub>n</sub>/n)² against n² gives f₀ and the inharmonicity B together.
4. Each string is reported as *ok*, *unsure*, *pluck alone* (its usable partials are all shared — octave-doubled strings in open tunings) or *not heard*.

**Model.** Per string, fretted error Δ(k) = α + β·u(k) + γ·v(k) cents, with u(k) = 2^(k/12) − 1 (saddle-position shape) and v(k) = x₁₂/x<sub>k</sub> − 1 (nut-height shape). Saddle advice δ = β·L/1731 mm removes the slope for scale length L.

**Best tuning.** Open-string offsets o<sub>s</sub> minimise a quadratic cost over the chords of the current tuning family (first-position and barre shapes for standard and drop, open chord plus barres for open tunings):
(1 − g) · Σ (note error vs equal temperament)² + g · Σ w<sub>pq</sub> (partial p of string a − partial q of string b)²,
summing the second term over partial pairs closer than 35 ¢, weighted by their amplitudes measured in the strum. The goal slider g runs from "match other instruments" (g = 0) to "sweetest chords" (g → 1, clamped at 0.97 so absolute pitch stays anchored). Measured stretch and stiffness are rescaled to the current tuning (∝ 1/f²), so one measurement serves several tunings.

**Accuracy on synthetic strums** (stiff strings, −42 dB room noise, a 6 ¢ pitch glide decaying over 0.23 s, ±0.3 ¢ partial jitter; `npm test`):

| Case | Result |
|---|---|
| Standard tuning, strings ±10 ¢ off, 5 trials | all six strings *ok*, within ±0.4 ¢ |
| Drop D, strings up to 40 ¢ off | all within ±0.6 ¢ |
| Open G, open D | *ok* strings within ±0.5 ¢; octave-doubled strings flagged *pluck alone* rather than guessed |
| Barre at frets 2, 7, 12 | fretted error within ±0.4 ¢ |
| Full fit (model vs truth, frets 3–12) | within ±0.35 ¢ |
| In the browser, through Chromium's audio input and resampler | open strings within ±0.1 ¢, fretted errors within ±0.3 ¢; saddle advice within about 0.4 mm |

A real guitar adds finger-pressure variation (Mottola 2018), so strum each barre firmly and repeat if a value looks odd.

## References

- Anderson, H., Lin, K. W. E., Agus, N. & Lui, S. (2015). Major thirds: A better way to tune your iPad. *Proc. NIME 2015*, 365–368. <https://nime.org/proc/nime2015_klin/>
- Barbancho, I., Tardón, L. J., Sammartino, S. & Barbancho, A. M. (2012). Inharmonicity-based method for the automatic generation of guitar tablature. *IEEE Trans. Audio, Speech, and Language Processing* 20(6), 1857–1868. <https://doi.org/10.1109/TASL.2012.2191281>
- Barbour, J. M. (1951). *Tuning and Temperament: A Historical Survey*. Michigan State College Press.
- de Cheveigné, A. & Kawahara, H. (2002). YIN, a fundamental frequency estimator for speech and music. *JASA* 111(4), 1917–1930.
- Feiten, H. B. (1997). Tuning system for stringed instrument. U.S. Patent 5,600,079.
- Fletcher, H. (1964). Normal vibration frequencies of a stiff piano string. *JASA* 36(1), 203–209.
- Giordano, N. (2015). Explaining the Railsback stretch in terms of the inharmonicity of piano tones and sensory dissonance. *JASA* 138(4), 2359–2366. <https://doi.org/10.1121/1.4931439>
- Griewank, A. (2010). Tuning guitars and reading music in major thirds. Matheon Preprint 695, Berlin. <https://nbn-resolving.de/urn:nbn:de:0296-matheon-6755>
- Hall, D. E. & Hess, J. T. (1984). Perception of musical interval tuning. *Music Perception* 2(2), 166–195.
- Hinrichsen, H. (2012). Entropy-based tuning of musical instruments. *Revista Brasileira de Ensino de Física* 34(2), 2301. <https://arxiv.org/abs/1203.5101>
- Hodgkinson, M., Timoney, J. & Lazzarini, V. (2010). A model of partial tracks for tension-modulated steel-string guitar tones. *Proc. DAFx-10*, Graz.
- Jaatinen, J. & Pätynen, J. (2022). Effect of inharmonicity on pitch perception and subjective tuning of piano tones. *JASA* 152(2), 1146–1157. <https://doi.org/10.1121/10.0013572>
- Jones, O. C. F. (2023). *'She's so busy being free': towards a material-analytical approach to Joni Mitchell and her guitar*. MA by Research thesis, University of Birmingham. <https://etheses.bham.ac.uk/id/eprint/14221/>
- Leimu, M. (2017). *Challenging equal temperament: perceived differences between twelve-tone equal temperament and twelve fifth-tones tuning*. Master's thesis, University of Jyväskylä. <https://jyx.jyu.fi/handle/123456789/52642>
- McLeod, P. & Wyvill, G. (2005). A smarter way to find pitch. *Proc. ICMC*, Barcelona.
- Mottola, R. M. (2017). Blind listening evaluation of steel string acoustic guitar compensation strategies. OSF Preprints. <https://osf.io/bqzf4>
- Mottola, R. M. (2018). Same-fretted-note intonation variability of the steel string acoustic guitar. OSF Preprints. <https://osf.io/45mtc>
- Peterson Electro-Musical Products. Strobe Center 5000-II product page and SC-5000 manual. <https://www.petersontuners.com/products/sc5000>
- Peterson Electro-Musical Products. Buzz Feiten sweetened presets. <https://petersontuners.com/myinstrument/buzzFeiten>
- Peterson StroboPLUS HDC specification (Andertons). <https://www.andertons.co.uk/peterson/peterson-stroboplus-portable-strobe-hdc-tuner-metronome>
- Plomp, R. & Levelt, W. J. M. (1965). Tonal consonance and critical bandwidth. *JASA* 38, 548–560. <https://doi.org/10.1121/1.1909741>
- Robson, M. A. (2023). *Scordatura on the Classical Guitar: Implications for Practice and Performance*. PhD thesis, University of Adelaide. <https://digital.library.adelaide.edu.au/items/0e34350e-25be-4fd5-b63f-925f94aa64af>
- Sethares, W. A. (1994). Adaptive tunings for musical scales. *JASA* 96(1), 10–18.
- Sethares, W. A. (2001, rev. 2009). *Alternate Tuning Guide*. University of Wisconsin–Madison. <https://sethares.engr.wisc.edu/alternatetunings/alternatetunings.html>
- Sethares, W. A. (2005). *Tuning, Timbre, Spectrum, Scale* (2nd ed.). Springer.
- Sound On Sound (2010). TC Electronic PolyTune review. <https://www.soundonsound.com/reviews/tc-electronic-polytune>
- Stange, K., Wick, C. & Hinrichsen, H. (2018). Playing music in just intonation: A dynamically adaptive tuning scheme. *Computer Music Journal* 42(3), 47–62. <https://arxiv.org/abs/1706.04338>
- Tamm, E. (1990). *Robert Fripp: From King Crimson to Guitar Craft*. Faber and Faber.
- Tatar, E. (1979). Slack key guitar. In G. S. Kanahele (ed.), *Hawaiian Music and Musicians*.
- UMGF forum, "Tuner Sweetenings" (user measurements of Peterson presets, unofficial). <https://umgf.com/tuner-sweetenings-t75496.html>
- U.S. Patent 9,076,416. Polyphonic tuner. <https://patents.google.com/patent/US9076416B2/en>
- Varieschi, G. U. & Gower, C. M. (2010). Intonation and compensation of fretted string instruments. *American Journal of Physics* 78(1), 47–55. <https://arxiv.org/abs/0906.0127>
- Villegas, J., Cohen, M., Wilson, I. & Martens, W. (2010). Influence of psychoacoustic roughness on musical intonation preference. *AES 128th Convention*, London. <https://u-aizu.ac.jp/~wilson/publications/VillegasEtAl2010AES.pdf>
- Vos, J. (1986). Purity ratings of tempered fifths and major thirds. *Music Perception* 3(3), 221–257.
- Weissman, D. (2006). *Guitar Tunings: A Comprehensive Guide*. Routledge.
- Winston, G. & McClellan, M. Dancing Cat Records, Hawaiian Slack Key Guitar booklet: chart of recorded tunings.
