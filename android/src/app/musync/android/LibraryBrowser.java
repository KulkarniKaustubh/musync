package app.musync.android;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import app.musync.core.Catalog;
import app.musync.core.Json;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.List;
import java.util.Map;

/**
 * Lets a person browse their own library on a music service's website, inside
 * musync, and add songs from it to the room's queue.
 *
 * The site is shown as it is. A small script (assets/web/players/browse.js)
 * turns a tap on a song into "add this to the queue"; this class asks that
 * script for the tapped songs a couple of times a second and hands them on.
 * It shares sign-ins with the built-in players, so signing in once covers
 * both browsing and, on the host's phone, playing.
 */
final class LibraryBrowser {
    interface Listener {
        /** A song was tapped. The map holds app, id, title, artist and maybe art, already checked. */
        void onPick(Map<String, Object> song);
    }

    private static final long POLL_MS = 450;
    private final WebView web;
    private final String script;
    private final Listener listener;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final String phoneAgent, computerAgent;
    private WebPlayer.Site site;
    private boolean open;

    @SuppressLint("SetJavaScriptEnabled")
    LibraryBrowser(Context activity, Listener listener) {
        this.listener = listener;
        this.script = read(activity, "web/players/browse.js");
        web = new WebView(activity);
        web.setBackgroundColor(Color.parseColor("#101011"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // Browsing never plays anything; a page that tries is held back until a tap.
        s.setMediaPlaybackRequiresUserGesture(true);
        String agent = s.getUserAgentString();
        if (agent == null) agent = "";
        phoneAgent = agent.replace("; wv", "").replaceAll("Version/\\d+\\.\\d+ ", "");
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("Chrome/([\\d.]+)").matcher(agent);
        computerAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/"
            + (m.find() ? m.group(1) : "126.0.0.0") + " Safari/537.36";
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !(url.startsWith("https://") || url.startsWith("http://")); // stay on the web
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
            return "JSON.stringify({adds:[]})";
        }
    }

    WebView view() { return web; }
    WebPlayer.Site site() { return site; }

    /** Shows the person's library on this service, or its sign-in page when they are signed out. */
    void open(WebPlayer.Site next) {
        boolean sameSite = site == next;
        site = next;
        // The site must see the same kind of browser as the player that shares its sign-in.
        web.getSettings().setUserAgentString(next.desktop() ? computerAgent : phoneAgent);
        String url = web.getUrl();
        boolean elsewhere = !sameSite || url == null || url.startsWith("about:");
        if ("out".equals(next.signedIn()) && next.signInUrl() != null) {
            if (elsewhere || !url.contains("accounts.")) web.loadUrl(next.signInUrl());
        } else if (elsewhere) {
            web.loadUrl(next.libraryUrl());
        }
        if (!open) {
            open = true;
            ui.postDelayed(poll, POLL_MS);
        }
    }

    void close() { open = false; }

    boolean goBack() {
        if (web.canGoBack()) { web.goBack(); return true; }
        return false;
    }

    void destroy() {
        open = false;
        try { web.destroy(); } catch (RuntimeException ignored) { }
    }

    private final Runnable poll = new Runnable() {
        public void run() {
            if (!open) return;
            try {
                web.evaluateJavascript(script, new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        try { deliver(value); } catch (RuntimeException ignored) { }
                    }
                });
            } catch (RuntimeException ignored) { }
            ui.postDelayed(this, POLL_MS);
        }
    };

    private void deliver(String value) {
        if (value == null || value.equals("null") || site == null) return;
        Object inner = Json.read(value);
        if (!(inner instanceof String)) return;
        List<Object> adds = Json.arr(Json.obj(Json.read((String) inner)).get("adds"));
        if (adds == null) return;
        for (Object o : adds) {
            Map<String, Object> tapped = Json.obj(o);
            // Only songs from the service being browsed, and only ones that pass the same checks the room applies.
            if (!site.id.equals(Json.str(tapped.get("app")))) continue;
            Map<String, Object> song = Catalog.direct(tapped);
            if (song == null) continue;
            listener.onPick(Json.map("app", site.id, "id", Json.str(song.get("id")), "title", Json.str(song.get("title")),
                "artist", Json.str(song.get("artist")), "art", Json.str(song.get("art"))));
        }
    }
}
