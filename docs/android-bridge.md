# Android 네이티브 브리지 계약

안드로이드 앱은 `public/`(웹 화면)을 WebView로 띄우고, 화면 쪽 `public/android.js`가 PC 서버(server.mjs)와 같은 API를 흉내 낸다.
네이티브(Kotlin)는 아래 "도구"만 제공한다. 분석 단계 순서·형식 정리·사이트 학습 같은 로직은 전부 JS(`public/core/`, `public/android.js`)에 있다.

## 로딩
- `public/` → `app/src/main/assets/www/`, `plugins/` → `app/src/main/assets/plugins/` 를 빌드 직전에 복사(Gradle 작업).
- WebView는 `WebViewAssetLoader`로 `https://appassets.androidplatform.net/assets/www/index.html` 을 연다(ES module 동작, https 출처).
- WebView 설정: JavaScript, DOM storage, `mediaPlaybackRequiresUserGesture=false`.

## 호출 방식
JS → 네이티브: `VXNative.call(callId: String, method: String, argsJson: String)` (반환값 없음, `addJavascriptInterface(obj, "VXNative")`)

네이티브 → JS (반드시 메인 스레드에서 `evaluateJavascript`, 문자열은 `JSONObject.quote`로 감쌈):
- 성공: `window.__vxNative.resolve(callId, resultJsonString)`
- 실패: `window.__vxNative.reject(callId, message)`
- 이벤트: `window.__vxNative.event(type, jsonString)`

긴 작업은 백그라운드 스레드(Executor)에서 실행한다.

## 메서드

| method | args | result |
|---|---|---|
| `init` | `{}` | `{ appVersion, ytdlpVersion, pluginDir, downloadDir, cacheDir, abi }` — YoutubeDL·FFmpeg init, `assets/plugins`를 `filesDir/plugins`로 복사(매번 덮어씀), 다운로드 폴더 생성 |
| `updateYtdlp` | `{ channel: 'stable'\|'nightly' }` | `{ status: 'DONE'\|'ALREADY_UP_TO_DATE', version }` |
| `ytdlp` | `{ url, args: string[] }` | `{ exitCode, out, err }` — `YoutubeDLRequest(url).addCommands(args)`; `YoutubeDLException`도 reject하지 말고 `{exitCode:1, out:'', err: message}`로 resolve |
| `download` | `{ jobId, url, args: string[] }` | 끝나면 `{ exitCode, err }`. processId=jobId. 실행 중 stdout 줄마다 이벤트 `ytdlpLine {jobId, line}`. 취소되면 `{ exitCode: -2, err: 'cancelled' }` |
| `cancel` | `{ jobId }` | `{ ok }` — `destroyProcessById(jobId)` |
| `fetch` | `{ url, headers: {}, maxBytes, useCookies }` | `{ status, finalUrl, contentType, body }` — 리다이렉트 따라감(프로토콜 변경 포함), 본문은 UTF-8 문자열로 maxBytes까지. 4xx/5xx도 resolve. `useCookies`면 CookieManager 쿠키를 붙임 |
| `capture` | `{ url, timeoutMs, visible, playScript }` | `{ candidates: [{url, referer}], title, userAgent, finalUrl, segmentsSeen, cookiesFile }` (아래) |
| `cookies` | `{ urls: string[] }` | `{ cookiesFile: string\|null }` — CookieManager 쿠키를 Netscape 형식 파일(cacheDir)로 |
| `openLoginBrowser` | `{ url }` | `{ ok }` — 화면이 보이는 WebView 액티비티(닫기 버튼). CookieManager를 공유하므로 로그인 쿠키가 capture/cookies에 쓰인다 |
| `mediaScan` | `{ path }` | `{ ok }` — MediaScannerConnection.scanFile |
| `openFile` | `{ path }` | `{ ok }` — FileProvider + ACTION_VIEW |
| `openFolder` | `{}` | `{ ok }` — 다운로드 목록(DownloadManager.ACTION_VIEW_DOWNLOADS) 열기 |
| `openUrl` | `{ url }` | `{ ok }` — 외부 브라우저 |
| `keepAlive` | `{ active: boolean, text }` | `{ ok }` — 다운로드 중 포그라운드 서비스(알림) 시작/중지 |

### capture (3단계)
- 별도 WebView(사용자에게 보이지 않게, 단 화면에 붙어 있어야 재생됨. `visible`이면 전체 화면 대화상자로)에서 url을 연다.
- `shouldInterceptRequest`에서 모든 요청(iframe 포함) URL을 보고, 미디어로 보이는 것(`.m3u8 .mpd .mp4 .webm .m4v .mov .f4m`, 쿼리 포함)을 `{url, referer: 요청의 Referer 헤더 또는 현재 페이지}`로 모은다. `.ts .m4s .aac` 조각, `/seg-1` 같은 것은 개수만 `segmentsSeen`.
- 페이지 로드 1.5초 뒤, 6초 뒤(아직 없으면) `playScript`를 `evaluateJavascript`로 실행(재생 버튼 누르기). 결과 JSON의 `click{x,y}`가 있으면 그 좌표에 터치 이벤트.
- manifest(m3u8/mpd)를 처음 본 뒤 2.5초, 일반 파일만이면 5초, 아니면 `timeoutMs`에서 끝.
- 끝나면 `CookieManager`의 쿠키(페이지와 후보 호스트)를 Netscape 파일로 써서 `cookiesFile`. `userAgent`는 WebView UA.
- WebView는 정리(destroy).

## 저장 위치
- 다운로드: `공용 Download/VideoExtractor/` (API 29는 requestLegacyExternalStorage, 28 이하는 WRITE_EXTERNAL_STORAGE 요청).
- 완료된 파일은 JS가 `mediaScan`을 호출.

## 기타
- yt-dlp는 앱 시작 시 하루 1회 JS가 `updateYtdlp` 호출(배포 라이브러리의 yt-dlp가 오래되면 YouTube가 실패하므로).
- 패키지: `com.sunya0804.videoextractor`, minSdk 26, compile/target 36, abiFilters `arm64-v8a`.

## 앱 자동 업데이트

- `appUpdate { action: 'check' | 'install' }` → `{ status, latest, current, progress }`. check는 백그라운드 확인을 시작하고 현재 상태를 즉시 반환합니다. install은 준비된 APK를 설치하며 파일이 없으면 확인부터 시작합니다.
- 네이티브 이벤트 `appUpdate { status, progress, latest, current }`: 확인 중, 새 버전 받는 중(0~100%), 설치 준비됨, 최신 버전, 설치 확인 대기 또는 오류를 전달합니다. 도구 패널의 app 항목 note에 표시합니다.
- 시작 시 및 마지막 확인에서 6시간이 지난 onResume에 GitHub releases/latest를 확인합니다. 더 높은 정식 버전의 APK를 cacheDir/updates에 임시 다운로드하고 크기를 검증한 뒤 설치 준비 상태로 전환합니다.
- REQUEST_INSTALL_PACKAGES 권한으로 이 출처의 앱 설치 허용 설정을 안내하고 돌아오면 설치를 재개합니다. PackageInstaller 세션으로 APK를 전달하며 MainActivity의 설치 결과 Intent로 시스템 확인 화면·취소·실패를 처리합니다. 서명·패키지 검증은 Android 설치 관리자가 수행합니다.
