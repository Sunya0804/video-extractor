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
import android.window.OnBackInvokedDispatcher
import android.widget.FrameLayout
import androidx.webkit.WebViewAssetLoader
import java.util.concurrent.CountDownLatch

/** 앱 화면. assets/www(= public 폴더)를 https 출처로 띄우고 VXNative 브리지를 붙인다. */
class MainActivity : Activity() {
    lateinit var root: FrameLayout
    lateinit var web: WebView
    private lateinit var bridge: Bridge
    lateinit var updater: Updater
    // download가 저장소 권한 응답을 기다리는 동안 쓰는 대기열(백그라운드 스레드가 기다린다).
    @Volatile var permissionWait: CountDownLatch? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
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
        bridge = Bridge(this)
        updater = Updater(this) { bridge.appUpdate(it) }
        web.addJavascriptInterface(bridge, "VXNative")

        // targetSdk 36은 화면이 상태 표시줄 밑까지 그려지므로 그만큼 띄운다(바탕은 페이지와 같은 검정).
        root = FrameLayout(this)
        root.setBackgroundColor(getColor(R.color.background))
        root.addView(web)
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
        web.loadUrl("https://$HOST/assets/www/index.html")
        if (intent?.action == Updater.ACTION_INSTALL_STATUS) updater.onInstallStatus(intent)
    }

    override fun onResume() {
        super.onResume()
        if (::updater.isInitialized) updater.checkIfDue()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.action == Updater.ACTION_INSTALL_STATUS) updater.onInstallStatus(intent)
    }

    private fun goBack() {
        if (web.canGoBack()) web.goBack() else finish()
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
    }
}
