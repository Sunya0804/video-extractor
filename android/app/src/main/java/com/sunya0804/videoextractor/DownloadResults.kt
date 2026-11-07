package com.sunya0804.videoextractor

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

/** WebView가 백그라운드이거나 새로 만들어져도 알림의 완료 항목을 복원한다. */
object DownloadResults {
    private fun prefs(context: Context) = context.getSharedPreferences("download-results", Context.MODE_PRIVATE)

    @Synchronized fun pending(context: Context): JSONArray =
        runCatching { JSONArray(prefs(context).getString("pending", "[]")) }.getOrDefault(JSONArray())

    @Synchronized fun acknowledge(context: Context, ids: Set<String>) {
        val old = pending(context)
        val kept = JSONArray()
        for (i in 0 until old.length()) if (old.getJSONObject(i).optString("id") !in ids) kept.put(old.getJSONObject(i))
        prefs(context).edit().putString("pending", kept.toString()).commit()
    }

    @Synchronized fun finish(context: Context, job: JSONObject) {
        val id = job.getString("id")
        val status = job.getString("status")
        if (status !in listOf("done", "failed", "cancelled")) return
        val old = pending(context)
        val saved = JSONArray().put(job)
        for (i in 0 until old.length()) {
            val item = old.getJSONObject(i)
            if (item.optString("id") != id && saved.length() < 30) saved.put(item)
        }
        // 알림을 누르는 시점에는 항상 복원할 결과가 먼저 저장되어 있어야 한다.
        prefs(context).edit().putString("pending", saved.toString()).commit()
        if (status == "cancelled") return // 결과 복원은 하되 취소 알림은 띄우지 않는다.
        if (Build.VERSION.SDK_INT >= 33 && context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val manager = context.getSystemService(NotificationManager::class.java)
        KeepAliveService.ensureChannel(context)
        val open = Intent(context, MainActivity::class.java)
            .setAction(MainActivity.ACTION_SHOW_JOB)
            .setData(Uri.parse("videoextractor://download/${Uri.encode(id)}"))
            .putExtra(MainActivity.EXTRA_JOB_ID, id)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pending = PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(context, KeepAliveService.CHANNEL)
            .setSmallIcon(if (status == "done") android.R.drawable.stat_sys_download_done else android.R.drawable.stat_notify_error)
            .setContentTitle(if (status == "done") "다운로드 완료" else "다운로드 실패")
            .setContentText(job.optString("title", "Video Extractor"))
            .setContentIntent(pending).setAutoCancel(true).setOnlyAlertOnce(true).build()
        manager.notify("download:$id", 2, notification) // 진행 알림(id=1)과 서로 지우지 않는다.
    }
}
