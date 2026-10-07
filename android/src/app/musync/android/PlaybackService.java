package app.musync.android;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import java.util.Map;

/**
 * Keeps the room and the music going while musync is not on screen.
 *
 * Android stops apps that are in the background unless they show a
 * notification saying what they are doing. While this phone hosts a room,
 * this service shows that notification and keeps the processor and Wi-Fi
 * awake, so the queue keeps moving and friends can keep adding songs.
 */
public class PlaybackService extends Service {
    private static final String CHANNEL = "room";
    private static final int ID = 1;
    private static volatile boolean running;
    private static volatile String line = "";
    private PowerManager.WakeLock wake;
    private WifiManager.WifiLock wifi;

    /** Turns the service on while this phone hosts a room, off otherwise. Call only while musync is on screen. */
    static void set(Context ctx, boolean on) {
        Context app = ctx.getApplicationContext();
        try {
            if (on && !running) app.startService(new Intent(app, PlaybackService.class));
            else if (!on && running) app.stopService(new Intent(app, PlaybackService.class));
        } catch (RuntimeException ignored) {
            // Android refused; the room still works while musync is on screen.
        }
    }

    /** Updates the notification with the song that is playing. */
    static void describe(Context ctx, Map<String, Object> song) {
        String text = "";
        if (song != null) {
            Object t = song.get("title"), a = song.get("artist");
            text = (t == null ? "" : t.toString()) + (a == null || a.toString().length() == 0 ? "" : ", " + a);
        }
        if (text.equals(line)) return;
        line = text;
        if (!running) return;
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            nm.notify(ID, build(ctx.getApplicationContext()));
        } catch (RuntimeException ignored) { }
    }

    @SuppressWarnings("deprecation")
    private static Notification build(Context ctx) {
        Notification.Builder b = null;
        if (Build.VERSION.SDK_INT >= 26) {
            // Notification channels arrived in Android 8. This app is built against an older
            // toolkit, so they are reached by name.
            try {
                NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
                Class<?> channelClass = Class.forName("android.app.NotificationChannel");
                Object channel = channelClass.getConstructor(String.class, CharSequence.class, int.class)
                    .newInstance(CHANNEL, "Room is open", 2 /* low: no sound */);
                NotificationManager.class.getMethod("createNotificationChannel", channelClass).invoke(nm, channel);
                b = Notification.Builder.class.getConstructor(Context.class, String.class).newInstance(ctx, CHANNEL);
            } catch (Exception ignored) { }
        }
        if (b == null) b = new Notification.Builder(ctx);
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(ctx, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String now = line;
        return b.setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(now.length() > 0 ? now : "Your room is open")
            .setContentText(now.length() > 0 ? "Playing in your musync room" : "Friends can add songs. Nothing is playing.")
            .setContentIntent(tap)
            .setOngoing(true)
            .setShowWhen(false)
            .build();
    }

    @Override
    public void onCreate() {
        super.onCreate();
        running = true;
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "musync:room");
            wake.setReferenceCounted(false);
            wake.acquire();
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            wifi = wm.createWifiLock(WifiManager.WIFI_MODE_FULL, "musync:room");
            wifi.setReferenceCounted(false);
            wifi.acquire();
        } catch (RuntimeException ignored) { }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        try {
            startForeground(ID, build(getApplicationContext()));
        } catch (RuntimeException e) {
            stopSelf(); // Android would not allow it; the room still works while musync is on screen
        }
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (RuntimeException ignored) { }
        try { if (wifi != null && wifi.isHeld()) wifi.release(); } catch (RuntimeException ignored) { }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
