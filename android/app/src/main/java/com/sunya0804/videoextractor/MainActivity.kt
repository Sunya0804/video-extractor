package com.sunya0804.videoextractor

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Insets
import android.os.Build
import android.os.Bundle
import android.view.WindowInsets
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.RenderProcessGoneDetail
import android.window.OnBackInvokedDispatcher
import android.widget.FrameLayout
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.util.concurrent.CountDownLatch

/** 앱 화면. assets/www(= public 폴더)를 https 출처로 띄우고 VXNative 브리지를 붙인다. */
class MainActivity : Activity() {
    lateinit var root: FrameLayout
    lateinit var web: WebView
    private lateinit var bridge: Bridge
    lateinit var updater: Updater
    private val pendingLaunches = java.util.ArrayDeque<String>()
    private var uiReady = false
    private var notificationPermissionAsked = false
    // download가 저장소 권한 응답을 기다리는 동안 쓰는 대기열(백그라운드 스레드가 기다린다).
    @Volatile var permissionWait: CountDownLatch? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        savedInstanceState?.getStringArrayList("launches")?.let { pendingLaunches.addAll(it) }
        bridge = Bridge(this)
        updater = Updater(this) { bridge.appUpdate(it) }
        root = FrameLayout(this)
        root.setBackgroundColor(getColor(R.color.background))
        createWebView()

        // targetSdk 36: 상태 표시줄과 키보드를 피한다.
        if (Build.VERSION.SDK_INT >= 30) {
            root.setOnApplyWindowInsetsListener { view, insets ->
                val bars: Insets = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout() or WindowInsets.Type.ime())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
                WindowInsets.CONSUMED
            }
        }
        setContentView(root)
        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { goBack() }
        }
        if (intent?.action == Updater.ACTION_INSTALL_STATUS) updater.onInstallStatus(intent)
        if (savedInstanceState == null) handleLaunch(intent)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView() {
        uiReady = false
        val assets = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()
        web = WebView(this).apply {
            setBackgroundColor(getColor(R.color.background))
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            settings.allowFileAccess = false
            settings.allowContentAccess = false
            webViewClient = object : WebViewClient() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    assets.shouldInterceptRequest(request.url)

                override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                    uiReady = false
                }

                override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                    uiReady = false
                    root.removeView(view)
                    view.destroy()
                    // Bridge의 다운로드 실행기는 유지한다. 새 JS는 init의 activeDownloads에 다시 연결한다.
                    root.post { if (!isDestroyed) createWebView() }
                    return true
                }

                // 앱 화면이 아닌 링크는 휴대폰 브라우저로 연다.
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    if (request.url.host == HOST) return false
                    try {
                        startActivity(Intent(Intent.ACTION_VIEW, request.url))
                    } catch (_: ActivityNotFoundException) {
                    }
                    return true
                }
            }
        }
        web.addJavascriptInterface(bridge, "VXNative")
        root.addView(web)
        web.loadUrl("https://$HOST/assets/www/index.html")
    }

    override fun onResume() {
        super.onResume()
        if (::updater.isInitialized) updater.checkIfDue()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == Updater.ACTION_INSTALL_STATUS) updater.onInstallStatus(intent)
        handleLaunch(intent)
    }

    private fun handleLaunch(source: Intent?) {
        val event = when (source?.action) {
            Intent.ACTION_SEND -> {
                if (source.type != "text/plain") return
                val url = SharedLink.firstUrl(source.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString())
                if (url == null) {
                    Toast.makeText(this, "공유한 내용에 http(s) 링크가 없습니다", Toast.LENGTH_SHORT).show()
                    return
                }
                JSONObject().put("url", url)
            }
            ACTION_SHOW_JOB -> {
                val id = source.getStringExtra(EXTRA_JOB_ID)?.takeIf { it.matches(Regex("[\\w-]{1,100}")) } ?: return
                JSONObject().put("jobId", id)
            }
            else -> return
        }
        pendingLaunches.add(event.toString())
        // 액티비티 재생성 시 같은 공유를 다시 분석하지 않는다.
        setIntent(Intent(this, MainActivity::class.java).setAction(Intent.ACTION_MAIN))
        flushLaunches()
    }

    /** JS init·상태 복원까지 끝난 뒤에만 인텐트를 전달한다(onPageFinished보다 늦다). */
    fun onUiReady() {
        uiReady = true
        flushLaunches()
    }

    private fun flushLaunches() {
        if (!uiReady) return
        while (pendingLaunches.isNotEmpty()) bridge.launch(pendingLaunches.removeFirst())
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putStringArrayList("launches", ArrayList(pendingLaunches))
        super.onSaveInstanceState(outState)
    }

    fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 && !notificationPermissionAsked && checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            notificationPermissionAsked = true
            requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), ASK_NOTIFICATIONS)
        }
    }

    private fun goBack() {
        if (web.canGoBack()) web.goBack() else moveTaskToBack(true)
    }

    @Deprecated("API 32 이하에서만 불린다")
    override fun onBackPressed() = goBack()

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == ASK_STORAGE) permissionWait?.countDown()
    }

    override fun onDestroy() {
        updater.stop()
        bridge.shutdown()
        web.destroy()
        super.onDestroy()
    }

    companion object {
        const val HOST = "appassets.androidplatform.net"
        const val ASK_STORAGE = 1
        const val ASK_NOTIFICATIONS = 2
        const val ACTION_SHOW_JOB = "com.sunya0804.videoextractor.SHOW_JOB"
        const val EXTRA_JOB_ID = "jobId"
    }
}
