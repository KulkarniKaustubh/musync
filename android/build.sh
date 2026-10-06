#!/bin/sh
# Builds the syng Android app without Gradle, using the Android tools that
# Ubuntu packages:
#   sudo apt-get install aapt apksigner zipalign android-sdk-platform-23 dalvik-exchange
# Needs a JDK (javac, keytool). Output: android/build/syng.apk
set -eu
cd "$(dirname "$0")"
JAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
OUT=build
rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/obj" "$OUT/assets/web"

# The web client ships inside the app; the room server serves it from there.
cp -r ../web/. "$OUT/assets/web/"

aapt package -f -m -J "$OUT/gen" -M AndroidManifest.xml -S res -I "$JAR"
# The server core (../server/src/app/syng/core) is plain Java shared with the standalone server.
javac -nowarn -Xlint:-options -source 8 -target 8 -bootclasspath "$JAR" -d "$OUT/obj" \
  $(find src "$OUT/gen" ../server/src/app/syng/core -name '*.java')
dalvik-exchange --dex --output="$OUT/classes.dex" "$OUT/obj"
aapt package -f -M AndroidManifest.xml -S res -A "$OUT/assets" -I "$JAR" -F "$OUT/unaligned.apk"
(cd "$OUT" && aapt add unaligned.apk classes.dex >/dev/null)
zipalign -f 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"

# A self-signed key for sideloading. Keep the same file to install updates
# over an earlier build. This is not a Play Store release key.
KEY=syng.keystore
[ -f "$KEY" ] || keytool -genkeypair -keystore "$KEY" -storepass syngsideload -keypass syngsideload \
  -alias syng -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=syng" >/dev/null 2>&1
apksigner sign --ks "$KEY" --ks-pass pass:syngsideload --key-pass pass:syngsideload \
  --out "$OUT/syng.apk" "$OUT/aligned.apk"
apksigner verify --verbose "$OUT/syng.apk" | head -4
ls -l "$OUT/syng.apk"
