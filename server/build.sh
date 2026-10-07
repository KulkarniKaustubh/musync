#!/bin/sh
# Builds the standalone server: server/build/musync-server.jar (needs a JDK 8+).
# Run it with:  java -jar build/musync-server.jar [--port 8787] [--lan]
set -eu
cd "$(dirname "$0")"
rm -rf build
mkdir -p build/classes/web
javac -nowarn -Xlint:-options -source 8 -target 8 -d build/classes $(find src -name '*.java')
cp -r ../web/. build/classes/web/
printf 'Main-Class: app.musync.server.Main\n' > build/manifest.txt
jar cfm build/musync-server.jar build/manifest.txt -C build/classes .
ls -l build/musync-server.jar
