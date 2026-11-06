package com.sunya0804.videoextractor

import java.net.URI

/** 제목·설명·여러 링크가 섞인 공유 텍스트에서 첫 유효 HTTP(S) 주소만 받는다. */
object SharedLink {
    private val links = Regex("https?://[^\\s<>\"'\\u200B\\u3000]+", RegexOption.IGNORE_CASE)

    fun firstUrl(text: String?): String? {
        for (match in links.findAll(text.orEmpty())) {
            var candidate = match.value.trimEnd('.', ',', ';', '!', '?', '。', '，', '！', '？', '”', '’', '」', '』', '》')
            // URL 안의 괄호는 보존하고, 설명을 감싼 닫는 괄호만 제거한다.
            for ((open, close) in listOf('(' to ')', '[' to ']', '{' to '}')) {
                while (candidate.endsWith(close) && candidate.count { it == close } > candidate.count { it == open }) {
                    candidate = candidate.dropLast(1)
                }
            }
            val uri = runCatching { URI(candidate) }.getOrNull() ?: continue
            if (uri.scheme.lowercase() in listOf("http", "https") && !uri.host.isNullOrBlank() && uri.rawUserInfo == null) return candidate
        }
        return null
    }
}
