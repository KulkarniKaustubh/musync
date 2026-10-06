# syng

One shared music queue that everyone in the room adds to from their own phone.

## What works

- **Live rooms.** One phone starts a room. Everyone on the same Wi-Fi joins by
  QR code, link or 4-character code, from the app or any browser. The queue
  updates on every device as it changes.
- **Real search.** Songs, artists and cover art come from two public catalogs
  that need no account or key: Apple's iTunes Search API and Deezer's search
  API.
- **Sound.** The host's phone is the speaker and plays each song's 30-second
  preview. Anyone else can turn sound on for their own device.
- **Your own app.** Each person picks the music app they use. "Open in
  Spotify" (or Apple Music, YouTube Music, Tidal, Amazon Music, Deezer,
  SoundCloud) opens the full song there.
- **Queue rules.** Anyone can add and bump. The host can pause, skip and remove
  any song. You can skip or remove your own. If the host leaves, the person who
  has been there longest becomes host.

## What does not work, and why

- **Full songs inside the room.** The streaming services do not let a new app
  play full tracks from a person's account (see `PRODUCT.md`). Previews are
  what the catalogs offer freely.
- **Rooms across the internet from the phone app.** A phone can only serve
  people on its own network. For friends who are apart, run the standalone
  server somewhere they can all reach (below).
- **Background hosting.** The room runs while the host's app is open; the app
  keeps the screen on while hosting. If the host's phone sleeps or the app is
  closed, the room stops.

## Not yet tested

Everything in "What works" is covered by automated tests on a computer, using
a built-in sample catalog. Three things could not be run in the build
environment and need a first try on real devices: the Android app itself, the
two live catalog calls, and finding a host by 4-character code across two
phones. QR code and link joining do not depend on that last one.

## Install the Android app

Install `syng.apk`. It is signed with a self-made key for sideloading, not for
the Play Store, so Android will ask you to allow installs from your browser or
file manager. It needs Android 6 or newer and asks for one permission, network
access. Uninstall the earlier "syng prototype" app if you installed it.

## Run the server on a computer

```sh
java -jar syng-server.jar            # many rooms, for hosting on the internet
java -jar syng-server.jar --lan      # one room, like the phone app
```

Then open the address it prints. Options: `--port 8787`, `--web <folder>` to
serve the client from disk while developing, `--sample-catalog` to search a
small built-in list with no internet.

## Build

```sh
sh server/build.sh     # server/build/syng-server.jar   (needs a JDK)
sh android/build.sh    # android/build/syng.apk
```

The Android build uses Ubuntu's packaged tools instead of Gradle:
`sudo apt-get install aapt apksigner zipalign android-sdk-platform-23 dalvik-exchange`.

## Test

```sh
cd server && sh build.sh
javac -cp build/classes -d /tmp/t test/CoreTest.java && java -cp build/classes:/tmp/t CoreTest
java -jar build/syng-server.jar --port 8801 --sample-catalog &
node test/rooms.e2e.mjs        # needs Playwright; drives a host and two guests
```

## What is where

- `web/` the client: plain HTML, CSS and JavaScript, no build step
- `server/` the room server: plain Java, no dependencies. `core/` is shared
  with the Android app
- `android/` the Android app: one screen that starts the server and shows the client
- `PRODUCT.md` what the product is and what is still undecided
- `DESIGN.md` the visual system
- `.claude/skills/impeccable/` the Impeccable design skill, v4.5.0, Apache 2.0,
  by Paul Bakaus (https://github.com/pbakaus/impeccable)

## Privacy and safety notes

- The phone app serves the room over plain http to its local network. Anyone on
  that Wi-Fi who has the address can join.
- Searches go from the host's device to Apple and Deezer. Cover art and preview
  audio load directly from their servers on each device.
- No accounts, no analytics, nothing stored on a server beyond the room while
  it is open.
