import app.syng.core.Catalog;
import app.syng.core.Json;
import app.syng.core.Room;
import app.syng.core.RoomServer;

import java.lang.reflect.Method;
import java.util.List;
import java.util.Map;

/** Unit checks for the parts that do not need a network. Run: java -cp build/classes:test CoreTest */
public class CoreTest {
    static int failed = 0;
    static void check(String name, boolean ok) { System.out.println((ok ? "PASS  " : "FAIL  ") + name); if (!ok) failed++; }

    @SuppressWarnings("unchecked")
    static List<Map<String, Object>> parse(String method, String body) throws Exception {
        Method m = Catalog.Live.class.getDeclaredMethod(method, String.class);
        m.setAccessible(true);
        return (List<Map<String, Object>>) m.invoke(null, body);
    }

    public static void main(String[] a) throws Exception {
        // JSON round trip, including characters that would break a stream line.
        String tricky = "Beyoncé \"quoted\" \\ back\nline   sep <tag>";
        Map<String, Object> back = Json.obj(Json.read(Json.write(Json.map("t", tricky, "n", 42, "b", true, "x", null))));
        check("json round trip keeps text exactly", tricky.equals(back.get("t")));
        check("json keeps numbers and booleans", Json.num(back.get("n")) == 42 && Boolean.TRUE.equals(back.get("b")) && back.get("x") == null);
        check("json output has no raw newline", Json.write(tricky).indexOf('\n') < 0 && Json.write(tricky).indexOf(' ') < 0);
        boolean threw = false;
        try { Json.read("{\"a\":1,}"); } catch (IllegalArgumentException e) { threw = true; }
        check("json rejects malformed input", threw);

        // Catalog responses in the shapes the two services document.
        String apple = "{\"resultCount\":2,\"results\":[{\"wrapperType\":\"track\",\"kind\":\"song\",\"artistId\":372976,\"collectionId\":1422648512,"
            + "\"trackId\":1422648513,\"artistName\":\"ABBA\",\"collectionName\":\"Arrival\",\"trackName\":\"Dancing Queen\","
            + "\"trackViewUrl\":\"https://music.apple.com/us/album/dancing-queen/1422648512?i=1422648513&uo=4\","
            + "\"previewUrl\":\"https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/aa/bb/cc/mzaf_1.plus.aac.p.m4a\","
            + "\"artworkUrl30\":\"https://is1-ssl.mzstatic.com/image/thumb/Music/a/30x30bb.jpg\","
            + "\"artworkUrl100\":\"https://is1-ssl.mzstatic.com/image/thumb/Music/a/100x100bb.jpg\",\"trackTimeMillis\":230400},"
            + "{\"wrapperType\":\"track\",\"trackName\":\"No id here\"}]}";
        List<Map<String, Object>> as = parse("parseApple", apple);
        check("apple: one valid song, the one without an id is skipped", as.size() == 1);
        check("apple: fields mapped", "Dancing Queen".equals(as.get(0).get("title")) && "ABBA".equals(as.get(0).get("artist"))
            && "apple:1422648513".equals(as.get(0).get("ref")) && as.get(0).get("preview").toString().endsWith(".m4a"));
        check("apple: large artwork derived", as.get(0).get("artBig").toString().contains("600x600bb.jpg"));

        String deezer = "{\"data\":[{\"id\":3135556,\"readable\":true,\"title\":\"Harder, Better, Faster, Stronger\",\"link\":\"https://www.deezer.com/track/3135556\","
            + "\"duration\":224,\"preview\":\"http://cdnt-preview.dzcdn.net/api/1/1/a/b/c/abc.mp3\",\"artist\":{\"id\":27,\"name\":\"Daft Punk\"},"
            + "\"album\":{\"id\":302127,\"title\":\"Discovery\",\"cover_medium\":\"https://cdn-images.dzcdn.net/images/cover/x/250x250-000000-80-0-0.jpg\","
            + "\"cover_xl\":\"https://cdn-images.dzcdn.net/images/cover/x/1000x1000-000000-80-0-0.jpg\"},\"type\":\"track\"}],\"total\":1}";
        List<Map<String, Object>> ds = parse("parseDeezer", deezer);
        check("deezer: fields mapped", ds.size() == 1 && "Daft Punk".equals(ds.get(0).get("artist")) && "deezer:3135556".equals(ds.get(0).get("ref")));
        check("deezer: plain http preview is upgraded to https", ds.get(0).get("preview").toString().startsWith("https://"));
        threw = false;
        try { parse("parseDeezer", "{\"error\":{\"type\":\"Exception\",\"message\":\"Quota limit exceeded\",\"code\":4}}"); } catch (Exception e) { threw = true; }
        check("deezer: an error body is reported, not treated as no results", threw);

        // Room codes for the local network.
        check("lan code is four characters", RoomServer.codeForAddress("192.168.1.37").length() == 4);
        check("lan codes differ per address", !RoomServer.codeForAddress("192.168.1.37").equals(RoomServer.codeForAddress("192.168.1.38")));
        System.out.println("CODE " + RoomServer.codeForAddress("192.168.1.37") + " " + RoomServer.codeForAddress("10.0.200.5") + " " + RoomServer.codeForAddress("172.20.0.255"));

        // Room rules.
        Room r = new Room("TEST");
        String host = r.join("host-token-0123456789", "Maya", "spotify");
        String guest = r.join("guest-token-0123456789", " maya ", "apple");
        Catalog c = new Catalog.Sample();
        List<Map<String, Object>> songs = c.search("e", "apple", "US").songs;
        r.add("host-token-0123456789", songs.get(0));
        r.add("guest-token-0123456789", songs.get(1));
        r.add("host-token-0123456789", songs.get(2));
        Map<String, Object> st = r.state();
        check("first song plays, the rest queue", st.get("now") != null && Json.arr(st.get("queue")).size() == 2);
        check("duplicate names are numbered", Json.write(st).contains("maya (2)") || Json.write(st).contains("Maya (2)"));
        threw = false;
        try { r.add("guest-token-0123456789", songs.get(1)); } catch (Room.Denied e) { threw = true; }
        check("the same song cannot be queued twice", threw);
        threw = false;
        try { r.setPaused("guest-token-0123456789", true); } catch (Room.Denied e) { threw = true; }
        check("a guest cannot pause", threw);
        String hostSongKey = Json.str(Json.obj(Json.arr(r.state().get("queue")).get(1)).get("key"));
        threw = false;
        try { r.remove("guest-token-0123456789", hostSongKey); } catch (Room.Denied e) { threw = true; }
        check("a guest cannot remove the host's song", threw);
        r.bump("guest-token-0123456789", hostSongKey);
        check("a bump moves a song to the top", hostSongKey.equals(Json.str(Json.obj(Json.arr(r.state().get("queue")).get(0)).get("key"))));
        threw = false;
        try { r.add("stranger-token-0123456789", songs.get(3)); } catch (Room.Denied e) { threw = true; }
        check("someone who has not joined cannot add", threw);
        r.leave("host-token-0123456789");
        check("when the host leaves, the next person becomes host", guest.equals(r.state().get("hostId")));

        System.out.println(failed == 0 ? "\nAll checks passed" : "\n" + failed + " check(s) failed");
        System.exit(failed == 0 ? 0 : 1);
    }
}
