import com.sunya0804.videoextractor.SharedLink

/** Android·JUnit 없이 컴파일해 실행하는 순수 JVM assert 검사. */
fun main() {
    val cases = listOf(
        null to null,
        "영상 제목만 공유" to null,
        "ftp://example.com/a javascript:alert(1)" to null,
        "제목\nhttps://youtu.be/abc?t=42 공유합니다" to "https://youtu.be/abc?t=42",
        "<https://www.youtube.com/watch?v=abc&list=def>" to "https://www.youtube.com/watch?v=abc&list=def",
        "(https://example.com/watch?id=1)." to "https://example.com/watch?id=1",
        "https://example.com/wiki/Film_(2024)" to "https://example.com/wiki/Film_(2024)",
        "HTTPS://example.com/first https://example.com/second" to "HTTPS://example.com/first",
        "https:// https://youtu.be/valid" to "https://youtu.be/valid",
        "https://user:pass@example.com/ https://youtu.be/valid" to "https://youtu.be/valid",
        "https://example.com/v。\u200B설명" to "https://example.com/v"
    )
    for ((text, expected) in cases) check(SharedLink.firstUrl(text) == expected) { "Unexpected URL for $text" }
    println("SharedLink: ${cases.size} JVM assertions passed")
}
