package app.musync.android;

import android.content.Context;

import app.musync.core.Room;

import java.util.Map;

/**
 * Sends each song to the right player on the host's phone: the built-in web
 * player for the services musync has one for, otherwise the music app
 * installed on the phone.
 */
final class HostPlayer implements Room.Player {
    final AppPlayer apps;
    final WebPlayer[] web;
    private final Context ctx;
    private Room.Player current;
    private volatile Room room;

    HostPlayer(Context ctx) {
        this.ctx = ctx.getApplicationContext();
        apps = new AppPlayer(ctx);
        web = new WebPlayer[] {
            new WebPlayer(ctx, WebPlayer.YOUTUBE_MUSIC),
            new WebPlayer(ctx, WebPlayer.SOUNDCLOUD),
            new WebPlayer(ctx, WebPlayer.SPOTIFY),
        };
    }

    /** The built-in web player for a music app, or null when songs go to the installed app. */
    WebPlayer webFor(String app) {
        for (WebPlayer w : web) if (w.site.id.equals(app)) return w;
        return null;
    }

    private Room.Player playerFor(String app) {
        WebPlayer w = webFor(app);
        return w != null ? w : apps;
    }

    @Override
    public String check(String app) {
        return playerFor(app).check(app);
    }

    @Override
    public synchronized void seek(Room r, String key, long ms) {
        if (current != null) current.seek(r, key, ms);
    }

    @Override
    public synchronized void apply(Room r, String key, Map<String, Object> song, boolean paused, String app, boolean force) {
        room = r;
        Room.Player next = playerFor(app == null ? "" : app);
        if (current != null && current != next) {
            // The next song belongs to a different player: silence the one that had the room.
            if (current == apps) apps.stop(); else ((WebPlayer) current).stop();
        }
        current = next;
        next.apply(r, key, song, paused, app, force);
        PlaybackService.describe(ctx, key == null ? null : song);
    }

    /** What this phone can play may have changed (access granted, signed in): have the room ask again. */
    void recheck() {
        Room r = room;
        if (r != null) {
            try { r.playerRecheck(); } catch (RuntimeException ignored) { }
        }
    }
}
