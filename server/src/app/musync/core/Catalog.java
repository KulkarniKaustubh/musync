package app.musync.core;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * Song search. The live implementation asks two public, key-free catalogs:
 * Apple's iTunes Search API and Deezer's search API. Both return real songs,
 * cover art and a 30-second preview clip.
 */
public abstract class Catalog {
    public static final String APPLE = "apple";
    public static final String DEEZER = "deezer";

    /** One search result, as plain data ready to be written as JSON. */
    public static Map<String, Object> song(String src, String id, String title, String artist, String album,
                                           String art, String artBig, String preview, String url, long ms) {
        return Json.map("src", src, "id", id, "ref", src + ":" + id, "title", title, "artist", artist,
                "album", album, "art", art, "artBig", artBig, "preview", preview, "url", url, "ms", ms);
    }

    public static final class Result {
        public final List<Map<String, Object>> songs = new ArrayList<Map<String, Object>>();
        /** Sources that could not be reached, if any. */
        public final List<String> failed = new ArrayList<String>();
    }

    /** @param src "apple", "deezer" or "all" */
    public abstract Result search(String query, String src, String country) throws IOException;

    // Songs seen in recent searches, so a client adds by reference and cannot inject made-up data.
    private final Map<String, Map<String, Object>> seen = new LinkedHashMap<String, Map<String, Object>>(256, .75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, Map<String, Object>> e) { return size() > 2000; }
    };

    protected void remember(List<Map<String, Object>> songs) {
        synchronized (seen) {
            for (Map<String, Object> s : songs) seen.put((String) s.get("ref"), s);
        }
    }

    public Map<String, Object> lookup(String ref) {
        synchronized (seen) { return seen.get(ref); }
    }

    // ---------- live catalogs ----------

    public static final class Live extends Catalog {
        // Recent answers, so several people typing the same thing do not use up the catalogs' request limits.
        private static final long FRESH_MS = 10 * 60 * 1000;
        private final Map<String, Object[]> recent = new LinkedHashMap<String, Object[]>(64, .75f, true) {
            @Override
            protected boolean removeEldestEntry(Map.Entry<String, Object[]> e) { return size() > 300; }
        };

        @Override
        public Result search(String query, String src, String country) throws IOException {
            String key = (src == null ? "all" : src) + "|" + country + "|" + query.toLowerCase();
            synchronized (recent) {
                Object[] hit = recent.get(key);
                if (hit != null && System.currentTimeMillis() - (Long) hit[0] < FRESH_MS) return (Result) hit[1];
            }
            Result r = fetch(query, src, country);
            if (r.failed.isEmpty()) {
                synchronized (recent) { recent.put(key, new Object[] {System.currentTimeMillis(), r}); }
            }
            return r;
        }

        private Result fetch(final String query, String src, final String country) throws IOException {
            final Result out = new Result();
            final List<Map<String, Object>> apple = new ArrayList<Map<String, Object>>();
            final List<Map<String, Object>> deezer = new ArrayList<Map<String, Object>>();
            final boolean wantApple = !DEEZER.equals(src), wantDeezer = !APPLE.equals(src);
            final String[] errors = new String[2];

            Thread a = new Thread(new Runnable() { public void run() {
                try { if (wantApple) apple.addAll(apple(query, country)); } catch (Exception e) { errors[0] = e.toString(); }
            } });
            Thread d = new Thread(new Runnable() { public void run() {
                try { if (wantDeezer) deezer.addAll(deezer(query)); } catch (Exception e) { errors[1] = e.toString(); }
            } });
            a.start(); d.start();
            try { a.join(9000); d.join(9000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
            // A catalog that is still working after the wait counts as not responding.
            if (a.isAlive()) { errors[0] = "timed out"; a.interrupt(); }
            if (d.isAlive()) { errors[1] = "timed out"; d.interrupt(); }
            final List<Map<String, Object>> appleDone = errors[0] == null ? apple : new ArrayList<Map<String, Object>>();
            final List<Map<String, Object>> deezerDone = errors[1] == null ? deezer : new ArrayList<Map<String, Object>>();

            if (wantApple && errors[0] != null) out.failed.add(APPLE);
            if (wantDeezer && errors[1] != null) out.failed.add(DEEZER);
            if (out.failed.size() == (wantApple ? 1 : 0) + (wantDeezer ? 1 : 0)) {
                throw new IOException("Search could not reach the music catalogs: " + (errors[0] != null ? errors[0] : errors[1]));
            }
            // Alternate the two lists so neither catalog buries the other.
            for (int i = 0; i < Math.max(appleDone.size(), deezerDone.size()); i++) {
                if (i < appleDone.size()) out.songs.add(appleDone.get(i));
                if (i < deezerDone.size()) out.songs.add(deezerDone.get(i));
            }
            remember(out.songs);
            return out;
        }

        static List<Map<String, Object>> apple(String q, String country) throws IOException {
            String cc = country != null && country.matches("[A-Za-z]{2}") ? country.toUpperCase() : "US";
            String body = get("https://itunes.apple.com/search?media=music&entity=song&limit=25&country=" + cc
                    + "&term=" + URLEncoder.encode(q, "UTF-8"));
            return parseApple(body);
        }

        static List<Map<String, Object>> deezer(String q) throws IOException {
            String body = get("https://api.deezer.com/search?limit=25&q=" + URLEncoder.encode(q, "UTF-8"));
            return parseDeezer(body);
        }

        static List<Map<String, Object>> parseApple(String body) {
            List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
            for (Object o : Json.arr(Json.obj(Json.read(body)).get("results"))) {
                Map<String, Object> r = Json.obj(o);
                String id = Json.str(r.get("trackId")), title = Json.str(r.get("trackName"));
                if (id.length() == 0 || title.length() == 0) continue;
                String art = https(Json.str(r.get("artworkUrl100")));
                out.add(song(APPLE, id, title, Json.str(r.get("artistName")), Json.str(r.get("collectionName")),
                        art, art.replace("100x100", "600x600"), https(Json.str(r.get("previewUrl"))),
                        https(Json.str(r.get("trackViewUrl"))), Json.num(r.get("trackTimeMillis"))));
            }
            return out;
        }

        static List<Map<String, Object>> parseDeezer(String body) {
            List<Map<String, Object>> out = new ArrayList<Map<String, Object>>();
            Map<String, Object> root = Json.obj(Json.read(body));
            if (root.get("error") != null) throw new IllegalStateException("Deezer: " + Json.write(root.get("error")));
            for (Object o : Json.arr(root.get("data"))) {
                Map<String, Object> r = Json.obj(o);
                String id = Json.str(r.get("id")), title = Json.str(r.get("title"));
                if (id.length() == 0 || title.length() == 0) continue;
                Map<String, Object> album = Json.obj(r.get("album"));
                out.add(song(DEEZER, id, title, Json.str(Json.obj(r.get("artist")).get("name")), Json.str(album.get("title")),
                        https(Json.str(album.get("cover_medium"))), https(Json.str(album.get("cover_xl"))),
                        https(Json.str(r.get("preview"))), https(Json.str(r.get("link"))), Json.num(r.get("duration")) * 1000));
            }
            return out;
        }

        /** Only https addresses are passed to clients; anything else is dropped. */
        static String https(String url) {
            if (url.startsWith("http://")) url = "https://" + url.substring(7);
            return url.startsWith("https://") ? url : "";
        }

        static String get(String address) throws IOException {
            HttpURLConnection c = (HttpURLConnection) new URL(address).openConnection();
            c.setConnectTimeout(6000);
            c.setReadTimeout(8000);
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("User-Agent", "musync/0.2");
            try {
                int code = c.getResponseCode();
                if (code != 200) throw new IOException("HTTP " + code + " from " + c.getURL().getHost());
                InputStream in = c.getInputStream();
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int n;
                while ((n = in.read(chunk)) > 0) {
                    buf.write(chunk, 0, n);
                    if (buf.size() > 2000000) throw new IOException("Response too large");
                }
                return buf.toString("UTF-8");
            } finally {
                c.disconnect();
            }
        }
    }

    // ---------- offline catalog, for tests and demos without internet ----------

    public static final class Sample extends Catalog {
        private static final String[][] SONGS = {
            {"Dancing Queen", "ABBA", "Arrival"}, {"Mr. Brightside", "The Killers", "Hot Fuss"},
            {"Hey Ya!", "OutKast", "Speakerboxxx/The Love Below"}, {"Levitating", "Dua Lipa", "Future Nostalgia"},
            {"September", "Earth, Wind & Fire", "The Best of Earth, Wind & Fire, Vol. 1"},
            {"Don't Stop Me Now", "Queen", "Jazz"}, {"Blinding Lights", "The Weeknd", "After Hours"},
            {"Dreams", "Fleetwood Mac", "Rumours"}, {"Espresso", "Sabrina Carpenter", "Short n' Sweet"},
            {"Take On Me", "a-ha", "Hunting High and Low"}, {"Electric Feel", "MGMT", "Oracular Spectacular"},
            {"Lovely Day", "Bill Withers", "Menagerie"}, {"Pink + White", "Frank Ocean", "Blonde"},
        };

        @Override
        public Result search(String query, String src, String country) {
            Result out = new Result();
            String q = query.toLowerCase();
            for (int i = 0; i < SONGS.length; i++) {
                String[] s = SONGS[i];
                if (!(s[0] + " " + s[1]).toLowerCase().contains(q)) continue;
                if (!DEEZER.equals(src)) out.songs.add(song(APPLE, "s" + i, s[0], s[1], s[2], "", "", "", "", 0));
                if (!APPLE.equals(src)) out.songs.add(song(DEEZER, "s" + i, s[0], s[1], s[2], "", "", "", "", 0));
            }
            remember(out.songs);
            return out;
        }
    }
}
