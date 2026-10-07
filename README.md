# musync

One shared music queue that everyone in the room adds to from their own phone.

## What works

- **Live rooms.** One phone starts a room. Everyone on the same Wi-Fi joins by
  QR code, link or 4-character code, from the app or any browser. The queue
  updates on every device as it changes.
- **Real search.** Songs, artists and cover art come from two public catalogs
  that need no account or key: Apple's iTunes Search API and Deezer's search
  API.
- **Whole songs, in the host's own music app.** The host's phone starts each
  song in the music app the host chose (Spotify, Apple Music, YouTube Music,
  Tidal, Amazon Music, Deezer or SoundCloud), from the host's own account, and
  moves to the next song when it ends. Pause and skip in musync control that
  app. See "Whole songs" below for the one-time setup.
- **Your own app.** Each person picks the music app they use. Guests get
  "Open in Spotify" (or their app) to hear a song on their own phone.
- **Previews as a fallback.** Until the host allows access, or when the room is
  hosted from a browser, the host's device plays each song's 30-second preview.
- **Queue rules.** Anyone can add and bump. The host can pause, skip and remove
  any song. You can skip or remove your own. If the host leaves, the person who
  has been there longest becomes host.

## What does not work, and why

- **Whole songs on every phone at once.** Only the host's phone plays. Guests
  who are apart open the song in their own app; it is not kept in time.
- **Exact matches every time.** musync asks the music app to play "title, artist"
  by search, the same way a voice assistant does. The app may pick a different
  version; musync shows what the app actually started.
- **Spotify Free.** Spotify only plays a chosen song on demand for Premium
  accounts. On Free it plays something related.
- **Rooms across the internet from the phone app.** A phone can only serve
  people on its own network. For friends who are apart, run the standalone
  server somewhere they can all reach (below).
- **Background hosting.** The room runs while the host's app is open; the app
  keeps the screen on while hosting. If the host's phone sleeps or the app is
  closed, the room stops.

## Not yet tested

The room, the queue, joining by link and code, and the whole-song flow (using a
stand-in player) are covered by automated tests on a computer. These could not
be run in the build environment and need a first try on real devices:

- the Android app itself, including how it finds the phone's Wi-Fi address
- starting songs in each real music app. This is the least certain part: each
  app answers "play this search" in its own way
- the two live catalog calls

If a song does not start, the line under the song says what happened. That
text is the useful thing to report.

## Install the Android app

Install `musync.apk`. It is signed with a self-made key for sideloading, not for
the Play Store, so Android will ask you to allow installs from your browser or
file manager. It needs Android 6 or newer. The app was called "syng" before
version 0.3.1; it installs alongside that one, so uninstall "syng" first.

## Whole songs: one-time setup on the host's phone

1. Start a room and pick your music app.
2. Tap **Allow access** on the "Play whole songs" card and switch musync on.
   Android calls this "notification access". It is the only way Android lets
   one app control another app's playback. musync does not read notifications.
3. If Android says the setting is restricted (Android 13 and newer do this for
   apps installed from a file): tap **Open musync's settings**, tap the three
   dots at the top right, tap **Allow restricted settings**, then do step 2
   again.
4. Add a song. If the music app has not been opened since the phone started,
   musync opens it once to wake it up.

## Run the server on a computer

```sh
java -jar musync-server.jar            # many rooms, for hosting on the internet
java -jar musync-server.jar --lan      # one room, like the phone app
```

Then open the address it prints. Options: `--port 8787`, `--web <folder>` to
serve the client from disk while developing, `--sample-catalog` to search a
small built-in list with no internet, `--test-player ready` to stand in for
the phone's music app when testing.

## Build

```sh
sh server/build.sh     # server/build/musync-server.jar   (needs a JDK)
sh android/build.sh    # android/build/musync.apk
```

The Android build uses Ubuntu's packaged tools instead of Gradle:
`sudo apt-get install aapt apksigner zipalign android-sdk-platform-23 dalvik-exchange`.

## Test

```sh
cd server && sh build.sh
javac -cp build/classes -d /tmp/t test/CoreTest.java && java -cp build/classes:/tmp/t CoreTest
java -jar build/musync-server.jar --port 8801 --sample-catalog &
node test/rooms.e2e.mjs        # needs Playwright; drives a host and two guests
```

`test/lan.e2e.mjs` (joining over Wi-Fi) and `test/full.e2e.mjs` (whole songs)
list the servers they need at the top of each file.

## What is where

- `web/` the client: plain HTML, CSS and JavaScript, no build step
- `server/` the room server: plain Java, no dependencies. `core/` is shared
  with the Android app
- `android/` the Android app: starts the server, shows the client, and drives
  the host's music app (`AppPlayer.java`)
- `PRODUCT.md` what the product is and what is still undecided
- `DESIGN.md` the visual system
- `.claude/skills/impeccable/` the Impeccable design skill, v4.5.0, Apache 2.0,
  by Paul Bakaus (https://github.com/pbakaus/impeccable)

## Privacy and safety notes

- The phone app serves the room over plain http to its local network. Anyone on
  that Wi-Fi who has the address can join.
- Searches go from the host's device to Apple and Deezer. Cover art and preview
  audio load directly from their servers on each device.
- Notification access is used only to find and control the music app's
  playback. musync's notification listener is empty and reads nothing.
- No accounts, no analytics, nothing stored on a server beyond the room while
  it is open.
