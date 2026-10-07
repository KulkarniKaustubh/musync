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
- **YouTube Music, SoundCloud and Spotify play inside musync.** For these the
  app loads the service's own web player in a hidden web view, finds each
  song by title and artist, plays it, and moves on when it ends. No other app
  opens and no permission is needed. YouTube Music can be signed in to from
  the room screen; SoundCloud needs no account; Spotify only plays once
  signed in. YouTube Music and SoundCloud are confirmed on a phone. Spotify
  (0.6.0) is not yet: its player hides its audio, so musync presses its
  buttons and reads its clock, which is the most fragile of the three. This
  drives other companies' websites by script: it is against their terms, fine
  only for private use, and will break when a site changes.
- **Each song plays in its picker's service.** A song plays in the service the
  person who added it uses, when the host's phone can play that service;
  otherwise in the host's. When the phone can play more than one, the search
  sheet asks which. The room sheet lists what the phone plays.
- **Add from your own playlists (0.7.0).** In the Android app, "Add a song"
  has a "From your library" row. It opens the service's own website inside
  musync, signed in as you, on your phone. Browse to a playlist and tap a
  song: it joins the room's queue instead of playing. The song carries the
  service's own id, so the host's phone opens exactly that track when it can
  play that service, and finds it by title and artist otherwise. Your sign-in
  stays on your phone. Tested against stand-in pages only; which rows count
  as "a song" on each real site is the part most likely to need adjusting.
- **App or browser.** Scanning the room's QR code opens the room in the
  phone's browser, on Android or iPhone: join, search, add, bump. On Android
  the browser offers "Open this room in the app" for people who have musync
  installed and want their own playlists. The room can also be added to a
  phone's home screen from the browser.
- **Steadier, more talkative screens (0.7.1).** The queue only redraws rows
  that changed, so pictures no longer reload and taps are not lost when the
  room updates. Bump, pause, skip and remove respond at once; a short line
  appears when someone else joins or adds a song. In the app, service
  websites that are not on screen are parked off screen so the phone stops
  drawing them, and the bar above a website shows loading and "Added".
- **The clock follows the music.** A song's timer starts when the player
  reports it is audible and is corrected if playback drifts. The host can drag
  through the song.
- **Keeps playing when minimised.** While hosting, the app shows a "room is
  open" notification and keeps the room and the music going in the
  background. Not yet confirmed on a phone.
- **Your own app.** Each person picks the music app they use. Guests get
  "Open in Spotify" (or their app) to hear a song on their own phone.
- **No previews on the phone app.** Until the host allows access, the song
  waits and the app shows the one step that is left. 30-second previews are
  only used when a room is hosted from a browser on the standalone server.
- **One search.** Search does not ask which service to look in. It uses a
  neutral song list (Apple's and Deezer's public catalogs) and the song then
  plays in the host's music app. Spotify and YouTube Music do not offer a
  search that a new app may use.
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

## iPhone

There is no iPhone app. An iPhone joins a room in Safari by scanning the QR
code, and can search, add and bump like anyone else; "Add to Home Screen"
keeps the room as an icon. This has not been run on an iPhone.

What an iPhone app would need, and how the code is laid out for it:

- The whole interface is the web client in `web/`. A shell app only has to
  show it in a web view.
- Everything the client asks of the app goes through one object,
  `window.MusyncNative` (see `Bridge` in `MainActivity.java`): `browsable`,
  `browse`, `browseResult`, `playerKind`, `webSignedIn`, `showWebPlayer`,
  `keepAwake`, `open`. The client works without it and shows more with it.
  An iPhone shell would provide the same object from Swift.
- Browsing a library and playing in a hidden web player are scripts in
  `web/players/` that run inside the service's page. They are not tied to
  Android; iOS web views can run the same scripts.
- Hosting a room on an iPhone is the missing piece: the room server is Java.
  An iPhone could host by pointing the shell at a room server running
  elsewhere, or the server would need porting.
- Building and installing an iPhone app needs a Mac with Xcode and an Apple
  developer account.

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
list the servers they need at the top of each file. `test/players.e2e.mjs`
checks the scripts that read the services' web players, against stand-in
pages: `node test/players.e2e.mjs ../web/players http://localhost:8801/`.
A third argument, a file of the Spotify control scripts dumped from the
Android build, also checks which buttons they press.

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
