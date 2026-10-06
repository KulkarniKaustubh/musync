package app.syng.core;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ThreadFactory;

/**
 * The syng server: serves the web client, keeps rooms, pushes live updates and
 * proxies song search. One small HTTP/1.1 implementation, no dependencies.
 *
 * It runs in two places: inside the Android app, where the host's phone serves
 * one room to everyone on the same Wi-Fi ("LAN mode"), and standalone on any
 * computer or cloud host, where it can hold many rooms.
 */
public final class RoomServer {
    /** Where the web client's files come from (app assets, a folder, a jar). */
    public interface Files {
        InputStream open(String path) throws IOException;
    }

    public static final int DEFAULT_PORT = 8787;
    private static final String ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private static final int MAX_BODY = 64 * 1024;
    private static final int MAX_ROOMS = 500;

    private final Files files;
    private final Catalog catalog;
    private final boolean lanMode;
    private final Map<String, Room> rooms = new ConcurrentHashMap<String, Room>();
    private final SecureRandom random = new SecureRandom();
    private final ExecutorService pool = Executors.newCachedThreadPool(new ThreadFactory() {
        public Thread newThread(Runnable r) {
            Thread t = new Thread(r, "syng-http");
            t.setDaemon(true);
            return t;
        }
    });
    private volatile ServerSocket socket;
    private volatile boolean running;

    public RoomServer(Files files, Catalog catalog, boolean lanMode) {
        this.files = files;
        this.catalog = catalog;
        this.lanMode = lanMode;
    }

    /** Binds the first free port from {@code port} to {@code port + 4} and starts serving. */
    public synchronized int start(int port) throws IOException {
        IOException last = null;
        for (int p = port; p < port + 5; p++) {
            try {
                ServerSocket s = new ServerSocket();
                s.setReuseAddress(true);
                s.bind(new InetSocketAddress(p), 50);
                socket = s;
                break;
            } catch (IOException e) {
                last = e;
            }
        }
        if (socket == null) throw last;
        running = true;
        thread("syng-accept", new Runnable() { public void run() { acceptLoop(); } });
        thread("syng-clock", new Runnable() { public void run() { clockLoop(); } });
        return socket.getLocalPort();
    }

    public synchronized void stop() {
        running = false;
        try { if (socket != null) socket.close(); } catch (IOException ignored) { }
        pool.shutdownNow();
    }

    public int port() { return socket == null ? -1 : socket.getLocalPort(); }

    private static void thread(String name, Runnable r) {
        Thread t = new Thread(r, name);
        t.setDaemon(true);
        t.start();
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket s = socket.accept();
                pool.execute(new Runnable() { public void run() { serve(s); } });
            } catch (IOException e) {
                if (running) sleep(50);
            } catch (RuntimeException e) {
                sleep(50);
            }
        }
    }

    /** Once a second: move rooms along when a song runs out, and forget abandoned rooms. */
    private void clockLoop() {
        while (running) {
            sleep(1000);
            for (Iterator<Room> it = rooms.values().iterator(); it.hasNext();) {
                Room r = it.next();
                try {
                    r.tick();
                    boolean abandoned = r.connectionCount() == 0 && r.idleMs() > (r.isEmpty() ? 60000L : 6 * 3600000L);
                    if (abandoned) it.remove();
                } catch (RuntimeException ignored) { }
            }
        }
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
    }

    // ---------- room codes ----------

    /**
     * In LAN mode the code is the last two parts of the host's Wi-Fi address plus
     * a check digit, so a guest on the same network can find the host from four
     * characters with no directory service.
     */
    public static String codeForAddress(String ipv4) {
        String[] p = ipv4.split("\\.");
        int c = Integer.parseInt(p[2]), d = Integer.parseInt(p[3]);
        int check = (c ^ d ^ (c >> 4) ^ (d >> 4)) & 0xF;
        return encode((c << 12) | (d << 4) | check);
    }

    private static String encode(int v) {
        StringBuilder sb = new StringBuilder();
        for (int shift = 15; shift >= 0; shift -= 5) sb.append(ALPHABET.charAt((v >> shift) & 31));
        return sb.toString();
    }

    private String randomCode() {
        for (int i = 0; i < 50; i++) {
            String c = encode(random.nextInt(1 << 20));
            if (!rooms.containsKey(c)) return c;
        }
        throw new IllegalStateException("No free room codes");
    }

    /** Private IPv4 addresses of this machine, Wi-Fi style addresses first. */
    public static List<String> lanAddresses() {
        List<String> out = new ArrayList<String>();
        try {
            Enumeration<NetworkInterface> nis = NetworkInterface.getNetworkInterfaces();
            while (nis != null && nis.hasMoreElements()) {
                NetworkInterface ni = nis.nextElement();
                if (!ni.isUp() || ni.isLoopback()) continue;
                // Mobile data and VPN links also use private-looking addresses, but nobody nearby can reach them.
                String n = ni.getName() == null ? "" : ni.getName().toLowerCase(Locale.ROOT);
                if (n.contains("rmnet") || n.startsWith("ccmni") || n.startsWith("pdp") || n.startsWith("tun")
                        || n.startsWith("ppp") || n.startsWith("dummy") || n.startsWith("clat")) continue;
                Enumeration<InetAddress> as = ni.getInetAddresses();
                while (as.hasMoreElements()) {
                    InetAddress a = as.nextElement();
                    if (a instanceof Inet4Address && a.isSiteLocalAddress()) {
                        String name = ni.getName() == null ? "" : ni.getName();
                        if (name.startsWith("wlan") || name.startsWith("ap") || name.startsWith("swlan")) out.add(0, a.getHostAddress());
                        else out.add(a.getHostAddress());
                    }
                }
            }
        } catch (Exception ignored) { }
        return out;
    }

    // ---------- HTTP ----------

    private static final class Request {
        String method, path;
        Map<String, String> query = new HashMap<String, String>();
        Map<String, String> headers = new HashMap<String, String>();
        Map<String, Object> body = new HashMap<String, Object>();
        boolean local;
    }

    private static final class Halt extends Exception {
        final int status;
        Halt(int status, String message) { super(message); this.status = status; }
    }

    private void serve(Socket s) {
        try {
            s.setSoTimeout(15000);
            s.setTcpNoDelay(true);
            OutputStream out = s.getOutputStream();
            Request req;
            try {
                req = read(s);
            } catch (Halt h) {
                json(out, h.status, Json.map("error", h.getMessage()), false);
                return;
            }
            if (req == null) return;
            try {
                route(req, s, out);
            } catch (Halt h) {
                json(out, h.status, Json.map("error", h.getMessage()), false);
            } catch (Room.Denied d) {
                json(out, 409, Json.map("error", d.getMessage()), false);
            } catch (IllegalArgumentException e) {
                json(out, 400, Json.map("error", "That request could not be read."), false);
            }
        } catch (IOException ignored) {
            // the client went away
        } catch (RuntimeException e) {
            // never let one bad request take the server down
        } finally {
            try { s.close(); } catch (IOException ignored) { }
        }
    }

    private Request read(Socket s) throws IOException, Halt {
        InputStream in = s.getInputStream();
        ByteArrayOutputStream head = new ByteArrayOutputStream();
        int state = 0, b;
        while (state < 4) {
            b = in.read();
            if (b < 0) return null;
            head.write(b);
            if (head.size() > 16384) throw new Halt(431, "Request headers are too large.");
            state = (b == '\r' && (state == 0 || state == 2)) || (b == '\n' && (state == 1 || state == 3)) ? state + 1 : (b == '\r' ? 1 : 0);
        }
        String[] lines = head.toString("ISO-8859-1").split("\r\n");
        String[] first = lines[0].split(" ");
        if (first.length < 2) throw new Halt(400, "Bad request.");
        Request r = new Request();
        r.method = first[0];
        r.local = s.getInetAddress() != null && s.getInetAddress().isLoopbackAddress();
        String target = first[1];
        int q = target.indexOf('?');
        r.path = URLDecoder.decode(q < 0 ? target : target.substring(0, q), "UTF-8");
        if (q >= 0) {
            for (String pair : target.substring(q + 1).split("&")) {
                int eq = pair.indexOf('=');
                if (eq > 0) r.query.put(URLDecoder.decode(pair.substring(0, eq), "UTF-8"), URLDecoder.decode(pair.substring(eq + 1), "UTF-8"));
            }
        }
        for (int i = 1; i < lines.length; i++) {
            int c = lines[i].indexOf(':');
            if (c > 0) r.headers.put(lines[i].substring(0, c).trim().toLowerCase(Locale.ROOT), lines[i].substring(c + 1).trim());
        }
        int len = 0;
        try { len = Integer.parseInt(r.headers.containsKey("content-length") ? r.headers.get("content-length") : "0"); }
        catch (NumberFormatException e) { throw new Halt(400, "Bad request."); }
        if (len > MAX_BODY) throw new Halt(413, "Request is too large.");
        if (len > 0) {
            byte[] buf = new byte[len];
            int got = 0;
            while (got < len) {
                int n = in.read(buf, got, len - got);
                if (n < 0) return null;
                got += n;
            }
            r.body = Json.obj(Json.read(new String(buf, "UTF-8")));
        }
        return r;
    }

    private void route(Request req, Socket s, OutputStream out) throws IOException, Halt, Room.Denied {
        String p = req.path;
        boolean get = "GET".equals(req.method), post = "POST".equals(req.method);
        if ("OPTIONS".equals(req.method)) { raw(out, 204, "text/plain", new byte[0], true, false); return; }

        if (!p.startsWith("/api/")) {
            if (!get && !"HEAD".equals(req.method)) throw new Halt(405, "Method not allowed.");
            file(out, p);
            return;
        }

        if (get && p.equals("/api/info")) {
            List<String> lan = lanAddresses();
            json(out, 200, Json.map(
                    "lan", lanMode,
                    "addresses", lan,
                    "port", port(),
                    // Only the device running the server may start a room in LAN mode.
                    "canStart", !lanMode || req.local,
                    "local", req.local,
                    "code", lanMode && !lan.isEmpty() ? codeForAddress(lan.get(0)) : null), true);
            return;
        }

        if (post && p.equals("/api/rooms")) {
            if (lanMode && !req.local) throw new Halt(403, "Only the host's device can start a room here.");
            String token = Json.str(req.body.get("token"));
            Room room;
            if (lanMode) {
                List<String> lan = lanAddresses();
                String code = lan.isEmpty() ? "HOME" : codeForAddress(lan.get(0));
                // One room per phone. Starting again replaces the old one.
                rooms.clear();
                room = new Room(code);
            } else {
                if (rooms.size() >= MAX_ROOMS) throw new Halt(503, "This server is full. Try again later.");
                room = new Room(randomCode());
            }
            String me = room.join(token, Json.str(req.body.get("name")), Json.str(req.body.get("app")));
            rooms.put(room.code, room);
            json(out, 200, Json.map("me", me, "code", room.code, "state", room.state()), false);
            return;
        }

        if (get && p.equals("/api/search")) {
            Room room = room(req.query.get("code"));
            if (!room.isMember(req.query.get("token"))) throw new Halt(403, "Join the room to search.");
            String q = req.query.containsKey("q") ? req.query.get("q").trim() : "";
            if (q.length() == 0) { json(out, 200, Json.map("songs", new ArrayList<Object>(), "failed", new ArrayList<Object>()), false); return; }
            if (q.length() > 80) q = q.substring(0, 80);
            try {
                Catalog.Result r = catalog.search(q, req.query.get("src"), Locale.getDefault().getCountry());
                json(out, 200, Json.map("songs", r.songs, "failed", r.failed), false);
            } catch (IOException e) {
                throw new Halt(502, "Search can't reach the music catalogs. Check the internet connection on the host's device.");
            }
            return;
        }

        if (p.startsWith("/api/rooms/")) {
            String[] parts = p.substring("/api/rooms/".length()).split("/");
            String code = parts[0].toUpperCase(Locale.ROOT);
            String what = parts.length > 1 ? parts[1] : "";

            if (get && what.length() == 0) {
                Room r = rooms.get(code);
                json(out, 200, Json.map("exists", r != null), true);
                return;
            }
            Room room = room(code);

            if (post && what.equals("join")) {
                String me = room.join(Json.str(req.body.get("token")), Json.str(req.body.get("name")), Json.str(req.body.get("app")));
                json(out, 200, Json.map("me", me, "code", room.code, "state", room.state()), false);
                return;
            }
            if (get && what.equals("events")) {
                events(room, req.query.get("token"), s, out);
                return;
            }
            if (post && what.equals("act")) {
                act(room, req.body);
                json(out, 200, Json.map("ok", true), false);
                return;
            }
        }
        throw new Halt(404, "Not found.");
    }

    private Room room(String code) throws Halt {
        Room r = code == null ? null : rooms.get(code.toUpperCase(Locale.ROOT));
        if (r == null) throw new Halt(404, "That room has ended or the code is wrong.");
        return r;
    }

    private void act(Room room, Map<String, Object> b) throws Room.Denied, Halt {
        String token = Json.str(b.get("token")), type = Json.str(b.get("type")), key = Json.str(b.get("key"));
        if (type.equals("add")) room.add(token, catalog.lookup(Json.str(b.get("ref"))));
        else if (type.equals("bump")) room.bump(token, key);
        else if (type.equals("remove")) room.remove(token, key);
        else if (type.equals("skip")) room.skip(token, key);
        else if (type.equals("pause")) room.setPaused(token, true);
        else if (type.equals("play")) room.setPaused(token, false);
        else if (type.equals("ended")) room.ended(token, key);
        else if (type.equals("duration")) room.duration(token, key, Json.num(b.get("ms")));
        else if (type.equals("app")) room.setApp(token, Json.str(b.get("app")));
        else if (type.equals("leave")) room.leave(token);
        else throw new Halt(400, "Unknown action.");
    }

    /** Server-sent events: holds the connection open and writes each room update as it happens. */
    private void events(Room room, String token, Socket s, OutputStream out) throws IOException, Room.Denied {
        Room.Subscription sub = room.listen(token);
        try {
            s.setSoTimeout(0);
            out.write(("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nCache-Control: no-cache, no-store\r\n"
                    + "Connection: keep-alive\r\nX-Accel-Buffering: no\r\n\r\nretry: 1500\n\n").getBytes("UTF-8"));
            out.flush();
            while (running && !sub.isClosed()) {
                String message;
                try { message = sub.poll(10000); } catch (InterruptedException e) { break; }
                out.write((message != null ? message : ": keep-alive\n\n").getBytes("UTF-8"));
                out.flush();
            }
        } finally {
            room.unlisten(sub);
        }
    }

    private void file(OutputStream out, String path) throws IOException, Halt {
        if (path.equals("/")) path = "/index.html";
        if (path.contains("..") || !path.matches("/[A-Za-z0-9._/-]+")) throw new Halt(404, "Not found.");
        InputStream in;
        try {
            in = files.open(path.substring(1));
        } catch (IOException e) {
            throw new Halt(404, "Not found.");
        }
        if (in == null) throw new Halt(404, "Not found.");
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try {
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
        } finally {
            in.close();
        }
        raw(out, 200, mime(path), buf.toByteArray(), false, path.contains("/fonts/"));
    }

    private static String mime(String p) {
        if (p.endsWith(".html")) return "text/html; charset=utf-8";
        if (p.endsWith(".css")) return "text/css; charset=utf-8";
        if (p.endsWith(".js")) return "application/javascript; charset=utf-8";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".json")) return "application/json; charset=utf-8";
        return "text/plain; charset=utf-8";
    }

    private static void json(OutputStream out, int status, Object value, boolean cors) throws IOException {
        raw(out, status, "application/json; charset=utf-8", Json.write(value).getBytes("UTF-8"), cors, false);
    }

    private static void raw(OutputStream out, int status, String type, byte[] body, boolean cors, boolean cache) throws IOException {
        String reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 404 ? "Not Found" : status == 409 ? "Conflict" : "Error";
        StringBuilder h = new StringBuilder();
        h.append("HTTP/1.1 ").append(status).append(' ').append(reason).append("\r\n");
        h.append("Content-Type: ").append(type).append("\r\n");
        h.append("Content-Length: ").append(body.length).append("\r\n");
        h.append("Cache-Control: ").append(cache ? "public, max-age=86400" : "no-store").append("\r\n");
        h.append("X-Content-Type-Options: nosniff\r\n");
        if (cors) h.append("Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Private-Network: true\r\n");
        h.append("Connection: close\r\n\r\n");
        out.write(h.toString().getBytes("ISO-8859-1"));
        out.write(body);
        out.flush();
    }

    /** Shown by hosts so people know where to point a browser. */
    public List<String> addresses() {
        List<String> out = new ArrayList<String>();
        for (String a : lanAddresses()) out.add("http://" + a + ":" + port() + "/");
        return Collections.unmodifiableList(out);
    }
}
