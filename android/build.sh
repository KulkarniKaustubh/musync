#!/bin/sh
# Builds the syng prototype APK without Gradle, using the Android tools that
# Ubuntu packages:
#   sudo apt-get install aapt apksigner zipalign android-sdk-platform-23 dalvik-exchange
# Needs a JDK (javac, keytool). Output: android/build/syng-prototype.apk
set -eu
cd "$(dirname "$0")"
JAR="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"
OUT=build
rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/obj" "$OUT/assets/web"

# The web prototype is the app: copy it in as assets.
cp -r ../web/. "$OUT/assets/web/"

aapt package -f -m -J "$OUT/gen" -M AndroidManifest.xml -S res -I "$JAR"
javac -nowarn -source 8 -target 8 -bootclasspath "$JAR" -d "$OUT/obj" \
  $(find src "$OUT/gen" -name '*.java')
dalvik-exchange --dex --output="$OUT/classes.dex" "$OUT/obj"
aapt package -f -M AndroidManifest.xml -S res -A "$OUT/assets" -I "$JAR" -F "$OUT/unaligned.apk"
(cd "$OUT" && aapt add unaligned.apk classes.dex >/dev/null)
zipalign -f 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"

# A self-signed key for sideloading. Keep the same file to install updates
# over an earlier build. This is not a Play Store release key.
KEY=syng-prototype.keystore
[ -f "$KEY" ] || keytool -genkeypair -keystore "$KEY" -storepass syngprototype -keypass syngprototype \
  -alias syng -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=syng prototype" >/dev/null 2>&1
apksigner sign --ks "$KEY" --ks-pass pass:syngprototype --key-pass pass:syngprototype \
  --out "$OUT/syng-prototype.apk" "$OUT/aligned.apk"
apksigner verify --verbose "$OUT/syng-prototype.apk" | head -5
ls -l "$OUT/syng-prototype.apk"
