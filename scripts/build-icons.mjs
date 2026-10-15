// Renders the PNG icons from the SVG masters. Run: node scripts/build-icons.mjs
// Needs `sharp` (npm i -D sharp).
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const out = 'www/icons';
mkdirSync('assets', { recursive: true });
const jobs = [
  ['www/icons/icon.svg', `${out}/icon-180.png`, 180],
  ['www/icons/icon.svg', `${out}/icon-192.png`, 192],
  ['www/icons/icon.svg', `${out}/icon-512.png`, 512],
  ['www/icons/icon-maskable.svg', `${out}/icon-maskable-512.png`, 512],
  // Sources for `npx @capacitor/assets generate` (native app icons and splash).
  ['www/icons/icon-maskable.svg', 'assets/icon-only.png', 1024],
];
for (const [src, dest, size] of jobs) {
  await sharp(src, { density: 384 }).resize(size, size).png().toFile(dest);
  console.log('wrote', dest);
}
// Adaptive icon: the disc on a transparent layer over a plain walnut layer.
const disc = await sharp('www/icons/icon-maskable.svg', { density: 384 }).resize(1024, 1024).png().toBuffer();
const transparentDisc = await sharp(disc).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { data, info } = transparentDisc;
for (let i = 0; i < data.length; i += 4) {
  // Walnut background pixels (#3a2517) become transparent in the foreground layer.
  if (Math.abs(data[i] - 0x3a) < 6 && Math.abs(data[i + 1] - 0x25) < 6 && Math.abs(data[i + 2] - 0x17) < 6) data[i + 3] = 0;
}
await sharp(data, { raw: info }).png().toFile('assets/icon-foreground.png');
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#3a2517' } }).png().toFile('assets/icon-background.png');
// Splash: the disc centred on walnut.
const small = await sharp('www/icons/icon-maskable.svg', { density: 384 }).resize(900, 900).png().toBuffer();
for (const name of ['splash.png', 'splash-dark.png']) {
  await sharp({ create: { width: 2732, height: 2732, channels: 4, background: '#3a2517' } })
    .composite([{ input: small, gravity: 'center' }]).png().toFile(`assets/${name}`);
}
console.log('wrote assets/ (icon-only, icon-foreground, icon-background, splash, splash-dark)');
