package com.sunya0804.videoextractor

import android.net.Uri
import android.webkit.CookieManager
import java.io.File

/** CookieManager 쿠키를 yt-dlp가 읽는 Netscape 쿠키 파일로 쓴다. */
object Cookies {
    /** www.youtube.com → youtube.com, news.example.co.kr → example.co.kr (대략적인 등록 도메인) */
    private fun siteOf(host: String): String {
        val parts = host.trimStart('.').split('.')
        val n = if (parts.size > 2 && parts[parts.size - 2] in setOf("co", "com", "net", "or", "ne", "go", "ac", "org")) 3 else 2
        return parts.takeLast(n).joinToString(".")
    }

    /** 쿠키가 하나도 없으면 null. */
    fun write(dir: File, urls: List<String>): String? {
        val manager = CookieManager.getInstance()
        val lines = LinkedHashSet<String>()
        for (url in urls) {
            val uri = Uri.parse(url)
            val host = uri.host ?: continue
            val secure = if (uri.scheme == "https") "TRUE" else "FALSE"
            // CookieManager는 이름=값만 준다. YouTube 로그인 쿠키(SAPISID, LOGIN_INFO 등)는 .youtube.com 에 걸려 있고
            // yt-dlp는 youtube.com의 여러 하위 도메인으로 요청하므로, 상위 도메인(.youtube.com)·하위 도메인 포함(TRUE)으로 쓴다.
            val domain = "." + siteOf(host)
            val header = manager.getCookie(url) ?: continue
            for (pair in header.split(";")) {
                val eq = pair.indexOf('=')
                if (eq <= 0) continue
                lines += listOf(domain, "TRUE", "/", secure, "0", pair.substring(0, eq).trim(), pair.substring(eq + 1).trim()).joinToString("\t")
            }
        }
        if (lines.isEmpty()) return null
        val file = File(dir, "cookies-${System.currentTimeMillis()}-${(Math.random() * 1e6).toInt()}.txt")
        file.writeText("# Netscape HTTP Cookie File\n" + lines.joinToString("\n") + "\n")
        return file.absolutePath
    }
}
