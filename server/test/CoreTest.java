import app.musync.core.Catalog;
import app.musync.core.Json;
import app.musync.core.Room;
import app.musync.core.RoomServer;

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

        // Addresses offered to guests must be ones they can reach.
        java.util.List<String> lan = RoomServer.lanAddresses();
        boolean clean = true;
        for (String ip : lan) if (ip.startsWith("127.") || ip.startsWith("169.254.") || ip.equals("0.0.0.0")) clean = false;
        check("detected addresses never include localhost or self-assigned ones (found " + lan + ")", clean);
        RoomServer.setAddressSource(new RoomServer.AddressSource() {
            public java.util.List<String> addresses() { return java.util.Arrays.asList("127.0.0.1", "192.168.50.7", "169.254.3.3", "not an ip"); }
        });
        java.util.List<String> merged = RoomServer.lanAddresses();
        check("a platform-reported Wi-Fi address comes first, junk is dropped", merged.size() > 0 && merged.get(0).equals("192.168.50.7")
            && !merged.contains("127.0.0.1") && !merged.contains("169.254.3.3") && !merged.contains("not an ip"));
        RoomServer.setAddressSource(null);

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

        // Whole-song playback through a device player.
        final java.util.List<String> calls = new java.util.ArrayList<String>();
        final java.util.Set<String> can = new java.util.HashSet<String>();
        Room.Player fake = new Room.Player() {
            public void apply(Room room, String key, Map<String, Object> song, boolean paused, String app, boolean force) {
                calls.add((key == null ? "silence" : Json.str(song.get("title"))) + "/" + (paused ? "paused" : "playing") + "/" + app + (force ? "/force" : ""));
            }
            public void seek(Room room, String key, long ms) { calls.add("seek/" + ms); }
            public String check(String app) { return can.contains(app) ? "ok" : "no-access"; }
        };
        Room f = new Room("FULL");
        String owner = f.join("owner-token-0123456789", "Kau", "ytm");
        f.join("friend-token-0123456789", "Dev", "soundcloud");
        f.setPlayer(fake, owner);
        List<Map<String, Object>> list = new Catalog.Sample().search("e", "apple", "US").songs;
        f.add("friend-token-0123456789", list.get(0));
        check("without access the room waits for setup instead of playing previews", "setup".equals(Json.obj(f.state().get("playback")).get("mode")));
        check("the reason is reported", "no-access".equals(Json.obj(f.state().get("playback")).get("status")));
        check("while waiting the player is told to stay silent", calls.size() > 0 && calls.get(calls.size() - 1).startsWith("silence"));
        String waitKey = Json.str(Json.obj(f.state().get("now")).get("key"));
        f.ended("owner-token-0123456789", waitKey);
        f.tick();
        check("while waiting the song is held at the start",
            waitKey.equals(Json.str(Json.obj(f.state().get("now")).get("key"))) && Json.num(Json.obj(f.state().get("now")).get("position")) == 0);
        can.add("ytm");
        f.playerRecheck();
        check("once the device is ready the room switches to whole songs", "full".equals(Json.obj(f.state().get("playback")).get("mode")));
        check("a friend's service the phone cannot play falls back to the host's", calls.get(calls.size() - 1).equals(list.get(0).get("title") + "/playing/ytm"));
        check("the room lists what the phone can play", "[ytm]".equals(Json.obj(f.state().get("playback")).get("services").toString()));
        check("a whole song is not cut at 30 seconds", Json.num(Json.obj(f.state().get("now")).get("duration")) > 60000);
        String k = Json.str(Json.obj(f.state().get("now")).get("key"));
        Thread.sleep(30);
        check("the clock does not run before the song is audible",
            Json.num(Json.obj(f.state().get("now")).get("position")) == 0 && Boolean.FALSE.equals(Json.obj(f.state().get("now")).get("started")));
        f.seek("owner-token-0123456789", 50000);
        check("a song cannot be moved before it has started", Json.num(Json.obj(f.state().get("now")).get("position")) == 0);
        f.playerStarted(k, 201000);
        check("the real length from the music app is used", Json.num(Json.obj(f.state().get("now")).get("duration")) == 201000);
        check("the clock runs once the song has started", Boolean.TRUE.equals(Json.obj(f.state().get("now")).get("started")));
        f.seek("owner-token-0123456789", 60000);
        long at = Json.num(Json.obj(f.state().get("now")).get("position"));
        check("the host can move through the song", at >= 60000 && at < 61000 && calls.get(calls.size() - 1).equals("seek/60000"));
        boolean refused = false;
        try { f.seek("friend-token-0123456789", 1000); } catch (Room.Denied e) { refused = true; }
        check("a guest cannot move through the song", refused);
        f.playerProgress(k, 90000, 201000);
        at = Json.num(Json.obj(f.state().get("now")).get("position"));
        check("the clock follows the player when it has drifted", at >= 90000 && at < 91000);
        int n = calls.size();
        f.bump("friend-token-0123456789", "nothing");
        can.add("soundcloud");
        f.playerRecheck();
        f.add("friend-token-0123456789", list.get(1));
        f.add("owner-token-0123456789", list.get(2), "soundcloud");
        check("queue changes do not restart the song", calls.size() == n);
        List<Object> q = Json.arr(f.state().get("queue"));
        check("each queued song says where it will play",
            "soundcloud".equals(Json.obj(q.get(0)).get("app")) && "soundcloud".equals(Json.obj(q.get(1)).get("app")));
        f.setPaused("owner-token-0123456789", true);
        check("pause reaches the player", calls.get(calls.size() - 1).endsWith("/paused/ytm"));
        f.setPaused("owner-token-0123456789", false);
        f.ended("owner-token-0123456789", k);
        check("the browser cannot end a whole song early", k.equals(Json.str(Json.obj(f.state().get("now")).get("key"))));
        f.playerEnded(k);
        check("the next song plays in the service its adder uses", calls.get(calls.size() - 1).equals(list.get(1).get("title") + "/playing/soundcloud"));
        f.retry("owner-token-0123456789");
        check("retry starts the song again", calls.get(calls.size() - 1).endsWith("/force"));
        f.playerEnded(Json.str(Json.obj(f.state().get("now")).get("key")));
        check("a host can add a song for another service", calls.get(calls.size() - 1).equals(list.get(2).get("title") + "/playing/soundcloud"));
        f.playerEnded(Json.str(Json.obj(f.state().get("now")).get("key")));
        check("an empty queue silences the player", calls.get(calls.size() - 1).startsWith("silence"));
        f.add("friend-token-0123456789", list.get(3));
        f.leave("owner-token-0123456789");
        check("if the phone's owner stops being host, their app stops and the room returns to previews",
            calls.get(calls.size() - 1).startsWith("silence") && "preview".equals(Json.obj(f.state().get("playback")).get("mode")));

        System.out.println(failed == 0 ? "\nAll checks passed" : "\n" + failed + " check(s) failed");
        System.exit(failed == 0 ? 0 : 1);
    }
}
