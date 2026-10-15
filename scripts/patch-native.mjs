// Adds the microphone permissions the tuner needs to the generated native projects.
// Safe to run repeatedly (it only adds what is missing). Run after `npx cap add`.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const MIC_TEXT = 'Strobe Tuner listens to your instrument through the microphone to measure its pitch. Audio never leaves your device.';
let changed = 0;

// Android: the WebView asks for RECORD_AUDIO when the page calls getUserMedia;
// Capacitor's BridgeWebChromeClient requests MODIFY_AUDIO_SETTINGS too.
const manifest = 'android/app/src/main/AndroidManifest.xml';
if (existsSync(manifest)) {
  let xml = readFileSync(manifest, 'utf8');
  for (const perm of ['android.permission.RECORD_AUDIO', 'android.permission.MODIFY_AUDIO_SETTINGS']) {
    if (!xml.includes(perm)) {
      xml = xml.replace(/<\/manifest>\s*$/, `    <uses-permission android:name="${perm}" />\n</manifest>\n`);
      changed++;
    }
  }
  if (!xml.includes('android.hardware.microphone')) {
    xml = xml.replace(/<\/manifest>\s*$/, '    <uses-feature android:name="android.hardware.microphone" android:required="true" />\n</manifest>\n');
    changed++;
  }
  writeFileSync(manifest, xml);
  console.log(`Android manifest: ${manifest}`);
} else {
  console.log('No android/ project yet (run `npm run android:add`).');
}

// iOS: WKWebView needs a usage string or the app is killed when it opens the mic.
const plist = 'ios/App/App/Info.plist';
if (existsSync(plist)) {
  let xml = readFileSync(plist, 'utf8');
  if (!xml.includes('NSMicrophoneUsageDescription')) {
    xml = xml.replace(/<\/dict>\s*<\/plist>\s*$/, `\t<key>NSMicrophoneUsageDescription</key>\n\t<string>${MIC_TEXT}</string>\n</dict>\n</plist>\n`);
    changed++;
  }
  writeFileSync(plist, xml);
  console.log(`iOS Info.plist: ${plist}`);
} else {
  console.log('No ios/ project yet (run `npm run ios:add`).');
}
console.log(changed ? `Added ${changed} permission entr${changed === 1 ? 'y' : 'ies'}.` : 'Permissions already present.');
