package app.musync.server;

import app.musync.core.Catalog;
import app.musync.core.RoomServer;

import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;

/**
 * Runs the musync server on a computer or cloud host:
 *
 *   java -jar musync-server.jar [--port 8787] [--web path/to/web] [--lan] [--sample-catalog]
 *
 * Without --web the client files bundled in the jar are served. --lan behaves
 * like the phone app (one room, code derived from this machine's address).
 * --sample-catalog searches a small built-in list instead of the internet.
 */
public final class Main {
    /**
     * Pretends to be a phone's music app so the whole-song flow can be tested on
     * a computer: every song "plays" for eight seconds and then ends.
     */
    private static final class TestPlayer implements app.musync.core.Room.Player {
        private final String mode; // "ready", "no-access" or "sign-in"
        private final java.util.Timer timer = new java.util.Timer(true);
        private volatile String current;

        TestPlayer(String mode) { this.mode = mode; }

        /** Stands in for a phone that can play two services, one that has not been given access, or one not signed in. */
        public String check(String app) {
            if (mode.equals("no-access")) return "no-access";
            if (mode.equals("sign-in") && app.equals("spotify")) return "sign-in";
            return app.equals("ytm") || app.equals("soundcloud") ? "ok" : "no-app";
        }

        public void seek(app.musync.core.Room room, String key, long ms) { }

        public void apply(final app.musync.core.Room room, final String key, java.util.Map<String, Object> song,
                          boolean paused, String app, boolean force) {
            if (key == null || (key.equals(current) && !force)) { if (key == null) current = null; return; }
            current = key;
            room.playerStatus("starting", "Finding the song");
            // Songs take a moment to start, then "play" for eight seconds.
            timer.schedule(new java.util.TimerTask() { public void run() {
                if (key.equals(current)) { room.playerStarted(key, 8000); room.playerStatus("ok", ""); }
            } }, 1200);
            timer.schedule(new java.util.TimerTask() { public void run() { if (key.equals(current)) room.playerEnded(key); } }, 9200);
        }
    }

    public static void main(String[] args) throws Exception {
        int port = RoomServer.DEFAULT_PORT;
        String web = null;
        boolean lan = false, sample = false;
        String testPlayer = null; // for automated tests only: stands in for the phone's music-app player
        String envPort = System.getenv("PORT");
        if (envPort != null && envPort.matches("\\d+")) port = Integer.parseInt(envPort);
        for (int i = 0; i < args.length; i++) {
            if (args[i].equals("--port") && i + 1 < args.length) port = Integer.parseInt(args[++i]);
            else if (args[i].equals("--web") && i + 1 < args.length) web = args[++i];
            else if (args[i].equals("--lan")) lan = true;
            else if (args[i].equals("--sample-catalog")) sample = true;
            else if (args[i].equals("--test-player") && i + 1 < args.length) testPlayer = args[++i];
            else { System.err.println("Unknown option: " + args[i]); System.exit(2); }
        }
        final File dir = web == null ? null : new File(web);
        RoomServer.Files files = new RoomServer.Files() {
            public InputStream open(String path) throws IOException {
                if (dir != null) return new FileInputStream(new File(dir, path));
                InputStream in = Main.class.getResourceAsStream("/web/" + path);
                if (in == null) throw new IOException("missing " + path);
                return in;
            }
        };
        RoomServer server = new RoomServer(files, sample ? new Catalog.Sample() : new Catalog.Live(), lan);
        if (testPlayer != null) server.setPlayer(new TestPlayer(testPlayer));
        int bound = server.start(port);
        System.out.println("musync is running on port " + bound);
        System.out.println("  on this computer: http://localhost:" + bound + "/");
        for (String a : server.addresses()) System.out.println("  on your network:  " + a);
        Thread.currentThread().join();
    }
}
