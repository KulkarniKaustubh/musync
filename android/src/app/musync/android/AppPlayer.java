package app.musync.android;

import android.app.SearchManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.media.MediaMetadata;
import android.media.browse.MediaBrowser;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Bundle;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.provider.Settings;

import app.musync.core.Room;

import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Plays whole songs by driving the host's own music app.
 *
 * Every Android music app that works with car screens and voice assistants
 * accepts a standard "play this search" command through its media session.
 * With notification access, musync can find that session, send the command for
 * each song in the queue, watch the playback position, and tell the room when
 * the song is over. The music itself comes from the host's own account in
 * their own app; musync never touches the audio.
 *
 * All work happens on one background thread.
 */
final class AppPlayer implements Room.Player {
    /** Music app id (as used by the web client) to Android package and display name. */
    private static final Map<String, String[]> APPS = new HashMap<String, String[]>();
    static {
        APPS.put("spotify", new String[] {"com.spotify.music", "Spotify"});
        APPS.put("apple", new String[] {"com.apple.android.music", "Apple Music"});
        APPS.put("ytm", new String[] {"com.google.android.apps.youtube.music", "YouTube Music"});
        APPS.put("tidal", new String[] {"com.aspiro.tidal", "Tidal"});
        APPS.put("amazon", new String[] {"com.amazon.mp3", "Amazon Music"});
        APPS.put("deezer", new String[] {"deezer.android.app", "Deezer"});
        APPS.put("soundcloud", new String[] {"com.soundcloud.android", "SoundCloud"});
    }

    private static final int IDLE = 0, STARTING = 1, PLAYING = 2;
    private static final long POLL_MS = 600;

    private final Context ctx;
    private final Handler h;
    private volatile Room room;
    private volatile boolean foreground;

    // Touched only on the player thread.
    private String key;
    private Map<String, Object> song;
    private boolean paused;
    private String app = "";
    private MediaController controller;
    private MediaBrowser browser;
    private int phase = IDLE;
    private long commandAt;
    private boolean sent, warned, polling;
    private String trackId;
    private long duration;
    // How the current song is being started, kept so a failure can say what was tried.
    private int step;              // 0 structured search sent, 1 plain search sent, 2 app opened with the song
    private int requests;
    private String beforeId;       // what the app had loaded before we asked
    private boolean viaBrowser;
    /** Apps that ignored search requests through their session; for these, go straight to opening them. */
    private final java.util.Set<String> ignoresSession = new java.util.HashSet<String>();

    AppPlayer(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        HandlerThread t = new HandlerThread("musync-player");
        t.start();
        h = new Handler(t.getLooper());
    }

    static String packageOf(String appId) {
        String[] a = APPS.get(appId);
        return a == null ? null : a[0];
    }

    static String nameOf(String appId) {
        String[] a = APPS.get(appId);
        return a == null ? "your music app" : a[1];
    }

    /** True once the user has granted notification access to musync. */
    static boolean hasAccess(Context c) {
        try {
            String on = Settings.Secure.getString(c.getContentResolver(), "enabled_notification_listeners");
            return on != null && on.contains(c.getPackageName() + "/");
        } catch (Exception e) {
            return false;
        }
    }

    void setForeground(boolean fg) { foreground = fg; }

    /** Whether this phone can play songs in the given installed music app right now. */
    @Override
    public String check(String appId) {
        String pkg = packageOf(appId);
        if (pkg == null || !installed(pkg)) return "no-app";
        return hasAccess(ctx) ? "ok" : "no-access";
    }

    void seek(final String k, final long ms) {
        h.post(new Runnable() { public void run() {
            if (k == null || !k.equals(key) || controller == null) return;
            try { controller.getTransportControls().seekTo(ms); } catch (RuntimeException ignored) { }
        } });
    }

    /** Stops the sound and forgets the room; used when the host switches to the built-in web player. */
    void stop() {
        h.post(new Runnable() { public void run() {
            if (key != null || phase != IDLE) pauseApp();
            dropController();
            key = null;
            song = null;
            phase = IDLE;
            room = null;
            app = "\u0000"; // not a real app, so the next real choice is treated as a change
        } });
    }

    @Override
    public void seek(Room r, String k, long ms) { seek(k, ms); }

    @Override
    public void apply(final Room r, final String k, final Map<String, Object> s, final boolean p, final String a, final boolean force) {
        h.post(new Runnable() { public void run() { handle(r, k, s, p, a, force); } });
    }

    // ---------- player thread ----------

    /** Access was taken away, or something else changed under us: have the room ask again. */
    private void checkMode() {
        Room r = room;
        if (r != null) {
            try { r.playerRecheck(); } catch (RuntimeException ignored) { }
        }
    }

    private boolean installed(String pkg) {
        try {
            ctx.getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void handle(Room r, String k, Map<String, Object> s, boolean p, String a, boolean force) {
        room = r;
        if (a == null) a = "";
        if (!a.equals(app)) {
            // The host switched music apps: stop the old one, then see whether the new one can be used.
            if (key != null) pauseApp();
            app = a;
            dropController();
            key = null;
            phase = IDLE;
        }
        if (k == null) {
            if (key != null || phase != IDLE) pauseApp();
            key = null;
            song = null;
            phase = IDLE;
            return;
        }
        if (!k.equals(key) || force) {
            key = k;
            song = s;
            paused = p;
            startSong();
            return;
        }
        if (p != paused) {
            paused = p;
            MediaController c = controller;
            if (c != null) {
                try {
                    if (p) c.getTransportControls().pause(); else c.getTransportControls().play();
                } catch (RuntimeException ignored) { }
            }
        }
    }

    private void startSong() {
        phase = STARTING;
        commandAt = SystemClock.elapsedRealtime();
        sent = false;
        warned = false;
        trackId = null;
        duration = 0;
        step = 0;
        requests = 0;
        beforeId = null;
        viaBrowser = false;
        status("starting", "Starting in " + nameOf(app));
        String pkg = packageOf(app);
        MediaController c = findSession(pkg);
        if (c != null) {
            controller = c;
            try {
                MediaMetadata md = c.getMetadata();
                beforeId = md == null ? null : idOf(md);
            } catch (RuntimeException ignored) { }
            if (ignoresSession.contains(app) && foreground) {
                step = 2;
                openWithSong(pkg);
            } else {
                send(c);
            }
        } else {
            connectBrowser(pkg);
        }
        if (!polling) {
            polling = true;
            h.postDelayed(poll, POLL_MS);
        }
    }

    /** The standard "play from search" request, with the song described as precisely as the format allows. */
    private Bundle describe() {
        Bundle b = new Bundle();
        String title = str(song.get("title")), artist = str(song.get("artist")), album = str(song.get("album"));
        b.putString(MediaStore.EXTRA_MEDIA_FOCUS, "vnd.android.cursor.item/audio");
        b.putString(MediaStore.EXTRA_MEDIA_TITLE, title);
        b.putString(MediaStore.EXTRA_MEDIA_ARTIST, artist);
        if (album.length() > 0) b.putString(MediaStore.EXTRA_MEDIA_ALBUM, album);
        b.putString(SearchManager.QUERY, query());
        return b;
    }

    private String query() {
        return (str(song.get("title")) + " " + str(song.get("artist"))).trim();
    }

    private void send(MediaController c) {
        try {
            c.getTransportControls().playFromSearch(query(), describe());
            sent = true;
            requests++;
        } catch (RuntimeException e) {
            status("failed", nameOf(app) + " refused the request (" + e.getClass().getSimpleName() + ").");
        }
    }

    /** An app that is already running has a session we can talk to straight away. */
    private MediaController findSession(String pkg) {
        if (pkg == null) return null;
        try {
            MediaSessionManager msm = (MediaSessionManager) ctx.getSystemService(Context.MEDIA_SESSION_SERVICE);
            List<MediaController> all = msm.getActiveSessions(new ComponentName(ctx, MediaAccessService.class));
            for (MediaController c : all) if (pkg.equals(c.getPackageName())) return c;
        } catch (SecurityException e) {
            // access was taken away while we were running
            checkMode();
        } catch (RuntimeException ignored) { }
        return null;
    }

    /** An app that is not running can be woken through the same door car screens use. */
    private void connectBrowser(final String pkg) {
        dropBrowser();
        final String forKey = key;
        try {
            Intent service = new Intent("android.media.browse.MediaBrowserService").setPackage(pkg);
            List<ResolveInfo> found = ctx.getPackageManager().queryIntentServices(service, 0);
            if (found == null || found.isEmpty()) { launchOrAsk(pkg); return; }
            ComponentName cn = new ComponentName(pkg, found.get(0).serviceInfo.name);
            browser = new MediaBrowser(ctx, cn, new MediaBrowser.ConnectionCallback() {
                @Override
                public void onConnected() {
                    if (forKey == null || !forKey.equals(key) || browser == null) return;
                    try {
                        controller = new MediaController(ctx, browser.getSessionToken());
                        viaBrowser = true;
                        send(controller);
                    } catch (RuntimeException e) {
                        launchOrAsk(pkg);
                    }
                }

                @Override
                public void onConnectionFailed() {
                    if (forKey != null && forKey.equals(key) && !sent) launchOrAsk(pkg);
                }
            }, null);
            browser.connect();
        } catch (RuntimeException e) {
            launchOrAsk(pkg);
        }
    }

    /**
     * Last resort: ask the music app itself to play the song. That brings it to
     * the front, which Android only allows while musync is on screen.
     */
    private void launchOrAsk(String pkg) {
        if (sent) return;
        if (foreground && openWithSong(pkg)) return;
        status("needs-open", "Open " + nameOf(app) + " once so musync can start songs in it.");
    }

    /**
     * Asks the music app's own screen to play the song, the way a voice
     * assistant does. Returns false if Android or the app would not take it.
     */
    private boolean openWithSong(String pkg) {
        try {
            Intent i = new Intent(MediaStore.INTENT_ACTION_MEDIA_PLAY_FROM_SEARCH);
            i.setPackage(pkg);
            i.putExtras(describe());
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(i);
            sent = true;
            requests++;
            step = 2;
            commandAt = SystemClock.elapsedRealtime(); // the app needs a fresh moment to load
            warned = false;
            status("starting", "Opened " + nameOf(app) + " to start the song. Come back to musync once it plays.");
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }

    /** What the music app is doing, in words, for the message shown when a song will not start. */
    private String report(int state, MediaMetadata md, long pos) {
        String what;
        switch (state) {
            case PlaybackState.STATE_PLAYING: what = "playing"; break;
            case PlaybackState.STATE_PAUSED: what = "paused"; break;
            case PlaybackState.STATE_BUFFERING: what = "loading"; break;
            case PlaybackState.STATE_CONNECTING: what = "connecting"; break;
            case PlaybackState.STATE_ERROR: what = "showing an error"; break;
            case PlaybackState.STATE_STOPPED: what = "stopped"; break;
            case PlaybackState.STATE_NONE: what = "idle"; break;
            default: what = "busy (state " + state + ")";
        }
        String title = md == null ? null : md.getString(MediaMetadata.METADATA_KEY_TITLE);
        String err = "";
        try {
            PlaybackState st = controller == null ? null : controller.getPlaybackState();
            if (st != null && st.getErrorMessage() != null) err = " It says: " + st.getErrorMessage() + ".";
        } catch (RuntimeException ignored) { }
        return nameOf(app) + " is " + what + (title == null ? " with nothing loaded" : " on “" + title + "” at " + (pos / 1000) + "s") + "." + err
            + " (asked " + requests + "×" + (viaBrowser ? ", woke the app" : ", app was running") + (step >= 2 ? ", opened it" : "") + ")";
    }

    private final Runnable poll = new Runnable() {
        public void run() {
            if (key == null) { polling = false; return; }
            try { watch(); } catch (RuntimeException ignored) { }
            h.postDelayed(this, POLL_MS);
        }
    };

    /** Follows the music app: confirms the song started, then spots the moment it ends. */
    private void watch() {
        Room r = room;
        if (r == null || phase == IDLE) return;
        long age = SystemClock.elapsedRealtime() - commandAt;
        if (controller == null) {
            controller = findSession(packageOf(app));
            // The app has just been opened by hand: now it can take the request.
            if (controller != null && !sent) send(controller);
        }
        if (controller == null) {
            if (age > 12000 && !warned) {
                warned = true;
                status("needs-open", "Open " + nameOf(app) + " once so musync can start songs in it.");
            }
            return;
        }
        PlaybackState st = controller.getPlaybackState();
        MediaMetadata md = controller.getMetadata();
        int state = st == null ? PlaybackState.STATE_NONE : st.getState();
        long pos = position(st);

        if (phase == STARTING) {
            boolean playing = state == PlaybackState.STATE_PLAYING;
            String nowIs = md == null ? null : idOf(md);
            boolean changed = nowIs != null && !nowIs.equals(beforeId);
            // Started means: playing, and either it is the song we asked for, or the app
            // moved to a different track than it had before and is near that track's start.
            boolean started = playing && md != null && age > 700
                && (matches(md) || (changed && pos < 20000 && age > 2500) || (beforeId == null && pos < 20000 && age > 4000));
            if (!started && step == 0 && age > 3500 && controller != null) {
                // Some apps only understand a plain search with no extra description.
                step = 1;
                try {
                    controller.getTransportControls().playFromSearch(query(), new Bundle());
                    requests++;
                } catch (RuntimeException ignored) { }
            } else if (!started && step == 1 && age > 7500) {
                // The app is not answering through its session. Ask its own screen instead.
                step = 2;
                ignoresSession.add(app);
                if (!foreground || !openWithSong(packageOf(app))) {
                    warned = true;
                    status("failed", nameOf(app) + " didn’t start the song. Keep musync on screen and tap Try again. " + report(state, md, pos));
                }
                return;
            }
            if (started) {
                phase = PLAYING;
                trackId = idOf(md);
                duration = md.getLong(MediaMetadata.METADATA_KEY_DURATION);
                r.playerStarted(key, duration);
                String actual = md.getString(MediaMetadata.METADATA_KEY_TITLE);
                status("ok", matches(md) || actual == null ? "" : nameOf(app) + " picked “" + actual + "” for this search.");
                if (paused) controller.getTransportControls().pause();
            } else if (age > 15000 && !warned) {
                warned = true;
                status("failed", nameOf(app) + " didn’t start the song. " + report(state, md, pos));
            }
            return;
        }

        // PLAYING
        r.playerProgress(key, pos, md == null ? 0 : md.getLong(MediaMetadata.METADATA_KEY_DURATION));
        String nowId = md == null ? null : idOf(md);
        boolean movedOn = nowId != null && trackId != null && !nowId.equals(trackId);
        boolean nearEnd = duration > 0 && pos >= duration - 900;
        boolean stopped = state == PlaybackState.STATE_STOPPED || state == PlaybackState.STATE_NONE;
        boolean pausedAtEnd = state == PlaybackState.STATE_PAUSED && !paused && duration > 0 && pos >= duration - 3000;
        if (movedOn || nearEnd || stopped || pausedAtEnd) {
            phase = IDLE;
            r.playerEnded(key); // the room answers with the next song, or silence
        }
    }

    private static long position(PlaybackState st) {
        if (st == null) return 0;
        long pos = st.getPosition();
        if (st.getState() == PlaybackState.STATE_PLAYING) {
            float speed = st.getPlaybackSpeed() <= 0 ? 1f : st.getPlaybackSpeed();
            long since = SystemClock.elapsedRealtime() - st.getLastPositionUpdateTime();
            if (since > 0 && since < 3600000) pos += (long) (since * speed);
        }
        return Math.max(0, pos);
    }

    private static String idOf(MediaMetadata md) {
        String id = md.getString(MediaMetadata.METADATA_KEY_MEDIA_ID);
        if (id != null && id.length() > 0) return id;
        return md.getString(MediaMetadata.METADATA_KEY_TITLE) + "|" + md.getString(MediaMetadata.METADATA_KEY_ARTIST);
    }

    /** Loose comparison: apps decorate titles ("Remastered 2011", "feat. ..."). */
    private boolean matches(MediaMetadata md) {
        String want = squash(str(song.get("title"))), got = squash(md.getString(MediaMetadata.METADATA_KEY_TITLE));
        if (want.length() < 2 || got.length() < 2) return false;
        return got.contains(want) || want.contains(got) || (want.length() >= 6 && got.startsWith(want.substring(0, 6)));
    }

    private static String squash(String s) {
        return s == null ? "" : s.toLowerCase(Locale.ROOT).replaceAll("\\(.*?\\)|\\[.*?\\]", "").replaceAll("[^\\p{L}\\p{N}]", "");
    }

    private static String str(Object o) { return o == null ? "" : o.toString(); }

    private void pauseApp() {
        MediaController c = controller != null ? controller : findSession(packageOf(app));
        if (c == null) return;
        try { c.getTransportControls().pause(); } catch (RuntimeException ignored) { }
    }

    private void dropController() {
        controller = null;
        dropBrowser();
    }

    private void dropBrowser() {
        if (browser != null) {
            try { browser.disconnect(); } catch (RuntimeException ignored) { }
            browser = null;
        }
    }

    private void status(String word, String detail) {
        Room r = room;
        if (r != null) {
            try { r.playerStatus(word, detail); } catch (RuntimeException ignored) { }
        }
    }
}
