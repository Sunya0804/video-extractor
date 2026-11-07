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
| `init` | `{}` | `{ appVersion, ytdlpVersion, pluginDir, downloadDir, cacheDir, abi, downloadResults, activeDownloads }` — 앱 버전이 바뀌거나 폴더가 없을 때만 플러그인 복사, 실행 중 네이티브 작업 스냅샷 포함 |
| `updateYtdlp` | `{ channel: 'stable'\|'nightly' }` | `{ status: 'DONE'\|'ALREADY_UP_TO_DATE', version }` |
| `ytdlp` | `{ url, args: string[] }` | `{ exitCode, out, err }` — `YoutubeDLRequest(url).addCommands(args)`; `YoutubeDLException`도 reject하지 말고 `{exitCode:1, out:'', err: message}`로 resolve |
| `download` | `{ jobId, url, args: string[] }` | 끝나면 `{ exitCode, err }`. processId=jobId. 실행 중 stdout 줄마다 이벤트 `ytdlpLine {jobId, line}`. 취소되면 `{ exitCode: -2, err: 'cancelled' }` |
| `cancel` | `{ jobId }` | `{ ok }` — `destroyProcessById(jobId)` |
| `awaitDownload` | `{ jobId }` | 기존 네이티브 다운로드의 완료 응답에 재연결. 화면 재생성 때 중복 실행하지 않음 |
| `cleanupDownload` | `{ jobId }` | 실행 중이 아닌 작업의 캐시 조각 삭제(복원 대기 중 취소) |
| `statFiles` | `{ paths: string[] }` | `{ missing: string[] }` — 실제 파일이 없거나 폴더인 경로 |
| `saveJobs` | `{ jobs, revision }` | `{ok}` — 정제한 큐를 SharedPreferences에 commit. 역순 응답/저장이 이전 큐를 덮지 않도록 revision 검사 |
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
- 다운로드: `공용 Download/VideoExtractor/` (API 29는 requestLegacyExternalStorage, 29 이하에서 WRITE_EXTERNAL_STORAGE 요청). READ_EXTERNAL_STORAGE는 사용하지 않습니다.
- 임시 조각은 `cacheDir/downloads/<jobId>/`에서만 작성하며 완료·실패·취소 뒤 삭제합니다. `-o`는 home 기준 상대 경로, yt-dlp의 `-P home:`/`-P temp:`를 사용합니다. FileProvider는 `Download/VideoExtractor/` 아래만 공유합니다.
- HTTP 페이지의 2·3단계 분석을 위해 앱의 평문 네트워크 통신을 허용합니다.
- 완료된 파일은 JS가 `mediaScan`을 호출.

## 기타
- yt-dlp는 앱 시작 시 하루 1회 JS가 `updateYtdlp` 호출(배포 라이브러리의 yt-dlp가 오래되면 YouTube가 실패하므로).
- 패키지: `com.sunya0804.videoextractor`, minSdk 26, compile/target 36, abiFilters `arm64-v8a`.

## 공유 링크와 다운로드 결과 알림

- `ACTION_SEND` / `text/plain`을 받으면 MainActivity가 제목·설명 속 첫 유효 HTTP(S) URL을 추출합니다. URL이 없으면 짧은 안내만 표시합니다. 처음 실행과 `onNewIntent` 모두 처리하며, 화면 재생성 시 대기 인텐트는 보존하고 이미 소비한 공유는 다시 분석하지 않습니다.
- JS는 `init` 후 저장된 작업과 네이티브 결과를 복원하고 `uiReady {}`를 호출합니다. 그 뒤 네이티브 `launch { url }` 이벤트는 입력칸을 채우고 기존 `/api/analyze` 흐름을 시작합니다. `launch { jobId }`는 해당 다운로드 카드로 스크롤·포커스합니다. 공용 분석 폼과 PC 목록 렌더러는 변경하지 않습니다.
- `download` 인자에 `title`, `format`을 추가하고 응답에 `file`을 추가합니다. 네이티브는 완료·실패 결과를 먼저 저장한 후 기존 `downloads` 채널에 알림을 게시합니다. WebView의 응답 처리를 기다리지 않으며, 취소에는 결과 알림을 띄우지 않습니다. 알림마다 작업 ID를 구분해 진행 알림이나 다른 결과를 덮어쓰지 않습니다.
- `init` 응답의 `downloadResults`는 아직 JS가 저장하지 못한 결과(최대 30개, 취소 결과도 저장하되 알림은 생략)입니다. JS가 로컬 작업 목록에 저장한 뒤 `ackDownloadResults { ids: string[] }`로 해당 결과만 지웁니다. 네이티브 실행 전 오류는 `notifyDownload { id, title, status, error, ... }`로 동일한 저장·알림 흐름을 사용합니다.
- 알림을 누르면 `SHOW_JOB` 인텐트로 앱을 열어 작업을 보여 줍니다. Android 13+ 알림 권한 요청은 기존 다운로드 시작 흐름을 재사용하며, 거절해도 다운로드·결과 저장은 계속됩니다.
- 순수 URL 추출 및 설치 콜백 세션·토큰 검사는 `AndroidPolicyTest`의 JVM 단위 검사입니다. `assembleRelease`가 `testReleaseUnitTest`에 의존하므로 APK 빌드에서도 실행됩니다. 브리지 준비·분석 대기/삭제·중복/취소·재시도·복원 검사는 `node --test tests/android-events.test.mjs`로 확인합니다.

## 화면 재생성과 작업 기록

- 화면에서 더 뒤로 갈 기록이 없으면 `moveTaskToBack(true)`로 앱을 내립니다. 렌더러 종료는 `onRenderProcessGone`에서 죽은 WebView만 제거하고 새 화면을 엽니다. Bridge의 별도 다운로드 실행기와 서비스는 유지됩니다.
- `init.activeDownloads`에 있는 작업은 `awaitDownload`로 연결합니다. JS 호출 ID는 화면마다 고유 접두사를 써 이전 화면의 응답과 섞이지 않습니다. 앱 프로세스 자체가 다시 켜진 경우에는 저장된 queued/downloading/merging을 queued로 초기화해 자동 재실행합니다.
- `vx.jobs`에는 끝나지 않은 작업 전부와 끝난 최근 30개를 저장합니다. 다시 받기 정보 `_url`, `_fmt`, `_title`, `_access`만 내부 필드로 보존하며 `_access.cookiesFile`과 실행 제어 필드는 저장하지 않습니다. 쿠키는 실행할 때 새로 발급합니다. 공개 응답에는 `retryable: true`를 표시하고 내부 필드는 감춥니다.
- Chromium localStorage의 지연 디스크 반영으로 즉시 프로세스 종료 때 큐가 유실되지 않도록 같은 정제 기록을 `saveJobs`로 네이티브에도 확정 저장합니다. `init.savedJobs`/`jobHistoryRevision`이 있으면 그 기록을 우선 복원합니다. 등록·취소·삭제 응답과 네이티브 결과 ACK 전에 확정 저장하며 저장 오류는 로그만 남겨 다운로드를 계속합니다.
- `POST /api/jobs/:id/retry`: failed/cancelled 또는 파일이 사라진 done만 새 ID로 재등록합니다. 기존 작업 삭제 이벤트 `jobRemoved {id}`와 응답 `{id}`를 보냅니다. 정보가 없는 예전 기록·진행 중·완료 파일이 남은 작업은 409입니다.
- `DELETE /api/jobs/completed`: 끝난 항목만 지우며 파일은 삭제하지 않습니다. `snapshot.capabilities.jobHistory = true`. 완료 파일 존재 여부를 시작·상태 조회·열기/다시 받기 시 재검사합니다.
- 분석은 동시에 3개까지만 실행합니다. 추가 요청은 running 상태에 `대기 중` 메시지를 표시합니다. running은 20개 제한으로 제거하지 않으며, 끝난 분석을 오래된 순서로 정리할 때마다 `analysisRemoved {id}`를 보냅니다. `DELETE /api/analyses/:id`는 running이면 409입니다.
- 동일 URL + 형식 + 높이의 끝나지 않은 다운로드는 409입니다. 준비 중 취소를 네이티브 실행 전에 다시 검사하며 대기 중 취소도 즉시 저장합니다. 진행 서비스 알림에는 현재 진행률 평균을 표시합니다.

## 앱 자동 업데이트

- `appUpdate { action: 'check' | 'install' }` → `{ status, latest, current, progress }`. check는 백그라운드 확인을 시작하고 현재 상태를 즉시 반환합니다. install은 준비된 APK를 설치하며 파일이 없으면 확인부터 시작합니다.
- 네이티브 이벤트 `appUpdate { status, progress, latest, current }`: 확인 중, 새 버전 받는 중(0~100%), 설치 준비됨, 최신 버전, 설치 확인 대기 또는 오류를 전달합니다. 도구 패널의 app 항목 note에 표시합니다.
- 시작 시 및 마지막 확인에서 6시간이 지난 onResume에 GitHub releases/latest를 확인합니다. 새 APK는 사용자가 대화상자/도구 패널에서 요청했거나 현재 네트워크가 무제한일 때만 다운로드합니다. 자동 다운로드 중 유료 네트워크로 바뀌면 중단합니다. 이전 버전 APK·부분 파일은 정리하고 현재 APK 크기를 검증합니다.
- REQUEST_INSTALL_PACKAGES 권한으로 이 출처의 앱 설치 허용 설정을 안내하고 돌아오면 설치를 재개합니다. PackageInstaller 세션 ID와 임의 토큰을 앱의 비공개 설정에 저장하고 둘 다 일치하는 콜백만 처리합니다. 콜백 PendingIntent는 명시적 MainActivity + FLAG_MUTABLE로 만듭니다. 업데이트 APK는 FileProvider가 아닌 세션 스트림으로 전달합니다. 서명·패키지 검증은 Android 설치 관리자가 수행합니다.
