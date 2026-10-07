package app.musync.android;

import app.musync.core.Room;

import java.util.Map;

/**
 * Sends each song to the right player for the host's chosen music app:
 * the built-in web player where musync has one, otherwise the app installed
 * on the phone.
 */
final class HostPlayer implements Room.Player {
    final AppPlayer apps;
    final WebPlayer web;
    private String current = "";

    HostPlayer(AppPlayer apps, WebPlayer web) {
        this.apps = apps;
        this.web = web;
    }

    static boolean usesWeb(String app) {
        return WebPlayer.APP.equals(app);
    }

    @Override
    public synchronized void apply(Room room, String key, Map<String, Object> song, boolean paused, String app, boolean force) {
        if (app == null) app = "";
        boolean toWeb = usesWeb(app);
        if (!app.equals(current)) {
            // The host changed music apps: silence whichever player had the room.
            if (toWeb && !usesWeb(current)) apps.stop();
            if (!toWeb && usesWeb(current)) web.stop();
            current = app;
        }
        if (toWeb) web.apply(room, key, song, paused, app, force);
        else apps.apply(room, key, song, paused, app, force);
    }

    /** Called when musync comes back on screen: the user may have just granted access. */
    synchronized void recheck() {
        if (!usesWeb(current)) apps.recheck();
    }
}
