package com.sunya0804.videoextractor

import android.Manifest
import android.app.DownloadManager
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import com.yausername.ffmpeg.FFmpeg
import com.yausername.youtubedl_android.YoutubeDL
import com.yausername.youtubedl_android.YoutubeDLException
import com.yausername.youtubedl_android.YoutubeDLRequest
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * VXNative 브리지(docs/android-bridge.md). 호출마다 백그라운드 스레드에서 돌고, 결과는 메인 스레드에서 JS로 돌려준다.
 * 스레드 풀은 제한이 없어 다운로드(최대 2개, JS가 조절)가 도는 중에도 ytdlp/fetch가 막히지 않는다.
 */
class Bridge(private val activity: MainActivity) {
    private val pool = Executors.newCachedThreadPool()
    private val main = Handler(Looper.getMainLooper())
    private val ctx = activity.applicationContext
    private val engineReady by lazy {
        YoutubeDL.getInstance().init(ctx)
        FFmpeg.getInstance().init(ctx)
        true
    }

    @JavascriptInterface
    fun call(callId: String, method: String, argsJson: String?) {
        pool.execute {
            try {
                val args = if (argsJson.isNullOrBlank()) JSONObject() else JSONObject(argsJson)
                send("window.__vxNative.resolve(${JSONObject.quote(callId)}, ${JSONObject.quote(run(method, args).toString())})")
            } catch (error: Throwable) {
                send("window.__vxNative.reject(${JSONObject.quote(callId)}, ${JSONObject.quote(error.message ?: error.toString())})")
            }
        }
    }

    fun shutdown() = pool.shutdownNow()

    private fun event(type: String, data: JSONObject) =
        send("window.__vxNative.event(${JSONObject.quote(type)}, ${JSONObject.quote(data.toString())})")

    private fun send(script: String) = main.post { if (!activity.isDestroyed) activity.web.evaluateJavascript(script, null) }

    private fun ok() = JSONObject().put("ok", true)

    private fun run(method: String, args: JSONObject): JSONObject = when (method) {
        "init" -> init()
        "updateYtdlp" -> {
            engineReady
            val channel = if (args.optString("channel") == "nightly") YoutubeDL.UpdateChannel.NIGHTLY else YoutubeDL.UpdateChannel.STABLE
            val status = YoutubeDL.getInstance().updateYoutubeDL(ctx, channel)
            JSONObject().put("status", status?.name ?: "DONE").put("version", YoutubeDL.getInstance().version(ctx))
        }
        "ytdlp" -> ytdlp(args)
        "download" -> download(args)
        "cancel" -> JSONObject().put("ok", YoutubeDL.getInstance().destroyProcessById(args.getString("jobId")))
        "fetch" -> fetch(args)
        "capture" -> capture(args)
        "cookies" -> {
            val urls = args.optJSONArray("urls") ?: JSONArray()
            JSONObject().put("cookiesFile", Cookies.write(ctx.cacheDir, (0 until urls.length()).map { urls.getString(it) }) ?: JSONObject.NULL)
        }
        "openLoginBrowser" -> {
            activity.startActivity(Intent(activity, LoginActivity::class.java).putExtra("url", args.getString("url")))
            ok()
        }
        "mediaScan" -> {
            MediaScannerConnection.scanFile(ctx, arrayOf(args.getString("path")), null, null)
            ok()
        }
        "openFile" -> {
            val file = File(args.getString("path"))
            val type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(file.extension.lowercase()) ?: "*/*"
            val uri = FileProvider.getUriForFile(ctx, "${ctx.packageName}.files", file)
            activity.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, type).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            ok()
        }
        "openFolder" -> {
            activity.startActivity(Intent(DownloadManager.ACTION_VIEW_DOWNLOADS))
            ok()
        }
        "openUrl" -> {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(args.getString("url"))))
            ok()
        }
        "keepAlive" -> keepAlive(args)
        else -> throw IllegalArgumentException("unknown method: $method")
    }

    private fun downloadDir() = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "VideoExtractor")

    private fun init(): JSONObject {
        engineReady
        val plugins = File(ctx.filesDir, "plugins")
        plugins.deleteRecursively()
        copyAssets("plugins", plugins)
        downloadDir().mkdirs() // 28 이하는 권한을 받은 뒤(첫 다운로드) 다시 만든다.
        return JSONObject()
            .put("appVersion", BuildConfig.VERSION_NAME)
            .put("ytdlpVersion", YoutubeDL.getInstance().version(ctx) ?: JSONObject.NULL)
            .put("pluginDir", plugins.absolutePath)
            .put("downloadDir", downloadDir().absolutePath)
            .put("cacheDir", ctx.cacheDir.absolutePath)
            .put("abi", Build.SUPPORTED_ABIS.firstOrNull() ?: "")
    }

    /** assets 폴더를 그대로 복사한다. 목록이 비면 파일로 본다. */
    private fun copyAssets(path: String, target: File) {
        val children = ctx.assets.list(path) ?: emptyArray()
        if (children.isEmpty()) {
            target.parentFile?.mkdirs()
            ctx.assets.open(path).use { input -> target.outputStream().use { input.copyTo(it) } }
            return
        }
        target.mkdirs()
        for (child in children) copyAssets("$path/$child", File(target, child))
    }

    private fun request(args: JSONObject): YoutubeDLRequest {
        val url = args.optString("url")
        val list = args.optJSONArray("args") ?: JSONArray()
        // url이 비면(--version 같은 호출) 빈 인자를 붙이지 않는다.
        return (if (url.isBlank()) YoutubeDLRequest(emptyList<String>()) else YoutubeDLRequest(url))
            .addCommands((0 until list.length()).map { list.getString(it) })
    }

    private fun ytdlp(args: JSONObject): JSONObject {
        engineReady
        return try {
            val response = YoutubeDL.getInstance().execute(request(args))
            JSONObject().put("exitCode", response.exitCode).put("out", response.out).put("err", response.err)
        } catch (error: YoutubeDLException) {
            JSONObject().put("exitCode", 1).put("out", "").put("err", error.message ?: error.toString())
        }
    }

    private fun download(args: JSONObject): JSONObject {
        engineReady
        ensureStorage()
        val jobId = args.getString("jobId")
        return try {
            val response = YoutubeDL.getInstance().execute(request(args), jobId) { _, _, line ->
                event("ytdlpLine", JSONObject().put("jobId", jobId).put("line", line))
            }
            JSONObject().put("exitCode", response.exitCode).put("err", response.err)
        } catch (_: YoutubeDL.CanceledException) {
            JSONObject().put("exitCode", -2).put("err", "cancelled")
        } catch (error: YoutubeDLException) {
            JSONObject().put("exitCode", 1).put("err", error.message ?: error.toString())
        }
    }

    /** API 28 이하는 공용 Download에 쓰려면 권한이 필요하다. 응답이 올 때까지(최대 2분) 이 스레드에서 기다린다. */
    private fun ensureStorage() {
        if (Build.VERSION.SDK_INT <= 28 && activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            val wait = CountDownLatch(1)
            activity.permissionWait = wait
            main.post { activity.requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), MainActivity.ASK_STORAGE) }
            wait.await(2, TimeUnit.MINUTES)
            if (activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                throw SecurityException("저장소 권한이 없어 다운로드 폴더에 저장할 수 없습니다")
            }
        }
        downloadDir().mkdirs()
    }

    private fun keepAlive(args: JSONObject): JSONObject {
        val intent = Intent(ctx, KeepAliveService::class.java)
        if (args.optBoolean("active")) {
            if (Build.VERSION.SDK_INT >= 33 && activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                // 거절해도 서비스는 돈다(알림만 안 보임).
                main.post { activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), MainActivity.ASK_NOTIFICATIONS) }
            }
            ctx.startForegroundService(intent.putExtra("text", args.optString("text")))
        } else {
            ctx.stopService(intent)
        }
        return ok()
    }

    private fun fetch(args: JSONObject): JSONObject {
        val headers = args.optJSONObject("headers") ?: JSONObject()
        val maxBytes = args.optInt("maxBytes", 2_000_000)
        val useCookies = args.optBoolean("useCookies")
        var url = URL(args.getString("url"))
        // HttpURLConnection은 http↔https 리다이렉트를 따라가지 않으므로 직접 따라간다.
        repeat(10) {
            val conn = url.openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            for (key in headers.keys()) {
                // 압축 해제는 HttpURLConnection에 맡긴다.
                if (!key.equals("accept-encoding", true)) conn.setRequestProperty(key, headers.getString(key))
            }
            if (useCookies) CookieManager.getInstance().getCookie(url.toString())?.let { conn.setRequestProperty("Cookie", it) }
            try {
                val status = conn.responseCode
                val location = conn.getHeaderField("Location")
                if (status in 300..399 && location != null) {
                    url = URL(url, location)
                    return@repeat
                }
                val body = ByteArrayOutputStream()
                (if (status >= 400) conn.errorStream else conn.inputStream)?.use { input ->
                    val buffer = ByteArray(16384)
                    while (body.size() < maxBytes) {
                        val n = input.read(buffer, 0, minOf(buffer.size, maxBytes - body.size()))
                        if (n < 0) break
                        body.write(buffer, 0, n)
                    }
                }
                return JSONObject()
                    .put("status", status)
                    .put("finalUrl", url.toString())
                    .put("contentType", conn.contentType ?: "")
                    .put("body", body.toString(Charsets.UTF_8.name()))
            } finally {
                conn.disconnect()
            }
        }
        throw IllegalStateException("too many redirects")
    }

    private fun capture(args: JSONObject): JSONObject {
        val wait = CountDownLatch(1)
        var result: JSONObject? = null
        main.post {
            try {
                Capture(activity, args) { result = it; wait.countDown() }.start()
            } catch (error: Throwable) {
                result = JSONObject().put("error", error.message ?: error.toString())
                wait.countDown()
            }
        }
        // 정리 여유를 두고 기다린다.
        wait.await(args.optLong("timeoutMs", 30_000) + 15_000, TimeUnit.MILLISECONDS)
        val done = result ?: throw IllegalStateException("capture timed out")
        if (done.has("error")) throw IllegalStateException(done.getString("error"))
        return done
    }
}
