// WAV export for diagnostic recordings: 16-bit PCM mono, with the app's readings
// stored as JSON in a standard LIST/INFO "ICMT" (comment) chunk so one file carries
// both the sound and what the app made of it.

/** Join clips into one track with short silences between them. */
export function joinClips(clips, sampleRate, gapSec = 0.5) {
  const gap = Math.round(gapSec * sampleRate);
  const total = clips.reduce((n, c) => n + c.length, 0) + gap * Math.max(0, clips.length - 1);
  const out = new Float32Array(total);
  const starts = [];
  let at = 0;
  clips.forEach((c, i) => {
    starts.push(at);
    out.set(c, at);
    at += c.length + (i < clips.length - 1 ? gap : 0);
  });
  return { samples: out, starts };
}

/**
 * Encode mono float samples (−1…1) as a 16-bit PCM WAV.
 * @returns {Uint8Array}
 */
export function encodeWav(samples, sampleRate, { comment } = {}) {
  const enc = new TextEncoder();
  let info = null;
  if (comment) {
    const text = enc.encode(comment);
    const size = text.length + 1;              // NUL-terminated
    const padded = size + (size % 2);          // chunks are word-aligned
    info = { text, size, padded };
  }
  const dataBytes = samples.length * 2;
  const listBytes = info ? 4 + 8 + info.padded : 0; // 'INFO' + ICMT header + text
  const total = 12 + 24 + (info ? 8 + listBytes : 0) + 8 + dataBytes;
  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let p = 0;
  const str = (s) => { for (let i = 0; i < s.length; i++) v.setUint8(p++, s.charCodeAt(i)); };
  const u32 = (x) => { v.setUint32(p, x, true); p += 4; };
  const u16 = (x) => { v.setUint16(p, x, true); p += 2; };
  str('RIFF'); u32(total - 8); str('WAVE');
  str('fmt '); u32(16); u16(1); u16(1); u32(sampleRate); u32(sampleRate * 2); u16(2); u16(16);
  if (info) {
    str('LIST'); u32(listBytes); str('INFO');
    str('ICMT'); u32(info.size);
    u8.set(info.text, p); p += info.text.length;
    v.setUint8(p++, 0);
    if (info.padded > info.size) v.setUint8(p++, 0);
  }
  str('data'); u32(dataBytes);
  for (let i = 0; i < samples.length; i++, p += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(p, Math.round(s * 32767), true);
  }
  return u8;
}

/** Read back a WAV made by encodeWav (used by tests and for diagnosing shared files). */
export function decodeWav(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a WAV file');
  let p = 12, sampleRate = 0, samples = null, comment = null;
  while (p + 8 <= bytes.byteLength) {
    const id = tag(p), size = v.getUint32(p + 4, true), body = p + 8;
    if (id === 'fmt ') sampleRate = v.getUint32(body + 4, true);
    else if (id === 'data') {
      samples = new Float32Array(size / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = v.getInt16(body + i * 2, true) / 32767;
    } else if (id === 'LIST' && tag(body) === 'INFO') {
      let q = body + 4;
      while (q + 8 <= body + size) {
        const sid = tag(q), ssize = v.getUint32(q + 4, true);
        if (sid === 'ICMT') {
          let end = q + 8 + ssize;
          while (end > q + 8 && bytes[end - 1] === 0) end--;
          comment = new TextDecoder().decode(bytes.subarray(q + 8, end));
        }
        q += 8 + ssize + (ssize % 2);
      }
    }
    p = body + size + (size % 2);
  }
  return { sampleRate, samples, comment };
}
