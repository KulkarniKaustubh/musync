package app.musync.android;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import app.musync.core.Json;
import app.musync.core.Room;

import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * Plays whole songs in a music service's own web player, kept inside musync.
 *
 * The web player lives in a second web view that normally sits out of sight
 * behind musync's screen. For each song musync opens the service's search for
 * "title artist", takes the first song it lists, opens that song's page so it
 * plays, and watches the page's audio to know when it ends. Pause and skip in
 * musync act on that page. The person only sees the web player when they ask
 * to, for example to sign in.
 *
 * musync reads the page by asking it a fixed question a few times a second
 * ({@link #PROBE}); the page is given no way to call into the app.
 *
 * Only YouTube Music is wired up. Everything here runs on the main thread,
 * which is where Android requires web views to be used.
 */
final class WebPlayer implements Room.Player {
    static final String APP = "ytm";
    private static final String HOME = "https://music.youtube.com/";
    private static final long POLL_MS = 700;
    private static final int IDLE = 0, SEARCH = 1, LOAD = 2, PLAYING = 3;

    /** One question to the page: where are you, which songs do you list, and what is the audio doing? */
    private static final String PROBE = "(function(){try{"
        + "var v=document.querySelector('video');"
        + "var ids=[];"
        + "function take(list){for(var i=0;i<list.length&&ids.length<5;i++){"
        + "var m=/[?&]v=([A-Za-z0-9_-]{6,})/.exec(list[i].getAttribute('href')||'');"
        + "if(m&&ids.indexOf(m[1])<0)ids.push(m[1]);}}"
        + "take(document.querySelectorAll('ytmusic-responsive-list-item-renderer a[href*=\"watch?v=\"]'));"
        + "take(document.querySelectorAll('a[href*=\"watch?v=\"]'));"
        + "var mp=document.querySelector('#movie_player');"
        + "var md=navigator.mediaSession&&navigator.mediaSession.metadata;"
        + "var d=v&&isFinite(v.duration)?v.duration:0;"
        + "return JSON.stringify({href:location.href,ids:ids,has:!!v,"
        + "t:v?Math.round(v.currentTime*1000):0,d:Math.round(d*1000),"
        + "paused:v?v.paused:true,ended:v?v.ended:false,"
        + "ad:!!(mp&&/(^|\\s)ad-(showing|interrupting)/.test(mp.className)),"
        + "title:md&&md.title?md.title:'',"
        + "rows:document.querySelectorAll('ytmusic-responsive-list-item-renderer').length});"
        + "}catch(e){return JSON.stringify({error:String(e)});}})()";

    /** Fallback when the search page lists no song links: press the first play button it shows. */
    private static final String CLICK_FIRST = "(function(){var b=document.querySelector("
        + "'ytmusic-responsive-list-item-renderer ytmusic-play-button-renderer, ytmusic-card-shelf-renderer ytmusic-play-button-renderer');"
        + "if(b){b.click();return 'clicked';}return 'none';})()";

    private final WebView web;
    private final Handler ui = new Handler(Looper.getMainLooper());

    private Room room;
    private String key;
    private Map<String, Object> song;
    private boolean paused;
    private int phase = IDLE;
    private long phaseAt;
    private String videoId;
    private boolean polling, warned, clicked, nudged, announcedAd;
    private long duration;

    @SuppressLint("SetJavaScriptEnabled")
    WebPlayer(Context ctx) {
        web = new WebView(ctx.getApplicationContext());
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

    WebView view() { return web; }

    /** Shows the service's front page when nothing is loaded yet, so there is something to sign in to. */
    void ensureLoaded() {
        String url = web.getUrl();
        if (url == null || url.length() == 0 || url.startsWith("about:")) web.loadUrl(HOME);
    }

    /** Stops the sound and forgets the room; used when the host switches to an app this player does not handle. */
    void stop() {
        ui.post(new Runnable() { public void run() {
            if (phase != IDLE) js("var v=document.querySelector('video');if(v)v.pause();");
            key = null;
            song = null;
            room = null;
            phase = IDLE;
        } });
    }

    @Override
    public void apply(final Room r, final String k, final Map<String, Object> s, final boolean p, String app, final boolean force) {
        ui.post(new Runnable() { public void run() { handle(r, k, s, p, force); } });
    }

    private void handle(Room r, String k, Map<String, Object> s, boolean p, boolean force) {
        boolean newRoom = room != r;
        room = r;
        // A web player needs no permission: whole songs are available as soon as it is the host's choice.
        if (newRoom || !r.isFull()) {
            try { r.playerMode(true, "ok", ""); } catch (RuntimeException ignored) { }
        }
        if (k == null) {
            if (key != null || phase != IDLE) js("var v=document.querySelector('video');if(v)v.pause();");
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
            if (phase == PLAYING || phase == LOAD) js("var v=document.querySelector('video');if(v){" + (p ? "v.pause()" : "v.play()") + ";}");
        }
    }

    private void start() {
        phase = SEARCH;
        phaseAt = SystemClock.elapsedRealtime();
        videoId = null;
        duration = 0;
        warned = false;
        clicked = false;
        nudged = false;
        announcedAd = false;
        status("starting", "Finding the song in YouTube Music");
        String q = (str(song.get("title")) + " " + str(song.get("artist"))).trim();
        web.loadUrl(HOME + "search?q=" + Uri.encode(q));
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
                web.evaluateJavascript(PROBE, new ValueCallback<String>() {
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
        String href = str(p.get("href"));
        boolean has = Boolean.TRUE.equals(p.get("has")), isPaused = Boolean.TRUE.equals(p.get("paused"));
        boolean ad = Boolean.TRUE.equals(p.get("ad")), ended = Boolean.TRUE.equals(p.get("ended"));
        long t = Json.num(p.get("t")), d = Json.num(p.get("d"));

        if (phase == SEARCH) {
            List<Object> ids = Json.arr(p.get("ids"));
            if (href.contains("/search") && ids != null && !ids.isEmpty()) {
                videoId = str(ids.get(0));
                phase = LOAD;
                phaseAt = SystemClock.elapsedRealtime();
                status("starting", "Starting in YouTube Music");
                web.loadUrl(HOME + "watch?v=" + videoId);
                return;
            }
            if (age > 7000 && !clicked && href.contains("/search") && Json.num(p.get("rows")) > 0) {
                // Results are there but not as links we can read: press the first one's play button.
                clicked = true;
                phase = LOAD;
                phaseAt = SystemClock.elapsedRealtime();
                js(CLICK_FIRST);
                return;
            }
            if (age > 20000 && !warned) {
                warned = true;
                status("failed", "YouTube Music’s search didn’t show any songs. " + report(p));
            }
            return;
        }

        if (phase == LOAD) {
            if (ad) {
                if (!announcedAd) { announcedAd = true; status("starting", "YouTube Music is playing an ad first"); }
                phaseAt = SystemClock.elapsedRealtime(); // the song's own clock starts after the ad
                return;
            }
            if (has && !isPaused && t > 300) {
                phase = PLAYING;
                duration = d;
                if (videoId == null) videoId = idIn(href);
                r.playerStarted(key, d);
                status("ok", "");
                if (paused) js("var v=document.querySelector('video');if(v)v.pause();");
                return;
            }
            if (has && isPaused && age > 4000 && !nudged) {
                nudged = true;
                js("var v=document.querySelector('video');if(v)v.play();");
            }
            if (age > 20000 && !warned) {
                warned = true;
                status("failed", "YouTube Music didn’t start the song. " + report(p));
            }
            return;
        }

        // PLAYING
        if (ad) return;
        if (duration <= 0 && d > 0) { duration = d; r.playerStarted(key, d); }
        String nowId = idIn(href);
        boolean movedOn = videoId != null && nowId != null && !nowId.equals(videoId);
        boolean atEnd = ended || (d > 0 && t >= d - 900);
        if (movedOn || atEnd) {
            // The web player would carry on with its own suggestions; the room decides what is next.
            js("var v=document.querySelector('video');if(v)v.pause();");
            phase = IDLE;
            r.playerEnded(key);
        }
    }

    private static String idIn(String href) {
        int i = href.indexOf("v=");
        if (i < 0 || !href.contains("/watch")) return null;
        int end = href.indexOf('&', i);
        return end < 0 ? href.substring(i + 2) : href.substring(i + 2, end);
    }

    /** What the page looked like, in words, for the message shown when a song will not start. */
    private static String report(Map<String, Object> p) {
        if (p.get("error") != null) return "(page error: " + str(p.get("error")) + ")";
        String href = str(p.get("href"));
        String where;
        try {
            Uri u = Uri.parse(href);
            where = String.valueOf(u.getHost()) + String.valueOf(u.getPath());
        } catch (RuntimeException e) {
            where = href;
        }
        List<Object> ids = Json.arr(p.get("ids"));
        return String.format(Locale.ROOT, "(page: %s; songs listed: %d; rows: %d; player: %s%s)", where,
            ids == null ? 0 : ids.size(), Json.num(p.get("rows")),
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
