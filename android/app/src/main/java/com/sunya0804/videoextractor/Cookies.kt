package com.sunya0804.videoextractor

import android.net.Uri
import android.webkit.CookieManager
import java.io.File

/** CookieManager 쿠키를 yt-dlp가 읽는 Netscape 쿠키 파일로 쓴다. */
object Cookies {
    /** 쿠키가 하나도 없으면 null. */
    fun write(dir: File, urls: List<String>): String? {
        val manager = CookieManager.getInstance()
        val lines = LinkedHashSet<String>()
        for (url in urls) {
            val uri = Uri.parse(url)
            val host = uri.host ?: continue
            val secure = if (uri.scheme == "https") "TRUE" else "FALSE"
            // shortcut: CookieManager는 이름=값만 주므로 도메인은 요청한 호스트, 경로는 /, 만료 0(세션)으로 쓴다.
            val header = manager.getCookie(url) ?: continue
            for (pair in header.split(";")) {
                val eq = pair.indexOf('=')
                if (eq <= 0) continue
                lines += listOf(host, "FALSE", "/", secure, "0", pair.substring(0, eq).trim(), pair.substring(eq + 1).trim()).joinToString("\t")
            }
        }
        if (lines.isEmpty()) return null
        val file = File(dir, "cookies-${System.currentTimeMillis()}-${(Math.random() * 1e6).toInt()}.txt")
        file.writeText("# Netscape HTTP Cookie File\n" + lines.joinToString("\n") + "\n")
        return file.absolutePath
    }
}
