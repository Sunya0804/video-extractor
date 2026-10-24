package com.sunya0804.videoextractor

import android.annotation.SuppressLint
import android.app.Activity
import android.graphics.Bitmap
import android.graphics.Insets
import android.os.Build
import android.os.Bundle
import android.text.TextUtils
import android.view.Gravity
import android.view.WindowInsets
import android.webkit.CookieManager
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.window.OnBackInvokedDispatcher

/** 사이트 로그인용 브라우저. CookieManager를 앱 전체가 함께 쓰므로 여기서 받은 쿠키가 capture/cookies에 쓰인다. */
class LoginActivity : Activity() {
    private lateinit var web: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val address = TextView(this).apply {
            setSingleLine()
            ellipsize = TextUtils.TruncateAt.MIDDLE
            setTextColor(0xFFE6E6E6.toInt())
            setPadding(24, 0, 24, 0)
        }
        val close = Button(this).apply {
            text = "닫기"
            setOnClickListener { finish() }
        }
        val bar = LinearLayout(this).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(address, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
            addView(close)
        }
        web = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            // Google은 UA에 "; wv"(WebView 표시)가 있으면 로그인을 막는 경우가 많다. 사용자의 본인 계정 로그인 창이므로
            // 같은 엔진의 일반 Chrome 모바일 UA로 보여 준다(Version/4.0, wv 표시만 제거)
            settings.userAgentString = settings.userAgentString.replace("; wv", "").replace(Regex("Version/\\d+\\.\\d+ "), "")
            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                    address.text = url
                }
            }
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(getColor(R.color.background))
            addView(bar)
            addView(web, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f))
        }
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
        // 주소 없이 열면 YouTube(구글) 로그인 화면으로
        val start = intent.getStringExtra("url")?.takeIf { it.startsWith("http") }
            ?: "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F"
        web.loadUrl(start)
    }

    private fun goBack() {
        if (web.canGoBack()) web.goBack() else finish()
    }

    @Deprecated("API 32 이하에서만 불린다")
    override fun onBackPressed() = goBack()

    override fun onPause() {
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onDestroy() {
        CookieManager.getInstance().flush()
        web.destroy()
        super.onDestroy()
    }
}
