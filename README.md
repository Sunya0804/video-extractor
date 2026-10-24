# Video Extractor

개인용 영상 추출기입니다. URL을 넣으면 아래 3단계를 자동으로 차례대로 시도하고, 처음 성공한 단계의 결과로 내려받습니다.

| 단계 | 방법 | 이런 사이트에서 성공 |
|---|---|---|
| 1. yt-dlp | 사이트 전용 추출기(1,800여 곳) 또는 yt-dlp 범용 추출기 + 우리 플러그인 `vx:hidden`(난독화·base64로 숨긴 주소) | YouTube, Vimeo, X, 인스타그램 등 알려진 사이트, 흔한 임베드 플레이어 |
| 2. 페이지 스캔 | 페이지 HTML·**iframe 안쪽 페이지**·**같은 사이트 플레이어 스크립트**에서 `<video>`, 플레이어 설정, 상대 경로, 난독화(P.A.C.K.E.R.)·base64·퍼센트 인코딩된 `.m3u8/.mpd/.mp4` 주소를 찾아 yt-dlp로 재분석 | yt-dlp가 "Unsupported URL"로 거절하지만 주소가 소스 어딘가에 있는 사이트 |
| 3. 헤드리스 브라우저 | Edge/Chrome을 화면 없이 띄워(DevTools 프로토콜) 재생 버튼을 누르고, 네트워크 요청에서 미디어 주소를 잡아 쿠키·Referer와 함께 yt-dlp로 재분석 | 자바스크립트가 주소를 나중에 만드는 사이트, iframe 속 플레이어 |

DRM(Widevine·PlayReady·FairPlay)이 걸린 콘텐츠는 찾더라도 "DRM" 표시만 하고 내려받지 않습니다.

**사이트 학습**: 2·3단계로 성공한 사이트는 `data/sites.json`에 기억해 두고 다음에는 그 단계부터 시도합니다(화면의 "학습된 사이트"에서 확인·삭제).

**지원 사이트 넓히기**: yt-dlp가 왜 "Unsupported URL"을 내는지와 우리가 메운 부분은 [research/yt-dlp-internals.md](research/yt-dlp-internals.md)에 정리했습니다. 특정 사이트를 제대로 지원하려면 `plugins/vx/yt_dlp_plugins/extractor/`에 yt-dlp 추출기 플러그인(파이썬 파일)을 추가하면 다음 분석부터 적용됩니다.

## 세 가지 사용 방법

| 방법 | 주소/파일 | 엔진 |
|---|---|---|
| **PC 프로그램** | 아래 "설치·실행" | PC의 yt-dlp·ffmpeg·deno·Edge |
| **안드로이드 앱** | [Releases](https://github.com/Sunya0804/video-extractor/releases/latest)의 `VideoExtractor-x.y.z.apk` | 앱 안에 내장된 yt-dlp·ffmpeg·QuickJS, 3단계는 앱 내장 브라우저(WebView). PC 없이 폰에서 바로 받음 |
| **웹(깃허브 io)** | https://sunya0804.github.io/video-extractor/ | 같은 PC에서 켜 둔 PC 프로그램(127.0.0.1:5280)에 연결해 동작. 처음 열 때 브라우저가 "로컬 네트워크 접근"을 물으면 허용 |

화면은 세 곳 모두 같은 `public/`이고, 분석 로직(`public/core/`)도 PC와 앱이 같은 코드를 씁니다.

### 안드로이드 앱
- APK를 받아 설치합니다(Android 8.0 이상, arm64). "출처를 알 수 없는 앱" 설치를 허용해야 할 수 있습니다.
- 받은 파일은 `Download/VideoExtractor`에 저장되고 갤러리에도 나타납니다. 받는 동안은 알림이 떠 있어 화면을 꺼도 계속 받습니다.
- 앱을 켜면 하루 한 번 yt-dlp를 자동 업데이트하고, 새 앱 버전이 있으면 도구 패널에 표시합니다.
- 로그인이 필요한 사이트는 [로그인용 브라우저 열기]로 로그인하면 그 쿠키를 분석·다운로드에 씁니다.
- 직접 빌드: Android SDK와 JDK가 있으면 `npm run dist:android` → `dist/VideoExtractor-<버전>.apk`. 네이티브 브리지 구조는 [docs/android-bridge.md](docs/android-bridge.md).

### 웹(깃허브 io)
- `public/`이 push될 때 GitHub Actions(`.github/workflows/pages.yml`)가 배포합니다.
- PC 서버는 `https://sunya0804.github.io` 출처만 CORS로 허용합니다(다른 출처를 추가하려면 `VX_ALLOWED_ORIGINS` 환경 변수). 다른 서버 주소를 쓰려면 `?server=http://127.0.0.1:포트`.

## 설치·실행

Node.js 22 이상이 필요합니다. 설치할 npm 패키지는 없습니다.

1. `install\install.cmd`를 실행하면 아이콘을 만들고 **바탕화면**과 **시작 메뉴**에 `Video Extractor` 바로가기를 만듭니다.
2. 바로가기를 누르면 서버를 창 없이 백그라운드로 켜고(이미 켜져 있으면 그대로 사용) 기본 브라우저로 화면을 엽니다. 서버 로그는 `data\server.log`, `data\server.err.log`에 남습니다.
3. 끌 때는 화면 오른쪽 위의 **프로그램 종료**를 누릅니다.

프로그램 파일은 이 폴더에 그대로 있으므로 코드를 고치면 다음 실행부터 바로 반영됩니다(재설치 불필요). 지우려면 바로가기 두 개와 이 폴더를 삭제하면 됩니다.

개발할 때는 `node server.mjs`로 직접 실행해도 됩니다.

브라우저에서 `http://127.0.0.1:5280/`을 엽니다. 포트를 바꾸려면 `PORT` 환경 변수를 씁니다.
처음 실행하면 화면의 도구 패널에서 **설치/업데이트**를 눌러 yt-dlp, ffmpeg, deno를 `bin/`에 받습니다(약 250MB). 이후 같은 버튼을 누르면 yt-dlp가 최신 버전인지 확인하고, 아니면 업데이트합니다. YouTube가 자주 바뀌므로 다운로드가 안 되면 먼저 업데이트하세요.

## 설정

- **다운로드 폴더**: 기본값 `내 PC\다운로드\VideoExtractor`
- **쿠키 브라우저**: 1단계에서 로그인이 필요한 사이트용. Windows의 Chrome·Edge는 쿠키 암호화 때문에 실패할 수 있으니 Firefox를 권장합니다.
- **로그인 프로필 사용**: [로그인용 브라우저 열기]로 뜬 창에서 로그인한 뒤 창을 닫으면, 3단계가 그 프로필(`data/browser-profile`)의 쿠키를 씁니다.
- **브라우저 창 보이기**: 3단계 브라우저를 화면에 띄워 무슨 일이 일어나는지 봅니다(디버깅용).

## 구성

| 파일 | 내용 |
|---|---|
| `server.mjs` | 정적 파일, API, SSE, 3단계 진행 관리, 다운로드 큐(동시 2개) |
| `lib/tools.mjs` | yt-dlp·ffmpeg·deno 찾기·설치·업데이트(GitHub 릴리스), Edge/Chrome 찾기 |
| `lib/ytdlp.mjs` | yt-dlp 분석(`-J`) 결과 정리, 다운로드 실행·진행률 해석 |
| `lib/scan.mjs` | 2단계 HTML 스캔 |
| `lib/browser.mjs` | 3단계 CDP 제어(iframe·worker 자동 연결, 재생 시도, 쿠키 내보내기), 로그인용 브라우저 |
| `lib/drm.mjs` | manifest DRM 판정 |
| `public/` | 웹 화면(`?mock=1`로 가짜 데이터 미리보기) |
| `docs/API.md` | API·SSE 계약 |
| `bin/`, `data/` | 받은 도구, 설정·브라우저 프로필·임시 쿠키(git 제외) |

서버는 `127.0.0.1`에서만 듣고, Host·Origin 검사로 다른 웹사이트가 API를 호출하지 못하게 막습니다.

## 주의

개인 용도로, 내려받을 권리가 있는 콘텐츠에만 쓰세요. 사이트 이용약관과 저작권법을 지키는 것은 사용자의 책임입니다.
