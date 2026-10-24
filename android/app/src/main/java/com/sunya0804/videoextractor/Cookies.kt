package com.sunya0804.videoextractor

import android.net.Uri
import android.webkit.CookieManager
import java.io.File

/** CookieManager 쿠키를 yt-dlp가 읽는 Netscape 쿠키 파일로 쓴다. */
object Cookies {
    /** 쿠키를 상위 도메인으로 넓혀 써도 되는 사이트(로그인 쿠키가 상위 도메인에 걸리는 곳). 그 외는 넓히지 않는다 */
    private val WIDEN = listOf("youtube.com", "google.com")

    /** 쿠키가 하나도 없으면 null. */
    fun write(dir: File, urls: List<String>): String? {
        val manager = CookieManager.getInstance()
        val lines = LinkedHashSet<String>()
        for (raw in urls) {
            // youtu.be 짧은 링크의 로그인 쿠키는 youtube.com에 있다
            val url = if (Uri.parse(raw).host == "youtu.be") "https://www.youtube.com/" else raw
            val uri = Uri.parse(url)
            val host = uri.host ?: continue
            val secure = if (uri.scheme == "https") "TRUE" else "FALSE"
            // CookieManager는 이름=값만 준다(어느 도메인의 쿠키인지 모름). 기본은 요청한 호스트에만(하위 도메인 FALSE).
            // YouTube·Google 로그인 쿠키(SAPISID, LOGIN_INFO 등)는 .youtube.com/.google.com 에 걸려 있고 yt-dlp가 여러
            // 하위 도메인으로 요청하므로, 이 두 사이트만 상위 도메인·하위 도메인 포함(TRUE)으로 넓힌다.
            val wide = WIDEN.firstOrNull { host == it || host.endsWith(".$it") }
            val domain = if (wide != null) ".$wide" else host
            val sub = if (wide != null) "TRUE" else "FALSE"
            val header = manager.getCookie(url) ?: continue
            for (pair in header.split(";")) {
                val eq = pair.indexOf('=')
                if (eq <= 0) continue
                lines += listOf(domain, sub, "/", secure, "0", pair.substring(0, eq).trim(), pair.substring(eq + 1).trim()).joinToString("\t")
            }
        }
        if (lines.isEmpty()) return null
        // 분석·다운로드마다 새 파일이 생겨 쌓이므로 오래된 것은 지운다.
        // shortcut: 하루 넘게 지난 분석 결과로 다운로드하면 쿠키 없이 받는다, 문제가 되면 다운로드 때 다시 쓰게 바꾼다
        val old = System.currentTimeMillis() - 24 * 60 * 60 * 1000L
        dir.listFiles { f -> f.name.startsWith("cookies-") && f.lastModified() < old }?.forEach { it.delete() }
        val file = File(dir, "cookies-${System.currentTimeMillis()}-${(Math.random() * 1e6).toInt()}.txt")
        file.writeText("# Netscape HTTP Cookie File\n" + lines.joinToString("\n") + "\n")
        return file.absolutePath
    }
}
