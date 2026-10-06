package app.syng.prototype;

import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.io.InputStream;

/**
 * syng prototype shell. Shows the bundled web prototype in a WebView.
 *
 * The files in assets/web are served under a private https address so the page
 * runs as a secure origin (clipboard and storage work) without any network
 * access. Every other address is refused.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String BASE = "https://" + HOST + "/";
    private WebView web;

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
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setTextZoom(100);
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        web.setWebViewClient(new AssetClient());
        setContentView(web);
        if (saved == null) web.loadUrl(BASE + "index.html");
        else web.restoreState(saved);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    /** Back closes a sheet or steps back inside the prototype before leaving the app. */
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.syngBack ? window.syngBack() : '0'", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if (value == null || !value.contains("1")) finish();
            }
        });
    }

    private final class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            android.net.Uri uri = request.getUrl();
            if (!HOST.equals(uri.getHost())) return blocked();
            String path = uri.getPath();
            if (path == null || path.equals("/")) path = "/index.html";
            if (path.contains("..")) return blocked();
            try {
                InputStream in = getAssets().open("web" + path);
                return new WebResourceResponse(mime(path), isText(path) ? "utf-8" : null, in);
            } catch (IOException e) {
                return blocked();
            }
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            // Stay inside the bundled prototype; never open outside addresses.
            return !HOST.equals(android.net.Uri.parse(url).getHost());
        }

        private WebResourceResponse blocked() {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not found", null, null);
        }

        private boolean isText(String p) {
            return p.endsWith(".html") || p.endsWith(".css") || p.endsWith(".js") || p.endsWith(".txt");
        }

        private String mime(String p) {
            if (p.endsWith(".html")) return "text/html";
            if (p.endsWith(".css")) return "text/css";
            if (p.endsWith(".js")) return "application/javascript";
            if (p.endsWith(".woff2")) return "font/woff2";
            if (p.endsWith(".png")) return "image/png";
            if (p.endsWith(".svg")) return "image/svg+xml";
            return "text/plain";
        }
    }
}
