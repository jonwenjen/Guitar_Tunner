// Hand a file to the user: the system share sheet in the native app and on phones
// (so it can go straight to LINE, mail or Files), a normal download on desktops.

function nativePlugin(name) {
  const cap = window.Capacitor;
  if (!cap || !cap.isNativePlatform?.()) return null;
  if (cap.isPluginAvailable && !cap.isPluginAvailable(name)) return null;
  return cap.Plugins?.[name] || cap.registerPlugin?.(name) || null;
}

function toBase64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(s);
}

/**
 * @param {Uint8Array|string} data  file contents
 * @param {string} filename
 * @param {string} mime
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function shareFile(data, filename, mime, { title = filename } = {}) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const fs = nativePlugin('Filesystem');
  const share = nativePlugin('Share');
  if (fs && share) {
    // Capacitor shares files from the cache folder by default.
    const { uri } = await fs.writeFile({ path: filename, data: toBase64(bytes), directory: 'CACHE' });
    try {
      await share.share({ title, files: [uri], dialogTitle: title });
      return 'shared';
    } catch (e) {
      return 'cancelled';
    }
  }
  const blob = new Blob([bytes], { type: mime });
  const touch = window.matchMedia?.('(pointer: coarse)').matches;
  if (touch && typeof File !== 'undefined' && navigator.canShare) {
    const file = new File([blob], filename, { type: mime });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return 'shared';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'cancelled';
        // Otherwise fall through to a download.
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'downloaded';
}

/** Ask the user for a file and return its text (resolves null if they cancel). */
export function pickTextFile(accept = '.json,application/json') {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    let done = false;
    const finish = (v) => { if (!done) { done = true; input.remove(); resolve(v); } };
    input.addEventListener('change', async () => {
      const f = input.files && input.files[0];
      finish(f ? await f.text() : null);
    });
    input.addEventListener('cancel', () => finish(null));
    input.click();
  });
}

/** File-name friendly local timestamp, e.g. 20261019-1830. */
export function stamp(d = new Date()) {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
}
