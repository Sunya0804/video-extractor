package com.sunya0804.videoextractor

import android.annotation.SuppressLint
import android.app.Dialog
import android.graphics.Bitmap
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener

/**
 * capture 3단계: 별도 WebView로 페이지를 열어 미디어 요청 URL을 모은다(docs/android-bridge.md).
 * 보이지 않을 때는 메인 WebView 뒤에 전체 크기로 붙여 둔다(화면에 붙어 있어야 재생된다). 메인 스레드에서만 다룬다.
 */
@SuppressLint("SetJavaScriptEnabled")
class Capture(private val activity: MainActivity, args: JSONObject, private val done: (JSONObject) -> Unit) {
    private val url = args.getString("url")
    private val timeoutMs = args.optLong("timeoutMs", 30_000)
    private val playScript = args.optString("playScript")
    private val visible = args.optBoolean("visible")
    private val handler = Handler(Looper.getMainLooper())
    private val web = WebView(activity)
    private var dialog: Dialog? = null
    private var finished = false
    private var loaded = false

    // shouldInterceptRequest는 다른 스레드에서 불린다.
    private val lock = Any()
    private val candidates = LinkedHashMap<String, String>()
    private var segments = 0
    private var sawManifest = false
    private var sawFile = false
    @Volatile private var pageUrl = url

    fun start() {
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                saw(request.url.toString(), request.requestHeaders.entries.firstOrNull { it.key.equals("referer", true) }?.value)
                return null
            }

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                pageUrl = url
            }

            override fun onPageFinished(view: WebView, url: String) {
                pageUrl = url
                if (loaded) return
                loaded = true
                handler.postDelayed({ play() }, 1_500)
                handler.postDelayed({ if (synchronized(lock) { candidates.isEmpty() }) play() }, 6_000)
            }
        }
        if (visible) {
            dialog = Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen).apply {
                setContentView(web)
                setOnCancelListener { finish() } // 뒤로 가기로 일찍 끝낼 수 있다.
                show()
            }
        } else {
            activity.root.addView(web, 0, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        }
        handler.postDelayed({ finish() }, timeoutMs)
        web.loadUrl(url)
    }

    private fun saw(requestUrl: String, referer: String?) {
        val lower = requestUrl.lowercase()
        synchronized(lock) {
            if (SEGMENT.containsMatchIn(lower)) {
                segments++
                return
            }
            if (!MEDIA.containsMatchIn(lower) || candidates.containsKey(requestUrl)) return
            candidates[requestUrl] = referer ?: pageUrl
            if (MANIFEST.containsMatchIn(lower)) {
                if (!sawManifest) handler.postDelayed({ finish() }, 2_500)
                sawManifest = true
            } else {
                if (!sawFile && !sawManifest) handler.postDelayed({ finish() }, 5_000)
                sawFile = true
            }
        }
    }

    /** 재생 버튼 누르기. 스크립트 결과에 click{x,y}(CSS px)가 있으면 그 자리를 터치한다. */
    private fun play() {
        if (finished || playScript.isBlank()) return
        web.evaluateJavascript(playScript) { raw ->
            if (finished) return@evaluateJavascript
            val click = try {
                val value = JSONTokener(raw ?: "null").nextValue()
                val obj = if (value is String) JSONObject(value) else value as? JSONObject
                obj?.optJSONObject("click")
            } catch (_: Exception) {
                null
            }
            if (click != null) tap(click.optDouble("x").toFloat(), click.optDouble("y").toFloat())
        }
    }

    private fun tap(cssX: Float, cssY: Float) {
        if (cssX.isNaN() || cssY.isNaN()) return
        val scale = activity.resources.displayMetrics.density
        val x = cssX * scale
        val y = cssY * scale
        val down = SystemClock.uptimeMillis()
        MotionEvent.obtain(down, down, MotionEvent.ACTION_DOWN, x, y, 0).also { web.dispatchTouchEvent(it); it.recycle() }
        handler.postDelayed({
            if (finished) return@postDelayed
            MotionEvent.obtain(down, SystemClock.uptimeMillis(), MotionEvent.ACTION_UP, x, y, 0).also { web.dispatchTouchEvent(it); it.recycle() }
        }, 60)
    }

    private fun finish() {
        if (finished) return
        finished = true
        handler.removeCallbacksAndMessages(null)
        val list = JSONArray()
        val hosts = LinkedHashSet<String>()
        hosts += web.url ?: pageUrl
        hosts += url
        val segmentsSeen: Int
        synchronized(lock) {
            for ((candidate, referer) in candidates) {
                list.put(JSONObject().put("url", candidate).put("referer", referer))
                hosts += candidate
            }
            segmentsSeen = segments
        }
        val result = JSONObject()
            .put("candidates", list)
            .put("title", web.title ?: "")
            .put("userAgent", web.settings.userAgentString)
            .put("finalUrl", web.url ?: pageUrl)
            .put("segmentsSeen", segmentsSeen)
            .put("cookiesFile", Cookies.write(activity.cacheDir, hosts.toList()) ?: JSONObject.NULL)
        dialog?.dismiss()
        (web.parent as? ViewGroup)?.removeView(web)
        web.stopLoading()
        web.destroy()
        done(result)
    }

    companion object {
        private val MEDIA = Regex("\\.(m3u8|mpd|mp4|webm|m4v|mov|f4m)([?#&/;]|$)")
        private val MANIFEST = Regex("\\.(m3u8|mpd)([?#&/;]|$)")
        private val SEGMENT = Regex("\\.(ts|m4s|aac)([?#&;]|$)|/seg-\\d+")
    }
}
