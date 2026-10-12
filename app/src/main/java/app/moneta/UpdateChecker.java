package app.moneta;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;

import androidx.appcompat.app.AlertDialog;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Проверка обновлений. Если есть интернет, раз в несколько часов спрашивает у GitHub последний релиз
 * (его создаёт сборка в GitHub Actions). Если номер сборки новее установленной, предлагает скачать APK.
 * Без интернета, при ошибке или в приватном репозитории молча ничего не делает: приложение работает как обычно.
 */
final class UpdateChecker {
    private static final long CHECK_EVERY_MS = 6L * 60 * 60 * 1000;   // не чаще раза в 6 часов
    private static final long SNOOZE_MS = 24L * 60 * 60 * 1000;       // «Позже» — не спрашивать сутки про ту же версию

    private UpdateChecker() {}

    static void check(final Activity activity) {
        final String repo = BuildConfig.UPDATE_REPO;
        if (repo == null || repo.isEmpty() || !online(activity)) return;
        final SharedPreferences p = activity.getSharedPreferences("update", Context.MODE_PRIVATE);
        final long now = System.currentTimeMillis();
        if (now - p.getLong("checkedAt", 0) < CHECK_EVERY_MS) return;

        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL("https://api.github.com/repos/" + repo + "/releases/latest").openConnection();
                c.setConnectTimeout(6000);
                c.setReadTimeout(6000);
                c.setRequestProperty("Accept", "application/vnd.github+json");
                c.setRequestProperty("User-Agent", "Moneta-Updater");
                if (c.getResponseCode() != 200) return;       // нет релизов или приватный репозиторий
                StringBuilder sb = new StringBuilder();
                try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), "UTF-8"))) {
                    String line;
                    while ((line = r.readLine()) != null) sb.append(line);
                }
                JSONObject j = new JSONObject(sb.toString());
                String tag = j.optString("tag_name", "");              // build-123
                int latest = Integer.parseInt(tag.replaceAll("[^0-9]", ""));
                String url = null;
                JSONArray assets = j.optJSONArray("assets");
                for (int i = 0; assets != null && i < assets.length(); i++) {
                    JSONObject a = assets.getJSONObject(i);
                    if (a.optString("name", "").endsWith(".apk")) { url = a.optString("browser_download_url", null); break; }
                }
                p.edit().putLong("checkedAt", System.currentTimeMillis()).apply();
                if (url == null || latest <= BuildConfig.VERSION_CODE) return;
                if (p.getInt("snoozedBuild", -1) == latest && now - p.getLong("snoozedAt", 0) < SNOOZE_MS) return;
                final int build = latest;
                final String apk = url;
                activity.runOnUiThread(() -> show(activity, p, build, apk));
            } catch (Exception ignored) {
                // нет сети, таймаут, неожиданный ответ — просто пропускаем
            } finally {
                if (c != null) c.disconnect();
            }
        }, "update-check").start();
    }

    private static void show(Activity a, SharedPreferences p, int build, String apkUrl) {
        if (a.isFinishing() || a.isDestroyed()) return;
        new AlertDialog.Builder(a)
                .setTitle("Доступно обновление")
                .setMessage("Вышла новая версия Moneta. Ваши цели и история сохранятся.\n\nСкачайте файл и откройте его, чтобы обновить приложение.")
                .setPositiveButton("Скачать", (d, w) -> {
                    try { a.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(apkUrl))); } catch (Exception ignored) { /* нет браузера */ }
                })
                .setNegativeButton("Позже", (d, w) ->
                        p.edit().putInt("snoozedBuild", build).putLong("snoozedAt", System.currentTimeMillis()).apply())
                .show();
    }

    private static boolean online(Context ctx) {
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            NetworkCapabilities nc = cm.getNetworkCapabilities(cm.getActiveNetwork());
            return nc != null && nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);
        } catch (Exception e) {
            return false;
        }
    }
}
