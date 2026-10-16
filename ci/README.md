# ci/

`debug.keystore` signs the Android test builds that the **Android APK** workflow
publishes to GitHub Releases. Using the same key on every build lets a newer APK
install over an older one.

It is a debug key (store and key password `android`, alias `androiddebugkey`),
so it is deliberately public. Do not use it for a Google Play release: create a
private upload key for that and keep it in a repository secret.
