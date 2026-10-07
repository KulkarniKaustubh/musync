package app.musync.android;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import app.musync.core.Json;
import app.musync.core.Room;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Plays whole songs in a music service's own web player, kept inside musync.
 *
 * Each service has its own web view that normally sits out of sight behind
 * musync's screen. For each song musync opens the service's search for
 * "title artist", takes the first song it lists, opens that song so it plays,
 * and watches the page's audio to follow its position and know when it ends.
 * Pause, skip and moving through the song in musync act on that page. The
 * person only sees the web player when they ask to, for example to sign in.
 *
 * musync reads the page by asking it a fixed question a few times a second
 * (the service's "probe" script, in assets/web/players); the page is given no
 * way to call into the app.
 *
 * Everything here runs on the main thread, where Android requires web views
 * to be used.
 */
final class WebPlayer implements Room.Player {
    /** What differs from one music service to the next. */
    abstract static class Site {
        final String id, name, home, probeFile;
        Site(String id, String name, String home, String probeFile) {
            this.id = id; this.name = name; this.home = home; this.probeFile = probeFile;
        }
        abstract String searchUrl(String query);
        /** The address that plays one search result. */
        abstract String playUrl(String pick, String localBase);
        /** JavaScript for "pause", "play" or "seek" (with a position in milliseconds). */
        abstract String command(String what, long ms);
        /** Fallback when the search page lists nothing readable: JavaScript that presses its first play button, or null. */
        String clickFirst() { return null; }
        /** "in", "out", or "none" when the service plays without an account. */
        String signedIn() { return "none"; }
    }

    static final Site YOUTUBE_MUSIC = new Site("ytm", "YouTube Music", "https://music.youtube.com/", "ytm.probe.js") {
        String searchUrl(String q) { return home + "search?q=" + Uri.encode(q); }
        String playUrl(String pick, String localBase) { return home + "watch?v=" + pick; }
        String command(String what, long ms) {
            String act = what.equals("pause") ? "v.pause()" : what.equals("play") ? "v.play()"
                : "v.currentTime=" + String.format(Locale.ROOT, "%.3f", ms / 1000.0);
            return "var v=document.querySelector('video');if(v){" + act + ";}";
        }
        String clickFirst() {
            return "var b=document.querySelector('ytmusic-responsive-list-item-renderer ytmusic-play-button-renderer,"
                + " ytmusic-card-shelf-renderer ytmusic-play-button-renderer');if(b)b.click();";
        }
        String signedIn() {
            try {
                String c = CookieManager.getInstance().getCookie(home);
                return c != null && (c.contains("SAPISID=") || c.contains("LOGIN_INFO=")) ? "in" : "out";
            } catch (RuntimeException e) {
                return "out";
            }
        }
    };

    static final Site SOUNDCLOUD = new Site("soundcloud", "SoundCloud", "https://m.soundcloud.com/", "soundcloud.probe.js") {
        String searchUrl(String q) { return home + "search/sounds?q=" + Uri.encode(q); }
        // SoundCloud's own embeddable player, on a page that ships with musync.
        String playUrl(String pick, String localBase) { return localBase + "players/soundcloud.html?track=" + Uri.encode(pick); }
        String command(String what, long ms) { return "if(window.__mp_cmd)window.__mp_cmd('" + what + "'," + ms + ");"; }
    };

    /** A web view that keeps saying it is on screen, so the page does not stop the music when musync is minimised. */
    private static final class AlwaysVisible extends WebView {
        AlwaysVisible(Context c) { super(c); }
        @Override
        protected void onWindowVisibilityChanged(int visibility) {
            super.onWindowVisibilityChanged(View.VISIBLE);
        }
    }

    private static final long POLL_MS = 700;
    private static final int IDLE = 0, SEARCH = 1, LOAD = 2, PLAYING = 3;

    final Site site;
    private final WebView web;
    private final String probe;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private volatile String localBase = "http://127.0.0.1:8787/";

    private Room room;
    private String key;
    private Map<String, Object> song;
    private boolean paused;
    private int phase = IDLE;
    private long phaseAt;
    private String pick;
    private boolean polling, warned, clicked, nudged, announcedAd;

    @SuppressLint("SetJavaScriptEnabled")
    WebPlayer(Context ctx, Site site) {
        this.site = site;
        this.probe = read(ctx, "web/players/" + site.probeFile);
        web = new AlwaysVisible(ctx.getApplicationContext());
        web.setBackgroundColor(Color.parseColor("#101011"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false); // the next song must start with nobody tapping
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // Present as the phone's ordinary browser. Music sites send embedded browsers to their app instead.
        String agent = s.getUserAgentString();
        if (agent != null) s.setUserAgentString(agent.replace("; wv", "").replaceAll("Version/\\d+\\.\\d+ ", ""));
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true); // sign-in passes through the account site
        web.setWebViewClient(new WebViewClient() {
            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                // Stay on the web: links that try to jump into an installed app are ignored.
                return !(url.startsWith("https://") || url.startsWith("http://"));
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                // Protected audio needs the page to be allowed to use the phone's media keys. Nothing else is granted.
                for (String r : request.getResources()) {
                    if (PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID.equals(r)) {
                        request.grant(new String[] {PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID});
                        return;
                    }
                }
                request.deny();
            }
        });
    }

    private static String read(Context ctx, String asset) {
        try {
            InputStream in = ctx.getAssets().open(asset);
            try {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                return out.toString("UTF-8");
            } finally {
                in.close();
            }
        } catch (Exception e) {
            return "JSON.stringify({error:'musync could not load its page reader'})";
        }
    }

    WebView view() { return web; }

    /** Where musync's own pages are served on this phone. */
    void setLocalBase(String base) { localBase = base; }

    /** Shows the service's front page when nothing is loaded yet, so there is something to sign in to. */
    void ensureLoaded() {
        String url = web.getUrl();
        if (phase == IDLE && (url == null || url.length() == 0 || url.startsWith("about:") || url.startsWith(localBase))) web.loadUrl(site.home);
    }

    /** Stops the sound; used when the next song belongs to a different player. */
    void stop() {
        ui.post(new Runnable() { public void run() {
            if (phase != IDLE) js(site.command("pause", 0));
            key = null;
            song = null;
            phase = IDLE;
        } });
    }

    @Override
    public String check(String app) { return site.id.equals(app) ? "ok" : "no-app"; }

    @Override
    public void seek(Room r, final String k, final long ms) {
        ui.post(new Runnable() { public void run() {
            if (k != null && k.equals(key) && phase == PLAYING) js(site.command("seek", ms));
        } });
    }

    @Override
    public void apply(final Room r, final String k, final Map<String, Object> s, final boolean p, String app, final boolean force) {
        ui.post(new Runnable() { public void run() { handle(r, k, s, p, force); } });
    }

    private void handle(Room r, String k, Map<String, Object> s, boolean p, boolean force) {
        room = r;
        if (k == null) {
            if (key != null || phase != IDLE) js(site.command("pause", 0));
            key = null;
            song = null;
            phase = IDLE;
            return;
        }
        if (!k.equals(key) || force) {
            key = k;
            song = s;
            paused = p;
            start();
            return;
        }
        if (p != paused) {
            paused = p;
            if (phase == PLAYING || phase == LOAD) js(site.command(p ? "pause" : "play", 0));
        }
    }

    private void start() {
        phase = SEARCH;
        phaseAt = SystemClock.elapsedRealtime();
        pick = null;
        warned = false;
        clicked = false;
        nudged = false;
        announcedAd = false;
        status("starting", "Finding the song in " + site.name);
        String q = (str(song.get("title")) + " " + str(song.get("artist"))).trim();
        web.loadUrl(site.searchUrl(q));
        if (!polling) {
            polling = true;
            ui.postDelayed(poll, POLL_MS);
        }
    }

    private final Runnable poll = new Runnable() {
        public void run() {
            if (key == null || phase == IDLE) { polling = false; return; }
            final String forKey = key;
            try {
                web.evaluateJavascript(probe, new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (forKey.equals(key)) {
                            try { watch(parse(value)); } catch (RuntimeException ignored) { }
                        }
                    }
                });
            } catch (RuntimeException ignored) { }
            ui.postDelayed(this, POLL_MS);
        }
    };

    /** The page answers with a string holding JSON; Android wraps that string in quotes once more. */
    private static Map<String, Object> parse(String value) {
        if (value == null || value.equals("null")) return null;
        Object inner = Json.read(value);
        if (!(inner instanceof String)) return null;
        return Json.obj(Json.read((String) inner));
    }

    private void watch(Map<String, Object> p) {
        Room r = room;
        if (r == null || p == null || phase == IDLE) return;
        long age = SystemClock.elapsedRealtime() - phaseAt;
        boolean has = Boolean.TRUE.equals(p.get("has")), isPaused = Boolean.TRUE.equals(p.get("paused"));
        boolean ad = Boolean.TRUE.equals(p.get("ad")), ended = Boolean.TRUE.equals(p.get("ended"));
        boolean onSearch = Boolean.TRUE.equals(p.get("search"));
        long t = Json.num(p.get("t")), d = Json.num(p.get("d"));

        if (phase == SEARCH) {
            List<Object> picks = Json.arr(p.get("picks"));
            if (onSearch && picks != null && !picks.isEmpty()) {
                pick = str(picks.get(0));
                phase = LOAD;
                phaseAt = SystemClock.elapsedRealtime();
                status("starting", "Starting in " + site.name);
                web.loadUrl(site.playUrl(pick, localBase));
                return;
            }
            if (age > 7000 && !clicked && onSearch && Json.num(p.get("rows")) > 0 && site.clickFirst() != null) {
                // Results are there but not as links we can read: press the first one's play button.
                clicked = true;
                phase = LOAD;
                phaseAt = SystemClock.elapsedRealtime();
                js(site.clickFirst());
                return;
            }
            if (age > 20000 && !warned) {
                warned = true;
                status("failed", site.name + "’s search didn’t show any songs. " + report(p));
            }
            return;
        }

        if (phase == LOAD) {
            if (ad) {
                if (!announcedAd) { announcedAd = true; status("starting", site.name + " is playing an ad first"); }
                phaseAt = SystemClock.elapsedRealtime(); // the song's own clock starts after the ad
                return;
            }
            if (has && !isPaused && t > 300) {
                phase = PLAYING;
                if (pick == null) pick = str(p.get("playing"));
                r.playerStarted(key, d);
                r.playerProgress(key, t, d);
                status("ok", "");
                if (paused) js(site.command("pause", 0));
                return;
            }
            if (has && isPaused && age > 4000 && !nudged) {
                nudged = true;
                js(site.command("play", 0));
            }
            if (age > 20000 && !warned) {
                warned = true;
                status("failed", site.name + " didn’t start the song. " + report(p));
            }
            return;
        }

        // PLAYING
        if (ad) return;
        String playing = str(p.get("playing"));
        boolean movedOn = pick != null && pick.length() > 0 && playing.length() > 0 && !playing.equals(pick);
        boolean atEnd = ended || (d > 0 && t >= d - 900);
        if (movedOn || atEnd) {
            // The web player would carry on with its own suggestions; the room decides what is next.
            js(site.command("pause", 0));
            phase = IDLE;
            r.playerEnded(key);
            return;
        }
        r.playerProgress(key, t, d);
    }

    /** What the page looked like, in words, for the message shown when a song will not start. */
    private static String report(Map<String, Object> p) {
        if (p.get("error") != null) return "(" + str(p.get("error")) + ")";
        String href = str(p.get("href"));
        String where;
        try {
            Uri u = Uri.parse(href);
            where = String.valueOf(u.getHost()) + String.valueOf(u.getPath());
        } catch (RuntimeException e) {
            where = href;
        }
        List<Object> picks = Json.arr(p.get("picks"));
        return String.format(Locale.ROOT, "(page: %s; songs listed: %d; links: %d; player: %s%s)", where,
            picks == null ? 0 : picks.size(), Json.num(p.get("rows")),
            !Boolean.TRUE.equals(p.get("has")) ? "none" : Boolean.TRUE.equals(p.get("paused")) ? "paused" : "playing",
            Boolean.TRUE.equals(p.get("ad")) ? ", ad" : "");
    }

    private void js(String code) {
        try { web.evaluateJavascript("(function(){try{" + code + "}catch(e){}})()", null); } catch (RuntimeException ignored) { }
    }

    private static String str(Object o) { return o == null ? "" : o.toString(); }

    private void status(String word, String detail) {
        Room r = room;
        if (r != null) {
            try { r.playerStatus(word, detail); } catch (RuntimeException ignored) { }
        }
    }
}
