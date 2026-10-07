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
        /** True when nothing plays until the person has signed in. */
        boolean needsAccount() { return false; }
        /** Where signing in starts, or null to use the front page. */
        String signInUrl() { return null; }
        /** True for players built for computer screens: they get a computer-sized page while out of sight. */
        boolean desktop() { return false; }
        /** JavaScript run while a song's page loads, to press its play button once; null when songs start by themselves. */
        String startJs() { return null; }
        /** How long a song may take to become audible before musync says it did not start. */
        long startTimeoutMs() { return 20000; }
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

    /**
     * Spotify's web player is built for computer browsers and only plays from a
     * signed-in account. Its audio element is kept out of the page, so musync
     * works its visible controls: the song page's play button, the play/pause
     * button and the progress bar.
     */
    static final Site SPOTIFY = new Site("spotify", "Spotify", "https://open.spotify.com/", "spotify.probe.js") {
        String searchUrl(String q) { return home + "search/" + Uri.encode(q) + "/tracks"; }
        String playUrl(String pick, String localBase) { return home + "track/" + pick; }
        boolean needsAccount() { return true; }
        boolean desktop() { return true; }
        long startTimeoutMs() { return 35000; }
        String signInUrl() { return "https://accounts.spotify.com/login?continue=" + Uri.encode(home); }
        String signedIn() {
            try {
                String c = CookieManager.getInstance().getCookie(home);
                return c != null && c.contains("sp_dc=") ? "in" : "out";
            } catch (RuntimeException e) {
                return "out";
            }
        }
        String startJs() {
            // Press the song page's own play button, once. If nothing moves after a while, allow one more press.
            return "var S=window.__musync||(window.__musync={});"
                + "if(location.pathname.indexOf('/track/')<0)return;"
                + "if(S.clicked&&!S.adv&&Date.now()-S.clickedAt>9000&&(S.tries||0)<2){S.clicked=false;}"
                + "if(S.clicked)return;"
                + "var b=document.querySelector('[data-testid=\"action-bar-row\"] [data-testid=\"play-button\"]')"
                + "||document.querySelector('main [data-testid=\"play-button\"]')"
                + "||document.querySelector('[data-testid=\"play-button\"]');"
                + "if(b){S.clicked=true;S.clickedAt=Date.now();S.tries=(S.tries||0)+1;b.click();}";
        }
        String command(String what, long ms) {
            if (what.equals("seek")) {
                // The progress bar holds a slider; failing that, press the bar at the right spot.
                return "var S=window.__musync||{};var d=S.d||0;if(!d)return;var r=Math.max(0,Math.min(1," + ms + "/d));"
                    + "var bar=document.querySelector('[data-testid=\"playback-progressbar\"]');if(!bar)return;"
                    + "var i=bar.querySelector('input[type=\"range\"]');"
                    + "if(i){var lo=+i.min||0,hi=+i.max||0;"
                    + "Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,String(Math.round(lo+(hi-lo)*r)));"
                    + "i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));}"
                    + "else{var c=bar.getBoundingClientRect(),x=c.left+c.width*r,y=c.top+c.height/2;"
                    + "['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(n){"
                    + "bar.dispatchEvent(new MouseEvent(n,{bubbles:true,cancelable:true,clientX:x,clientY:y,view:window}));});}";
            }
            // One button both plays and pauses, so press it only when the player is in the other state.
            boolean wantPause = what.equals("pause");
            return "var S=window.__musync||{};var st=navigator.mediaSession?navigator.mediaSession.playbackState:'none';"
                + "var playing=st==='playing'||(st!=='paused'&&!!S.adv);"
                + "var b=document.querySelector('[data-testid=\"control-button-playpause\"]');"
                + "if(b&&playing===" + wantPause + ")b.click();";
        }
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
    private long lastT;

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
        if (agent != null && site.desktop()) {
            // A player built for computers: present as a computer browser of the same version.
            java.util.regex.Matcher m = java.util.regex.Pattern.compile("Chrome/([\\d.]+)").matcher(agent);
            String version = m.find() ? m.group(1) : "126.0.0.0";
            s.setUserAgentString("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/" + version + " Safari/537.36");
        } else if (agent != null) {
            s.setUserAgentString(agent.replace("; wv", "").replaceAll("Version/\\d+\\.\\d+ ", ""));
        }
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
        if (phase != IDLE) return; // a song is loading or playing; leave the page alone
        String url = web.getUrl();
        boolean blank = url == null || url.length() == 0 || url.startsWith("about:") || url.startsWith(localBase);
        if ("out".equals(site.signedIn()) && site.signInUrl() != null) {
            if (blank || !url.contains("accounts.")) web.loadUrl(site.signInUrl());
        } else if (blank) {
            web.loadUrl(site.home);
        }
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
    public String check(String app) {
        if (!site.id.equals(app)) return "no-app";
        return site.needsAccount() && !"in".equals(site.signedIn()) ? "sign-in" : "ok";
    }

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
        lastT = 0;
        if (site.needsAccount() && !"in".equals(site.signedIn())) {
            // Signed out since the room last asked: say so and let the room route songs elsewhere.
            phase = IDLE;
            status("failed", "Sign in to " + site.name + " to play this song.");
            try { room.playerRecheck(); } catch (RuntimeException ignored) { }
            return;
        }
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
                // What the player says it is playing is the truth from here on; a service may
                // swap a song for its own copy with a different id.
                if (pick == null || str(p.get("playing")).length() > 0) pick = str(p.get("playing"));
                lastT = t;
                r.playerStarted(key, d);
                r.playerProgress(key, t, d);
                status("ok", "");
                if (paused) js(site.command("pause", 0));
                return;
            }
            if (site.startJs() != null) {
                js(site.startJs());
            } else if (has && isPaused && age > 4000 && !nudged) {
                nudged = true;
                js(site.command("play", 0));
            }
            if (age > site.startTimeoutMs() && !warned) {
                warned = true;
                status("failed", site.name + " didn’t start the song. " + report(p));
            }
            return;
        }

        // PLAYING
        if (ad) return;
        String playing = str(p.get("playing"));
        boolean movedOn = pick != null && pick.length() > 0 && playing.length() > 0 && !playing.equals(pick);
        // Reached the end, or was in its last seconds and has now snapped back to the start.
        boolean wrapped = d > 0 && lastT >= d - 3500 && t < 2500 && t < lastT;
        boolean atEnd = ended || (d > 0 && t >= d - 900) || wrapped;
        lastT = t;
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
        String note = str(p.get("note"));
        return String.format(Locale.ROOT, "(page: %s; songs listed: %d; rows: %d; player: %s%s%s)", where,
            picks == null ? 0 : picks.size(), Json.num(p.get("rows")),
            !Boolean.TRUE.equals(p.get("has")) ? "none" : Boolean.TRUE.equals(p.get("paused")) ? "paused" : "playing",
            Boolean.TRUE.equals(p.get("ad")) ? ", ad" : "", note.length() > 0 ? "; " + note : "");
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
