package app.syng.android;

import android.service.notification.NotificationListenerService;

/**
 * Exists only so the user can grant syng "notification access".
 *
 * Android gives apps with that access the ability to see and control what
 * other apps are playing (the same mechanism smart watches and car screens
 * use). syng needs it to start each song in the host's music app and to know
 * when the song ends. This service does nothing with notifications: it does
 * not read, store or act on them.
 */
public class MediaAccessService extends NotificationListenerService {
}
