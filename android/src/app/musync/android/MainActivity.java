package app.musync.android;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;

import app.musync.core.Catalog;
import app.musync.core.Json;
import app.musync.core.RoomServer;

import java.io.IOException;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * The musync Android app.
 *
 * It starts the room server on this phone and shows the web client from it.
 * When this phone starts a room, everyone on the same Wi-Fi can join from
 * their browser or their own copy of the app. When this phone joins someone
 * else's room, the same screen simply loads that host's address instead.
 */
public class MainActivity extends Activity {
    private static RoomServer server; // one per process, survives screen rotation
    private static HostPlayer player;
    private FrameLayout root;
    private LinearLayout playerPanel;
    private FrameLayout playerStack;
    private PanelBar playerBar, browseBar;
    private WebPlayer playerOnScreen;
    private LinearLayout browsePanel;
    private LibraryBrowser browser;
    private boolean browseShown;
    private boolean playerShown;
    private static boolean askedNotifications;
    private static int port;
    private WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private int homeRetries = 0;

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#101011"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        // The host's phone is the room's speaker: the next song must start without a tap.
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        web.addJavascriptInterface(new Bridge(), "MusyncNative");
        web.setWebViewClient(new Client());
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#101011"));
        setContentView(root);

        String problem = startServer();
        buildPlayerPanel();
        buildBrowsePanel();
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        if (problem != null) {
            web.loadData("<body style='background:#101011;color:#f4f4f5;font:16px sans-serif;padding:24px'>"
                    + "<h2>musync couldn’t start</h2><p>" + problem + "</p><p>Close other copies of musync and open it again.</p>",
                    "text/html; charset=utf-8", "utf-8");
        } else if (saved == null) {
            String room = roomFrom(getIntent());
            web.loadUrl(room != null ? room : home());
        } else {
            web.restoreState(saved);
        }
    }

    private String startServer() {
        synchronized (MainActivity.class) {
            if (server != null) return null;
            RoomServer.Files files = new RoomServer.Files() {
                public InputStream open(String path) throws IOException {
                    return getApplicationContext().getAssets().open("web/" + path);
                }
            };
            // Android knows which of its networks are Wi-Fi or Ethernet; the invite link must use one of those.
            final Context app = getApplicationContext();
            RoomServer.setAddressSource(new RoomServer.AddressSource() {
                public List<String> addresses() { return wifiAddresses(app); }
            });
            final RoomServer s = new RoomServer(files, new Catalog.Live(), true);
            player = new HostPlayer(app);
            s.setPlayer(player);
            // Opening the port happens off the main thread, which Android reserves for the screen.
            final int[] bound = {-1};
            Thread t = new Thread(new Runnable() {
                public void run() {
                    try { bound[0] = s.start(RoomServer.DEFAULT_PORT); } catch (IOException ignored) { }
                }
            }, "musync-start");
            t.start();
            try { t.join(5000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            if (bound[0] < 0) return "The room server could not open a port on this phone.";
            port = bound[0];
            server = s;
            for (WebPlayer w : player.web) w.setLocalBase(home());
            return null;
        }
    }

    /** This phone's addresses on Wi-Fi and Ethernet, as the system reports them. */
    @SuppressWarnings("deprecation")
    private static List<String> wifiAddresses(Context app) {
        List<String> out = new ArrayList<String>();
        try {
            ConnectivityManager cm = (ConnectivityManager) app.getSystemService(Context.CONNECTIVITY_SERVICE);
            for (Network n : cm.getAllNetworks()) {
                NetworkCapabilities caps = cm.getNetworkCapabilities(n);
                if (caps == null) continue;
                if (!caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) && !caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) continue;
                LinkProperties lp = cm.getLinkProperties(n);
                if (lp == null) continue;
                for (LinkAddress la : lp.getLinkAddresses()) {
                    InetAddress a = la.getAddress();
                    if (a instanceof Inet4Address) out.add(a.getHostAddress());
                }
            }
        } catch (Throwable ignored) { }
        try {
            WifiManager wm = (WifiManager) app.getSystemService(Context.WIFI_SERVICE);
            int ip = wm.getConnectionInfo().getIpAddress();
            if (ip != 0) out.add((ip & 0xff) + "." + ((ip >> 8) & 0xff) + "." + ((ip >> 16) & 0xff) + "." + ((ip >> 24) & 0xff));
        } catch (Throwable ignored) { }
        return out;
    }

    private static String home() {
        return "http://127.0.0.1:" + port + "/";
    }

    /** Another app or a link ("musync://join?...") asks to open a room in this app. */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String room = roomFrom(intent);
        if (room != null && web != null) {
            if (browseShown) showBrowser(null);
            if (playerShown) showPlayer(null);
            web.loadUrl(room);
        }
    }

    /**
     * The room address in a "musync://join?url=...&code=..." link, or null. Only a phone
     * on a home or office network is accepted (a plain address like 192.168.1.23:8787),
     * so a link cannot point this app at an arbitrary website.
     */
    static String roomFrom(Intent intent) {
        Uri d = intent == null ? null : intent.getData();
        if (d == null || !"musync".equals(d.getScheme())) return null;
        try {
            String url = d.getQueryParameter("url"), code = d.getQueryParameter("code");
            if (url == null || code == null) return null;
            if (!url.matches("http://(10\\.\\d{1,3}|192\\.168|172\\.(1[6-9]|2\\d|3[01]))\\.\\d{1,3}\\.\\d{1,3}:\\d{2,5}/?")) return null;
            if (!code.matches("[A-Za-z0-9]{4}")) return null;
            return (url.endsWith("/") ? url : url + "/") + "#join=" + code.toUpperCase(java.util.Locale.ROOT);
        } catch (RuntimeException e) {
            return null;
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (player != null) {
            player.apps.setForeground(true);
            player.recheck(); // the user may be coming back from granting access
        }
    }

    @Override
    protected void onPause() {
        if (player != null) player.apps.setForeground(false);
        super.onPause();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onDestroy() {
        if (isFinishing()) {
            PlaybackService.set(this, false);
            synchronized (MainActivity.class) {
                if (server != null) { server.stop(); server = null; }
            }
        }
        // The web players outlive this screen; only let go of them here.
        if (playerStack != null) playerStack.removeAllViews();
        if (browser != null) browser.destroy();
        web.destroy();
        super.onDestroy();
    }

    /** Back closes a sheet or steps back inside the app; from the start screen it sends the app to the background. */
    @Override
    public void onBackPressed() {
        if (browseShown) { if (!browser.goBack()) showBrowser(null); return; }
        if (playerShown) { showPlayer(null); return; }
        web.evaluateJavascript("window.musyncBack ? window.musyncBack() : '0'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (value == null || !value.contains("1")) moveTaskToBack(true);
            }
        });
    }

    /**
     * The bar above a service's website when it is on screen: a way back within the
     * site, what this screen is for, a Done button, and a thin line while a page loads.
     */
    private final class PanelBar {
        final LinearLayout view;
        final TextView back, title, sub, done;
        final View progress;
        private String hint = "";
        private final Runnable restore = new Runnable() {
            public void run() { sub.setText(hint); sub.setTextColor(Color.parseColor("#B3B3B8")); }
        };

        PanelBar() {
            float dp = getResources().getDisplayMetrics().density;
            view = new LinearLayout(MainActivity.this);
            view.setOrientation(LinearLayout.VERTICAL);
            view.setBackgroundColor(Color.parseColor("#1A1A1C"));
            LinearLayout row = new LinearLayout(MainActivity.this);
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setGravity(Gravity.CENTER_VERTICAL);
            row.setPadding((int) (4 * dp), 0, (int) (12 * dp), 0);

            back = new TextView(MainActivity.this);
            back.setText("\u2039");
            back.setTextSize(30);
            back.setTextColor(Color.parseColor("#F4F4F5"));
            back.setGravity(Gravity.CENTER);
            back.setContentDescription("Back");
            row.addView(back, new LinearLayout.LayoutParams((int) (48 * dp), (int) (48 * dp)));

            LinearLayout words = new LinearLayout(MainActivity.this);
            words.setOrientation(LinearLayout.VERTICAL);
            title = new TextView(MainActivity.this);
            title.setTextSize(16);
            title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
            title.setTextColor(Color.parseColor("#F4F4F5"));
            title.setSingleLine(true);
            title.setEllipsize(android.text.TextUtils.TruncateAt.END);
            sub = new TextView(MainActivity.this);
            sub.setTextSize(13);
            sub.setTextColor(Color.parseColor("#B3B3B8"));
            sub.setSingleLine(true);
            sub.setEllipsize(android.text.TextUtils.TruncateAt.END);
            words.addView(title);
            words.addView(sub);
            LinearLayout.LayoutParams wide = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
            wide.setMargins((int) (4 * dp), 0, (int) (12 * dp), 0);
            row.addView(words, wide);

            done = new TextView(MainActivity.this);
            done.setText("Done");
            done.setTextSize(14);
            done.setTypeface(done.getTypeface(), android.graphics.Typeface.BOLD);
            done.setTextColor(Color.parseColor("#1A1606"));
            done.setGravity(Gravity.CENTER);
            done.setPadding((int) (18 * dp), 0, (int) (18 * dp), 0);
            android.graphics.drawable.GradientDrawable pill = new android.graphics.drawable.GradientDrawable();
            pill.setColor(Color.parseColor("#FFD23F"));
            pill.setCornerRadius(999 * dp);
            done.setBackground(pill);
            row.addView(done, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, (int) (40 * dp)));
            view.addView(row, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (int) (60 * dp)));

            progress = new View(MainActivity.this);
            progress.setBackgroundColor(Color.parseColor("#FFD23F"));
            progress.setPivotX(0);
            progress.setScaleX(0);
            view.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (int) Math.max(2, 2 * dp)));
        }

        void describe(String name, String what) {
            title.setText(name);
            hint = what;
            main.removeCallbacks(restore);
            restore.run();
        }

        /** Something just happened (a song was added, or could not be): say so here for a moment. */
        void say(String text, boolean good) {
            sub.setText(text);
            sub.setTextColor(Color.parseColor(good ? "#FFD23F" : "#FF8A80"));
            main.removeCallbacks(restore);
            main.postDelayed(restore, 2800);
        }

        /** How far the page has loaded, 0 to 100. The line shows only while a page is on its way. */
        void loading(int percent) {
            progress.animate().cancel();
            if (percent >= 100) {
                progress.animate().alpha(0f).setDuration(250).start();
            } else {
                progress.setAlpha(1f);
                progress.animate().scaleX(Math.max(0.08f, percent / 100f)).setDuration(180).start();
            }
        }
    }

    /**
     * A panel that is not being looked at is moved off the side of the screen. It keeps
     * running there (music keeps playing), but the phone no longer spends effort drawing
     * it underneath what the person is actually looking at.
     */
    private void park(View panel, boolean away) {
        panel.setTranslationX(away ? 100000f : 0f);
    }

    /**
     * The music services' web players live in a panel that is normally off screen.
     * Bringing the panel on screen is only for signing in or looking at what a player is doing.
     */
    private void buildPlayerPanel() {
        if (player == null) return;
        playerPanel = new LinearLayout(this);
        playerPanel.setOrientation(LinearLayout.VERTICAL);
        playerPanel.setBackgroundColor(Color.parseColor("#101011"));
        playerBar = new PanelBar();
        playerBar.done.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { showPlayer(null); }
        });
        playerBar.back.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) {
                WebView shown = playerOnScreen == null ? null : playerOnScreen.view();
                if (shown != null && shown.canGoBack()) shown.goBack(); else showPlayer(null);
            }
        });
        playerPanel.addView(playerBar.view, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        playerStack = new FrameLayout(this);
        for (final WebPlayer w : player.web) {
            WebView pv = w.view();
            if (pv.getParent() instanceof ViewGroup) ((ViewGroup) pv.getParent()).removeView(pv);
            playerStack.addView(pv, playerSize(w, false));
            w.setLoadingListener(new WebPlayer.Loading() {
                public void progress(int percent) { if (playerOnScreen == w) playerBar.loading(percent); }
            });
        }
        playerPanel.addView(playerStack, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(playerPanel, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        park(playerPanel, true);
    }

    /**
     * The panel where a person browses their own library on a music service's website.
     * It stays off screen until asked for.
     */
    private void buildBrowsePanel() {
        browseBar = new PanelBar();
        browser = new LibraryBrowser(this, new LibraryBrowser.Listener() {
            public void onPick(Map<String, Object> song) {
                // Say so at once; the room's answer follows in a moment.
                browseBar.say("Adding \u201c" + Json.str(song.get("title")) + "\u201d", true);
                // The room screen knows which room this is and who is asking; hand the song to it.
                web.evaluateJavascript("window.musyncAddDirect && window.musyncAddDirect(" + Json.write(song) + ")", null);
            }
            public void onProgress(int percent) { browseBar.loading(percent); }
        });
        browsePanel = new LinearLayout(this);
        browsePanel.setOrientation(LinearLayout.VERTICAL);
        browsePanel.setBackgroundColor(Color.parseColor("#101011"));
        browseBar.done.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { showBrowser(null); }
        });
        browseBar.back.setOnClickListener(new View.OnClickListener() {
            public void onClick(View v) { if (!browser.goBack()) showBrowser(null); }
        });
        browsePanel.addView(browseBar.view, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        browsePanel.addView(browser.view(), new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(browsePanel, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        park(browsePanel, true);
    }

    /** Brings a service's library on screen, or with null goes back to musync's own screen. */
    private void showBrowser(String appId) {
        if (browsePanel == null) return;
        WebPlayer w = appId == null || player == null ? null : player.webFor(appId);
        browseShown = w != null;
        if (w != null) {
            browseBar.describe(w.site.name, "Tap a song to add it to the queue");
            browser.open(w.site);
            park(browsePanel, false);
            browsePanel.bringToFront();
        } else {
            browser.close();
            park(browsePanel, true);
            web.bringToFront();
            // Signing in here also signs the built-in players in.
            if (player != null) player.recheck();
            web.evaluateJavascript("window.musyncRefresh && window.musyncRefresh()", null);
        }
        root.requestLayout();
        root.invalidate();
    }

    /**
     * A web player fills the screen while the person is looking at it. Out of sight, a
     * player built for computer screens gets a computer-sized page, so its full set of
     * controls is laid out for musync to work.
     */
    private FrameLayout.LayoutParams playerSize(WebPlayer w, boolean shown) {
        if (shown || !w.site.desktop()) {
            return new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        }
        float dp = getResources().getDisplayMetrics().density;
        return new FrameLayout.LayoutParams((int) (1100 * dp), (int) (720 * dp));
    }

    /** Brings one service's web player on screen, or with null goes back to musync's own screen. */
    private void showPlayer(String appId) {
        if (playerPanel == null) return;
        WebPlayer w = appId == null ? null : player.webFor(appId);
        playerShown = w != null;
        playerOnScreen = w;
        if (w != null) {
            playerBar.describe(w.site.name, "in".equals(w.site.signedIn()) ? "Signed in. Songs play from here, out of sight."
                : "Sign in, then tap Done");
            w.ensureLoaded();
            w.view().setLayoutParams(playerSize(w, true));
            w.view().bringToFront();
            park(playerPanel, false);
            playerPanel.bringToFront();
        } else {
            for (WebPlayer each : player.web) each.view().setLayoutParams(playerSize(each, false));
            park(playerPanel, true);
            web.bringToFront();
            // Signing in changes what this phone can play and what the room screen should offer.
            player.recheck();
            web.evaluateJavascript("window.musyncRefresh && window.musyncRefresh()", null);
        }
        root.requestLayout();
        root.invalidate();
    }

    /** What the web client may ask the app to do. */
    private final class Bridge {
        /** Opens a song in the person's music app or browser. Only web addresses are accepted. */
        @JavascriptInterface
        public void open(String url) {
            if (url == null || !(url.startsWith("https://") || url.startsWith("http://"))) return;
            try {
                Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Exception ignored) {
                // no app can open it; nothing to do
            }
        }

        /** "web" when musync plays this music app's songs in its own built-in web player, otherwise "app". */
        @JavascriptInterface
        public String playerKind(String appId) {
            return player != null ? player.kind(appId) : "app";
        }

        /** Whether the music app itself is installed on this phone. */
        @JavascriptInterface
        public boolean appInstalled(String appId) {
            return player != null && player.apps.isInstalled(appId);
        }

        /** The music services whose libraries can be browsed in this app, as a JSON list of ids. */
        @JavascriptInterface
        public String browsable() {
            List<Object> ids = new ArrayList<Object>();
            if (player != null) for (WebPlayer w : player.web) ids.add(w.site.id);
            return Json.write(ids);
        }

        /** Opens the person's own library on a service, to add songs from it. */
        @JavascriptInterface
        public void browse(final String appId) {
            runOnUiThread(new Runnable() { public void run() { showBrowser(appId); } });
        }

        /** The room screen reports what happened to a song picked while browsing; shown in the bar above the library. */
        @JavascriptInterface
        public void browseResult(final String text) {
            if (text == null || text.length() > 200) return;
            runOnUiThread(new Runnable() { public void run() {
                if (browseBar != null) browseBar.say(text, text.startsWith("Added"));
            } });
        }

        /** For a built-in web player: "in" or "out" for signed in or not, "none" when no account is needed. */
        @JavascriptInterface
        public String webSignedIn(String appId) {
            WebPlayer w = player == null ? null : player.webFor(appId);
            // A service played through its installed app needs no sign-in here.
            return w == null || player.viaApp(appId) ? "none" : w.site.signedIn();
        }

        /** Brings a built-in web player to the front, for signing in. */
        @JavascriptInterface
        public void showWebPlayer(final String appId) {
            runOnUiThread(new Runnable() { public void run() { showPlayer(appId); } });
        }

        /** "granted" once musync may control music playback, otherwise "missing". */
        @JavascriptInterface
        public String mediaAccess() {
            return AppPlayer.hasAccess(getApplicationContext()) ? "granted" : "missing";
        }

        /** Opens the Android screen where the user allows musync to control playback. */
        @JavascriptInterface
        public void requestMediaAccess() {
            try {
                Intent i = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Exception e) {
                openAppSettings();
            }
        }

        /** Opens musync's own page in Settings, where "Allow restricted settings" lives on newer phones. */
        @JavascriptInterface
        public void openAppSettings() {
            try {
                Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                startActivity(i);
            } catch (Exception ignored) { }
        }

        /** Brings the host's music app to the front, so it is running and can take requests. */
        @JavascriptInterface
        public void openApp(String appId) {
            String pkg = AppPlayer.packageOf(appId);
            if (pkg == null) return;
            try {
                Intent i = getPackageManager().getLaunchIntentForPackage(pkg);
                if (i != null) startActivity(i);
            } catch (Exception ignored) { }
        }

        /** Called with true while this phone hosts a room: keeps the room and music going when musync is minimised. */
        @JavascriptInterface
        public void keepAwake(final boolean on) {
            runOnUiThread(new Runnable() {
                public void run() {
                    if (on && Build.VERSION.SDK_INT >= 33 && !askedNotifications) {
                        // Newer Android only shows the "room is open" notification with permission.
                        askedNotifications = true;
                        try { requestPermissions(new String[] {"android.permission.POST_NOTIFICATIONS"}, 1); } catch (RuntimeException ignored) { }
                    }
                    PlaybackService.set(MainActivity.this, on);
                }
            });
        }
    }

    private final class Client extends WebViewClient {
        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            // Rooms live at http(s) addresses (this phone, another phone, or a hosted server).
            // Anything else is not ours to load.
            return !(url.startsWith("http://") || url.startsWith("https://"));
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            String failing = request.getUrl().toString();
            if (failing.startsWith(home())) {
                // Our own screen did not load. Try again a few times, then explain instead of showing a browser error.
                final String why = String.valueOf(error.getDescription()) + " (" + error.getErrorCode() + ")";
                if (homeRetries++ < 5) {
                    main.postDelayed(new Runnable() { public void run() { web.loadUrl(home()); } }, 500);
                } else {
                    view.loadData("<body style='background:#101011;color:#f4f4f5;font:16px sans-serif;padding:24px'>"
                            + "<h2>musync couldn’t open its screen</h2><p>The part of the app that runs the room did not answer.</p>"
                            + "<p>Close musync completely and open it again. If this keeps happening, report this detail: " + why + "</p>",
                            "text/html; charset=utf-8", "utf-8");
                }
                return;
            }
            // Another phone's room could not be reached: come back to our own start screen and say so.
            view.loadUrl(home() + "#notice=" + Uri.encode("Couldn’t reach that room. Check that you’re on the same Wi-Fi as the host."));
        }
    }
}
