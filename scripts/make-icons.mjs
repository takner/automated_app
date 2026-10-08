// Generates the PWA icons from an inline SVG (simple sun-over-horizon mark).
import sharp from 'sharp';
import path from 'node:path';

const out = path.resolve(import.meta.dirname, '..', 'public', 'icons');
const mark = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="#0f766e"/>
  <g transform="translate(256 256) scale(${pad ? 0.72 : 1}) translate(-256 -256)">
    <circle cx="256" cy="268" r="92" fill="#fdf6e3"/>
    <rect x="96" y="300" width="320" height="34" rx="17" fill="#0f766e"/>
    <rect x="96" y="300" width="320" height="18" rx="9" fill="#fdf6e3"/>
    <rect x="150" y="352" width="212" height="18" rx="9" fill="#fdf6e3" opacity="0.75"/>
    <rect x="204" y="392" width="104" height="18" rx="9" fill="#fdf6e3" opacity="0.5"/>
  </g>
</svg>`;
const jobs = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
  ['badge-96.png', 96, false],
];
for (const [name, size, pad] of jobs) {
  await sharp(Buffer.from(mark(pad))).resize(size, size).png().toFile(path.join(out, name));
}
console.log('icons written');
