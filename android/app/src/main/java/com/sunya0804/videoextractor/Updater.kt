package com.sunya0804.videoextractor

import android.app.AlertDialog
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageInstaller
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.widget.Toast
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** GitHub의 최신 APK를 캐시에 받은 뒤 Android의 설치 확인 화면으로 넘긴다. */
class Updater(private val activity: MainActivity, private val changed: (JSONObject) -> Unit) {
    private val worker = Executors.newSingleThreadExecutor()
    private val folder = File(activity.cacheDir, "updates")
    @Volatile private var status = "앱 버전"
    @Volatile private var progress = 0
    @Volatile private var latest = ""
    private var lastCheck = 0L
    private var ready: File? = null
    private var waitingForPermission = false
    private var installing = false

    fun snapshot() = JSONObject().put("status", status).put("progress", progress)
        .put("latest", latest).put("current", BuildConfig.VERSION_NAME)

    private fun state(text: String, percent: Int = 0) {
        status = text
        progress = percent
        changed(snapshot())
    }

    fun checkIfDue() {
        if (waitingForPermission) {
            waitingForPermission = false
            if (activity.packageManager.canRequestPackageInstalls()) install()
            else state("이 출처의 앱 설치 허용이 필요합니다")
            return
        }
        if (System.currentTimeMillis() - lastCheck >= SIX_HOURS) check()
    }

    @Synchronized fun check(): JSONObject {
        // 브리지와 onResume이 동시에 호출해도 확인을 중복 예약하지 않는다.
        if (status == "업데이트 확인 중" || status.startsWith("새 버전 받는 중")) return snapshot()
        lastCheck = System.currentTimeMillis()
        state("업데이트 확인 중")
        worker.execute {
            try { fetchLatest() } catch (error: Exception) { state("업데이트 확인 실패: ${error.message}") }
        }
        return snapshot()
    }

    private fun connection(address: String): HttpURLConnection {
        require(address.startsWith("https://")) { "HTTPS 업데이트 주소가 필요합니다" }
        return (URL(address).openConnection() as HttpURLConnection).apply {
            connectTimeout = 15000
            readTimeout = 60000
            setRequestProperty("User-Agent", "VideoExtractor-Android")
        }
    }

    private fun fetchLatest() {
        val conn = connection(LATEST)
        val release = try {
            if (conn.responseCode == 404) { state("최신 버전입니다 (게시된 릴리스 없음)"); return }
            check(conn.responseCode == 200) { "GitHub 응답 ${conn.responseCode}" }
            conn.inputStream.bufferedReader().use { JSONObject(it.readText()) }
        } finally { conn.disconnect() }
        val version = release.getString("tag_name").removePrefix("v")
        require(Regex("\\d+\\.\\d+\\.\\d+").matches(version)) { "지원하지 않는 버전 형식" }
        if (!newer(version, BuildConfig.VERSION_NAME)) { latest = ""; ready = null; state("최신 버전입니다"); return }
        val assets = release.getJSONArray("assets")
        val asset = (0 until assets.length()).map { assets.getJSONObject(it) }.firstOrNull { it.getString("name").endsWith(".apk") }
            ?: throw IllegalStateException("안드로이드 APK가 아직 없습니다")
        latest = version
        folder.mkdirs()
        val file = File(folder, "VideoExtractor-$version.apk")
        val size = asset.getLong("size")
        require(size > 0) { "빈 APK" }
        if (!file.exists() || file.length() != size) {
            val part = File(folder, "${file.name}.part")
            val download = connection(asset.getString("browser_download_url"))
            try {
                check(download.responseCode == 200) { "APK 응답 ${download.responseCode}" }
                var got = 0L
                var lastPercent = -1
                download.inputStream.use { input -> part.outputStream().use { output ->
                    val buffer = ByteArray(65536)
                    while (true) {
                        if (Thread.currentThread().isInterrupted) throw InterruptedException()
                        val n = input.read(buffer)
                        if (n < 0) break
                        got += n
                        check(got <= size) { "APK 크기가 맞지 않습니다" }
                        output.write(buffer, 0, n)
                        val percent = (got * 100 / size).toInt()
                        if (percent != lastPercent) { lastPercent = percent; state("새 버전 받는 중", percent) }
                    }
                } }
                check(part.length() == size) { "APK 크기가 맞지 않습니다" }
                check(part.renameTo(file)) { "APK를 저장하지 못했습니다" }
            } finally { download.disconnect(); part.delete() }
        }
        // 패키지·서명은 최종적으로 PackageInstaller가 검증한다.
        ready = file
        state("설치 준비됨", 100)
        activity.runOnUiThread {
            if (!activity.isFinishing && !activity.isDestroyed) AlertDialog.Builder(activity)
                .setTitle("Video Extractor 업데이트")
                .setMessage("새 버전 $version 을 받았습니다. 설치하면 앱이 닫힙니다. 지금 설치할까요?")
                .setPositiveButton("설치") { _, _ -> install() }.setNegativeButton("나중에", null).show()
        }
    }

    fun install(): JSONObject {
        activity.runOnUiThread {
            if (ready == null) { check(); return@runOnUiThread }
            if (!activity.packageManager.canRequestPackageInstalls()) {
                waitingForPermission = true
                state("이 출처의 앱 설치 허용이 필요합니다")
                Toast.makeText(activity, "Video Extractor의 '이 출처의 앱 설치 허용'을 켠 뒤 돌아오세요", Toast.LENGTH_LONG).show()
                activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}")))
                return@runOnUiThread
            }
            if (installing) return@runOnUiThread
            installing = true
            val file = ready ?: return@runOnUiThread
            worker.execute {
                val installer = activity.packageManager.packageInstaller
                var id: Int? = null
                try {
                    val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply { setAppPackageName(activity.packageName) }
                    val sessionId = installer.createSession(params)
                    id = sessionId
                    installer.openSession(sessionId).use { session ->
                        file.inputStream().use { input -> session.openWrite("VideoExtractor.apk", 0, file.length()).use { output -> input.copyTo(output); session.fsync(output) } }
                        val result = Intent(activity, MainActivity::class.java).setAction(ACTION_INSTALL_STATUS)
                        val pending = PendingIntent.getActivity(activity, sessionId, result, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE)
                        state("설치 확인 대기 중")
                        session.commit(pending.intentSender)
                    }
                } catch (error: Exception) {
                    id?.let { runCatching { installer.abandonSession(it) } }
                    state("설치 실패: ${error.message}")
                } finally { activity.runOnUiThread { installing = false } }
            }
        }
        return snapshot()
    }

    fun onInstallStatus(intent: Intent) {
        val result = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
        if (result == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            @Suppress("DEPRECATION")
            val confirm = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java) else intent.getParcelableExtra<Intent>(Intent.EXTRA_INTENT)
            if (confirm != null) activity.startActivity(confirm)
        } else if (result == PackageInstaller.STATUS_SUCCESS) state("설치 완료")
        else state(if (result == PackageInstaller.STATUS_FAILURE_ABORTED) "설치를 취소했습니다" else "설치 실패: ${intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)}")
    }

    fun stop() { worker.shutdownNow() }

    companion object {
        const val ACTION_INSTALL_STATUS = "com.sunya0804.videoextractor.INSTALL_STATUS"
        const val SIX_HOURS = 6 * 60 * 60 * 1000L
        const val LATEST = "https://api.github.com/repos/Sunya0804/video-extractor/releases/latest"
        fun newer(a: String, b: String): Boolean {
            val x = a.split('.').map { it.toIntOrNull() ?: 0 }
            val y = b.split('.').map { it.toIntOrNull() ?: 0 }
            for (i in 0 until maxOf(x.size, y.size)) {
                val left = x.getOrElse(i) { 0 }; val right = y.getOrElse(i) { 0 }
                if (left != right) return left > right
            }
            return false
        }
    }
}
