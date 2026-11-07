package com.sunya0804.videoextractor

/** 외부 Activity Intent는 우리가 만든 설치 세션과 임의 토큰이 모두 일치해야 한다. */
object InstallStatusGate {
    fun accepts(expected: Int, received: Int, nonce: String?, receivedNonce: String?) =
        expected >= 0 && expected == received && !nonce.isNullOrBlank() && nonce == receivedNonce
}
