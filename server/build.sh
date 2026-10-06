#!/bin/sh
# Builds the standalone server: server/build/syng-server.jar (needs a JDK 8+).
# Run it with:  java -jar build/syng-server.jar [--port 8787] [--lan]
set -eu
cd "$(dirname "$0")"
rm -rf build
mkdir -p build/classes/web
javac -nowarn -Xlint:-options -source 8 -target 8 -d build/classes $(find src -name '*.java')
cp -r ../web/. build/classes/web/
printf 'Main-Class: app.syng.server.Main\n' > build/manifest.txt
jar cfm build/syng-server.jar build/manifest.txt -C build/classes .
ls -l build/syng-server.jar
