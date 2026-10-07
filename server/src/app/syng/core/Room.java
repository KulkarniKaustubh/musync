package app.syng.core;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.TimeUnit;

/**
 * One room: its people, the song playing now and the queue. All public methods
 * are synchronized; every change is pushed to connected clients as the full
 * room state.
 *
 * Rules (placeholders until the product decides otherwise): anyone can add and
 * bump; the host can pause, skip and remove any song; a person can skip or
 * remove their own.
 */
public final class Room {
    public static final int MAX_PEOPLE = 60;
    public static final int MAX_QUEUE = 200;
    private static final String[] COLORS = {"coral", "sky", "mint", "lilac", "peach", "pink", "teal"};
    /** Previews run about 30 seconds; the host's player reports the real length. */
    private static final long DEFAULT_MS = 30000;
    /** Used for a full song until its real length is known. */
    private static final long FULL_DEFAULT_MS = 240000;

    /**
     * Something on the host's device that can play whole songs, such as the
     * Android app driving the host's own music app. The room tells it what
     * should be audible; it reports back the real length and when a song ends.
     */
    public interface Player {
        /**
         * Called whenever what should be playing changes. Must return at once.
         *
         * @param key   the entry to play, or null for silence
         * @param song  that entry's song data, or null
         * @param app   the host's music app id ("spotify", "apple", ...)
         * @param force true to start the song again even if it is the current one
         */
        void apply(Room room, String key, Map<String, Object> song, boolean paused, String app, boolean force);
    }

    public static final class Denied extends Exception {
        public Denied(String message) { super(message); }
    }

    private static final class Member {
        String id, token, name, label, app, color;
        int connections;
        long lastSeen;
    }

    private static final class Entry {
        String key;
        Map<String, Object> song;
        String by;
        long seq;
        final Set<String> bumps = new HashSet<String>();
    }

    /**
     * One client's live connection. The room only ever drops messages into the
     * mailbox; the connection's own thread writes them to the socket, so a slow
     * or sleeping phone can never hold up the room.
     */
    public static final class Subscription {
        private final Member member;
        private final BlockingQueue<String> mailbox = new ArrayBlockingQueue<String>(32);
        private volatile boolean closed;

        Subscription(Member member) { this.member = member; }

        /** Waits for the next message; null means nothing happened in that time. */
        public String poll(long ms) throws InterruptedException { return mailbox.poll(ms, TimeUnit.MILLISECONDS); }
        public boolean isClosed() { return closed; }
    }

    public final String code;
    private final Map<String, Member> byToken = new LinkedHashMap<String, Member>();
    private final List<Entry> queue = new ArrayList<Entry>();
    private final List<Subscription> listeners = new ArrayList<Subscription>();
    private int memberSeq = 0;
    private String hostId;
    private Entry now;
    private boolean paused;
    private long startedAt;      // server clock when the current song (re)started from position 0
    private long pausedAtMs;     // position when paused
    private long durationMs = DEFAULT_MS;
    private Player player;
    private String playerOwner;          // the person whose device the player runs on
    private boolean playerReady;         // that device can play whole songs right now
    private String playerStatus = "";    // short machine word: ok, starting, needs-open, failed, no-access, no-app
    private String playerDetail = "";    // one plain sentence for people
    private String lastApplied = "";
    private long seq = 0;
    private long lastActivity = System.currentTimeMillis();

    public Room(String code) { this.code = code; }

    // ---------- people ----------

    /** Adds the person, or updates them if this device has been here before. Returns their id. */
    public synchronized String join(String token, String name, String app) throws Denied {
        if (token == null || token.length() < 16 || token.length() > 80) throw new Denied("This device could not be identified. Reload and try again.");
        name = clean(name, 16);
        if (name.length() == 0) throw new Denied("Enter a name so friends know whose pick it is.");
        Member m = byToken.get(token);
        if (m == null) {
            if (byToken.size() >= MAX_PEOPLE) throw new Denied("This room is full.");
            m = new Member();
            m.token = token;
            m.id = "p" + (++memberSeq);
            m.color = COLORS[(memberSeq - 1) % COLORS.length];
            byToken.put(token, m);
            if (hostId == null) hostId = m.id;
        }
        m.name = name;
        m.app = clean(app, 24);
        m.lastSeen = System.currentTimeMillis();
        relabel();
        changed();
        return m.id;
    }

    /** Two people can share a name, so later arrivals get a number: "Maya (2)". */
    private void relabel() {
        Map<String, Integer> count = new LinkedHashMap<String, Integer>();
        for (Member m : byToken.values()) {
            String k = m.name.toLowerCase();
            int n = count.containsKey(k) ? count.get(k) + 1 : 1;
            count.put(k, n);
            m.label = n == 1 ? m.name : m.name + " (" + n + ")";
        }
    }

    private Member member(String token) throws Denied {
        Member m = token == null ? null : byToken.get(token);
        if (m == null) throw new Denied("You are not in this room any more. Join again.");
        m.lastSeen = System.currentTimeMillis();
        return m;
    }

    public synchronized boolean isMember(String token) { return token != null && byToken.containsKey(token); }
    public synchronized boolean isEmpty() { return byToken.isEmpty(); }
    public synchronized long idleMs() { return System.currentTimeMillis() - lastActivity; }
    public synchronized int connectionCount() { return listeners.size(); }

    // ---------- actions ----------

    public synchronized void setApp(String token, String app) throws Denied {
        member(token).app = clean(app, 24);
        changed();
    }

    public synchronized void add(String token, Map<String, Object> song) throws Denied {
        Member m = member(token);
        if (song == null) throw new Denied("That song is no longer available. Search for it again.");
        String ref = (String) song.get("ref");
        if (now != null && ref.equals(now.song.get("ref"))) throw new Denied("That song is playing now.");
        for (Entry e : queue) if (ref.equals(e.song.get("ref"))) throw new Denied("That song is already in the queue.");
        if (queue.size() >= MAX_QUEUE) throw new Denied("The queue is full.");
        Entry e = new Entry();
        e.key = "e" + (++seq);
        e.seq = seq;
        e.song = song;
        e.by = m.id;
        if (now == null) start(e); else queue.add(e);
        changed();
    }

    public synchronized void bump(String token, String key) throws Denied {
        Member m = member(token);
        Entry e = find(key);
        if (e == null) return; // it started playing or was removed a moment ago
        if (!e.bumps.remove(m.id)) e.bumps.add(m.id);
        changed();
    }

    public synchronized void remove(String token, String key) throws Denied {
        Member m = member(token);
        Entry e = find(key);
        if (e == null) return;
        if (!m.id.equals(hostId) && !m.id.equals(e.by)) throw new Denied("Only the host or the person who added a song can remove it.");
        queue.remove(e);
        changed();
    }

    public synchronized void skip(String token, String key) throws Denied {
        Member m = member(token);
        if (now == null || !now.key.equals(key)) return; // already moved on
        if (!m.id.equals(hostId) && !m.id.equals(now.by)) throw new Denied("Only the host or the person who added this song can skip it.");
        next();
        changed();
    }

    public synchronized void setPaused(String token, boolean pause) throws Denied {
        Member m = member(token);
        if (!m.id.equals(hostId)) throw new Denied("Only the host can pause the room.");
        if (now == null || paused == pause) return;
        long t = System.currentTimeMillis();
        if (pause) pausedAtMs = Math.min(durationMs, t - startedAt);
        else startedAt = t - pausedAtMs;
        paused = pause;
        changed();
    }

    // ---------- whole-song playback on the host's device ----------

    /** Attaches the device player. It is only used while its owner is the host. */
    public synchronized void setPlayer(Player p, String ownerId) {
        player = p;
        playerOwner = ownerId;
        changed();
    }

    /** True when whole songs play on the host's device rather than previews in the browser. */
    private boolean full() {
        return player != null && playerReady && hostId != null && hostId.equals(playerOwner);
    }

    public synchronized boolean isFull() { return full(); }

    public synchronized String hostApp() {
        for (Member m : byToken.values()) if (m.id.equals(hostId)) return m.app;
        return "";
    }

    /** The device player says whether it can play whole songs, and why not if it cannot. */
    public synchronized void playerMode(boolean ready, String status, String detail) {
        boolean was = full();
        playerReady = ready;
        playerStatus = status == null ? "" : status;
        playerDetail = detail == null ? "" : detail;
        if (full() != was && now != null) {
            // Switching between previews and whole songs: the current song starts over.
            durationMs = full() ? fullLength(now) : DEFAULT_MS;
            startedAt = System.currentTimeMillis();
            pausedAtMs = 0;
            paused = false;
        }
        changed();
    }

    public synchronized void playerStatus(String status, String detail) {
        String s = status == null ? "" : status, d = detail == null ? "" : detail;
        if (s.equals(playerStatus) && d.equals(playerDetail)) return;
        playerStatus = s;
        playerDetail = d;
        changed();
    }

    /** The device player started the song and knows its real length. The clock restarts from here. */
    public synchronized void playerStarted(String key, long ms) {
        if (!full() || now == null || !now.key.equals(key)) return;
        if (ms >= 5000 && ms <= 3600000) durationMs = ms;
        startedAt = System.currentTimeMillis();
        pausedAtMs = 0;
        changed();
    }

    public synchronized void playerEnded(String key) {
        if (!full() || now == null || !now.key.equals(key)) return;
        next();
        changed();
    }

    /** The host asks the device player to start the current song again. */
    public synchronized void retry(String token) throws Denied {
        Member m = member(token);
        if (!m.id.equals(hostId)) throw new Denied("Only the host can restart playback.");
        if (player != null && full()) {
            lastApplied = "";
            notifyPlayer(true);
        }
    }

    private static long fullLength(Entry e) {
        long ms = Json.num(e.song.get("ms"));
        return ms >= 5000 ? ms : FULL_DEFAULT_MS;
    }

    /** Tells the device player what should be audible, once per real change. */
    private void notifyPlayer(boolean force) {
        if (player == null) return;
        boolean on = full();
        String app = hostApp();
        String sig = on + "|" + (now == null ? "-" : now.key) + "|" + paused + "|" + app;
        if (!force && sig.equals(lastApplied)) return;
        lastApplied = sig;
        try {
            if (on && now != null) player.apply(this, now.key, now.song, paused, app, force);
            else player.apply(this, null, null, false, app, force);
        } catch (RuntimeException ignored) {
            // a misbehaving player must not break the room
        }
    }

    /** The host's player says the current song finished. */
    public synchronized void ended(String token, String key) throws Denied {
        Member m = member(token);
        if (full()) return; // the device player decides when whole songs end
        if (!m.id.equals(hostId) || now == null || !now.key.equals(key)) return;
        next();
        changed();
    }

    /** The host's player reports how long the clip really is. */
    public synchronized void duration(String token, String key, long ms) throws Denied {
        Member m = member(token);
        if (full()) return;
        if (!m.id.equals(hostId) || now == null || !now.key.equals(key)) return;
        if (ms < 1000 || ms > 900000 || Math.abs(ms - durationMs) < 500) return;
        durationMs = ms;
        changed();
    }

    public synchronized void leave(String token) {
        Member m = byToken.remove(token);
        if (m == null) return;
        if (m.id.equals(hostId)) {
            // Hand the room to whoever has been here longest.
            hostId = byToken.isEmpty() ? null : byToken.values().iterator().next().id;
        }
        relabel();
        changed();
    }

    /** Called about once a second: moves on when a song has run its length and nobody reported the end. */
    public synchronized void tick() {
        if (now == null || paused) return;
        // With a device player the end normally comes from it; this is the safety net.
        long grace = full() ? 20000 : 2500;
        if (System.currentTimeMillis() - startedAt > durationMs + grace) {
            next();
            changed();
        }
    }

    private void start(Entry e) {
        now = e;
        paused = false;
        durationMs = full() ? fullLength(e) : DEFAULT_MS;
        startedAt = System.currentTimeMillis();
        pausedAtMs = 0;
    }

    private void next() {
        sort();
        if (queue.isEmpty()) { now = null; paused = false; }
        else start(queue.remove(0));
    }

    private Entry find(String key) {
        for (Entry e : queue) if (e.key.equals(key)) return e;
        return null;
    }

    private void sort() {
        Collections.sort(queue, new Comparator<Entry>() {
            public int compare(Entry a, Entry b) {
                if (a.bumps.size() != b.bumps.size()) return b.bumps.size() - a.bumps.size();
                return a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0;
            }
        });
    }

    private static String clean(String s, int max) {
        if (s == null) return "";
        s = s.replaceAll("[\\p{Cntrl}<>]", " ").trim().replaceAll("\\s+", " ");
        return s.length() > max ? s.substring(0, max).trim() : s;
    }

    // ---------- state and live updates ----------

    public synchronized Map<String, Object> state() {
        sort();
        List<Object> people = new ArrayList<Object>();
        for (Member m : byToken.values()) {
            people.add(Json.map("id", m.id, "name", m.label, "app", m.app, "color", m.color,
                    "host", m.id.equals(hostId), "online", m.connections > 0));
        }
        List<Object> q = new ArrayList<Object>();
        for (Entry e : queue) q.add(entry(e));
        long t = System.currentTimeMillis();
        Object playing = null;
        if (now != null) {
            Map<String, Object> n = entry(now);
            n.put("paused", paused);
            n.put("position", paused ? pausedAtMs : Math.max(0, Math.min(durationMs, t - startedAt)));
            n.put("duration", durationMs);
            playing = n;
        }
        Map<String, Object> playback = Json.map("mode", full() ? "full" : "preview", "app", hostApp(),
                "device", player != null && hostId != null && hostId.equals(playerOwner),
                "status", playerStatus, "detail", playerDetail);
        return Json.map("code", code, "hostId", hostId, "people", people, "now", playing, "queue", q,
                "playback", playback, "serverTime", t);
    }

    private Map<String, Object> entry(Entry e) {
        return Json.map("key", e.key, "song", e.song, "by", e.by, "bumps", new ArrayList<Object>(e.bumps));
    }

    /** Opens a live connection for this person. The first message is the current state. */
    public synchronized Subscription listen(String token) throws Denied {
        Member m = member(token);
        Subscription l = new Subscription(m);
        listeners.add(l);
        m.connections++;
        changed();
        return l;
    }

    public synchronized void unlisten(Subscription l) {
        l.closed = true;
        if (!listeners.remove(l)) return;
        l.member.connections = Math.max(0, l.member.connections - 1);
        changed();
    }

    private void changed() {
        lastActivity = System.currentTimeMillis();
        notifyPlayer(false);
        if (listeners.isEmpty()) return;
        Map<String, Object> state = state();
        List<Subscription> stuck = new ArrayList<Subscription>();
        for (Subscription l : listeners) {
            String message = "data: " + Json.write(Json.map("me", l.member.id, "state", state)) + "\n\n";
            if (!l.mailbox.offer(message)) stuck.add(l); // not reading: drop it, the client reconnects
        }
        if (stuck.isEmpty()) return;
        for (Subscription l : stuck) {
            l.closed = true;
            listeners.remove(l);
            l.member.connections = Math.max(0, l.member.connections - 1);
        }
        changed();
    }
}
