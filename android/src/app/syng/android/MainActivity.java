package app.syng.android;

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
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import app.syng.core.Catalog;
import app.syng.core.RoomServer;

import java.io.IOException;
import java.io.InputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.util.ArrayList;
import java.util.List;

/**
 * The syng Android app.
 *
 * It starts the room server on this phone and shows the web client from it.
 * When this phone starts a room, everyone on the same Wi-Fi can join from
 * their browser or their own copy of the app. When this phone joins someone
 * else's room, the same screen simply loads that host's address instead.
 */
public class MainActivity extends Activity {
    private static RoomServer server; // one per process, survives screen rotation
    private static AppPlayer player;
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
        web.addJavascriptInterface(new Bridge(), "SyngNative");
        web.setWebViewClient(new Client());
        setContentView(web);

        String problem = startServer();
        if (problem != null) {
            web.loadData("<body style='background:#101011;color:#f4f4f5;font:16px sans-serif;padding:24px'>"
                    + "<h2>syng couldn’t start</h2><p>" + problem + "</p><p>Close other copies of syng and open it again.</p>",
                    "text/html; charset=utf-8", "utf-8");
        } else if (saved == null) {
            web.loadUrl(home());
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
            player = new AppPlayer(app);
            s.setPlayer(player);
            // Opening the port happens off the main thread, which Android reserves for the screen.
            final int[] bound = {-1};
            Thread t = new Thread(new Runnable() {
                public void run() {
                    try { bound[0] = s.start(RoomServer.DEFAULT_PORT); } catch (IOException ignored) { }
                }
            }, "syng-start");
            t.start();
            try { t.join(5000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            if (bound[0] < 0) return "The room server could not open a port on this phone.";
            port = bound[0];
            server = s;
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

    @Override
    protected void onResume() {
        super.onResume();
        if (player != null) {
            player.setForeground(true);
            player.recheck(); // the user may be coming back from granting access
        }
    }

    @Override
    protected void onPause() {
        if (player != null) player.setForeground(false);
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
            synchronized (MainActivity.class) {
                if (server != null) { server.stop(); server = null; }
            }
        }
        web.destroy();
        super.onDestroy();
    }

    /** Back closes a sheet or steps back inside the app; from the start screen it sends the app to the background. */
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.syngBack ? window.syngBack() : '0'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (value == null || !value.contains("1")) moveTaskToBack(true);
            }
        });
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

        /** "granted" once syng may control music playback, otherwise "missing". */
        @JavascriptInterface
        public String mediaAccess() {
            return AppPlayer.hasAccess(getApplicationContext()) ? "granted" : "missing";
        }

        /** Opens the Android screen where the user allows syng to control playback. */
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

        /** Opens syng's own page in Settings, where "Allow restricted settings" lives on newer phones. */
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

        /** Keeps the screen on while this phone is hosting, so the room does not stop. */
        @JavascriptInterface
        public void keepAwake(final boolean on) {
            runOnUiThread(new Runnable() {
                public void run() {
                    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
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
                            + "<h2>syng couldn’t open its screen</h2><p>The part of the app that runs the room did not answer.</p>"
                            + "<p>Close syng completely and open it again. If this keeps happening, report this detail: " + why + "</p>",
                            "text/html; charset=utf-8", "utf-8");
                }
                return;
            }
            // Another phone's room could not be reached: come back to our own start screen and say so.
            view.loadUrl(home() + "#notice=" + Uri.encode("Couldn’t reach that room. Check that you’re on the same Wi-Fi as the host."));
        }
    }
}
