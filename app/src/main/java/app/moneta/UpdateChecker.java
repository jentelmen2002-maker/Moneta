package app.moneta;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import androidx.appcompat.app.AlertDialog;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Проверка обновлений. Если есть интернет, при каждом запуске спрашивает у GitHub последний релиз
 * (его создаёт сборка в GitHub Actions). Если номер сборки новее установленной, предлагает скачать APK.
 * Без интернета, при ошибке или в приватном репозитории молча ничего не делает: приложение работает как обычно.
 */
final class UpdateChecker {
    private static boolean checkedThisLaunch = false;                  // один запрос на запуск приложения
    private static final long SNOOZE_MS = 24L * 60 * 60 * 1000;       // «Позже» — не спрашивать сутки про ту же версию

    private UpdateChecker() {}

    static void check(final Activity activity) {
        cleanup(activity);
        final String repo = BuildConfig.UPDATE_REPO;
        if (repo == null || repo.isEmpty() || !online(activity)) return;
        if (checkedThisLaunch) return;
        checkedThisLaunch = true;
        final SharedPreferences p = activity.getSharedPreferences("update", Context.MODE_PRIVATE);
        final long now = System.currentTimeMillis();

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
                .setMessage("Вышла новая версия Moneta. Ваши цели и история сохранятся.\n\nПриложение скачает обновление и предложит его установить. Файл после установки удалится сам.")
                .setPositiveButton("Скачать", (d, w) -> {
                    download(a, apkUrl);
                })
                .setNegativeButton("Позже", (d, w) ->
                        p.edit().putInt("snoozedBuild", build).putLong("snoozedAt", System.currentTimeMillis()).apply())
                .show();
    }

    /** Удаляет ранее скачанный APK (после установки он не нужен). */
    private static void cleanup(Context ctx) {
        try {
            File[] fs = new File(ctx.getCacheDir(), "updates").listFiles();
            if (fs != null) for (File f : fs) f.delete();
        } catch (Exception ignored) { }
    }

    private static void download(final Activity a, final String apkUrl) {
        // Android 8+: без разрешения «Установка неизвестных приложений» установщик не откроется — просим один раз
        if (Build.VERSION.SDK_INT >= 26 && !a.getPackageManager().canRequestPackageInstalls()) {
            Toast.makeText(a, "Разрешите Moneta устанавливать обновления и нажмите «Назад»", Toast.LENGTH_LONG).show();
            try {
                a.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + a.getPackageName())));
            } catch (Exception ignored) { }
            return;
        }
        final AlertDialog wait = new AlertDialog.Builder(a).setTitle("Загрузка обновления").setMessage("Подождите немного…").setCancelable(false).create();
        wait.show();
        new Thread(() -> {
            File out = null;
            HttpURLConnection c = null;
            try {
                File dir = new File(a.getCacheDir(), "updates");
                dir.mkdirs();
                cleanup(a);
                out = new File(dir, "Moneta.apk");
                c = (HttpURLConnection) new URL(apkUrl).openConnection();
                c.setConnectTimeout(10000);
                c.setReadTimeout(20000);
                c.setInstanceFollowRedirects(true);
                if (c.getResponseCode() != 200) throw new Exception("http " + c.getResponseCode());
                try (InputStream in = c.getInputStream(); OutputStream os = new FileOutputStream(out)) {
                    byte[] buf = new byte[16384];
                    int n;
                    while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
                }
                final File apk = out;
                a.runOnUiThread(() -> {
                    wait.dismiss();
                    try {
                        Uri u = FileProvider.getUriForFile(a, a.getPackageName() + ".fileprovider", apk);
                        Intent i = new Intent(Intent.ACTION_VIEW);
                        i.setDataAndType(u, "application/vnd.android.package-archive");
                        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                        a.startActivity(i);
                    } catch (Exception e) {
                        Toast.makeText(a, "Не удалось открыть установщик", Toast.LENGTH_LONG).show();
                    }
                });
            } catch (Exception e) {
                if (out != null) out.delete();
                a.runOnUiThread(() -> {
                    wait.dismiss();
                    Toast.makeText(a, "Не удалось скачать обновление. Проверьте интернет.", Toast.LENGTH_LONG).show();
                });
            } finally {
                if (c != null) c.disconnect();
            }
        }, "update-download").start();
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
