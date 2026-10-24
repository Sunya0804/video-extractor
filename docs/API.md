# Video Extractor — 내부 API 계약

서버: `node server.mjs` → `http://127.0.0.1:5280/` (환경 변수 `PORT`로 변경).
정적 파일은 `public/`에서 제공. 모든 API는 JSON, 실시간 갱신은 SSE(`/api/events`).
외부 패키지 없음(Node 22+ 내장 기능만). 프론트엔드도 빌드 도구 없이 순수 HTML/CSS/JS(ES module).

## 추출 3단계

| 단계 | 이름(`name`) | 하는 일 |
|---|---|---|
| 1 | `ytdlp` | `yt-dlp -J URL` — 전용/범용 extractor로 분석 |
| 2 | `scan` | 페이지 HTML을 직접 받아 `<video>`, `og:video`, JSON-LD, `.m3u8/.mpd/.mp4` 주소를 정규식으로 찾음 → 찾은 주소를 yt-dlp로 재분석 |
| 3 | `browser` | 헤드리스 Edge/Chrome(CDP)로 페이지를 열고 재생을 시도하며 네트워크 요청에서 미디어 주소를 수집 → 쿠키·Referer와 함께 yt-dlp로 재분석 |

앞 단계가 성공하면 뒤 단계는 `skipped`. 모든 후보는 DRM 검사(manifest의 Widevine/PlayReady/FairPlay, `SAMPLE-AES`)를 거치며 DRM이면 `drm: true`로 표시하고 다운로드 불가.

## 데이터 모형

```ts
Tool = { name: 'yt-dlp'|'ffmpeg'|'deno'|'browser', installed: boolean, version: string|null,
         path: string|null, source: 'bin'|'path'|'system'|null, required: boolean, note?: string }

Stage = { stage: 1|2|3, name: 'ytdlp'|'scan'|'browser',
          status: 'pending'|'running'|'success'|'failed'|'skipped', message: string }

Format = { id: string, label: string, ext: string, height: number|null, fps: number|null,
           vcodec: string|null, acodec: string|null, filesize: number|null, tbr: number|null,
           kind: 'av'|'video'|'audio' }

Item = { id: string, title: string, url: string, thumbnail: string|null, duration: number|null,
         extractor: string, stage: 1|2|3, drm: boolean, formats: Format[] }

Analysis = { id: string, url: string, status: 'running'|'done'|'failed', createdAt: number,
             stages: Stage[], items: Item[], error: string|null }

Job = { id: string, analysisId: string, itemId: string, title: string, format: string,
        status: 'queued'|'downloading'|'merging'|'done'|'failed'|'cancelled',
        percent: number|null, speed: string|null, eta: string|null,
        downloaded: string|null, total: string|null, file: string|null,
        error: string|null, log: string[] /* 최근 40줄 */, createdAt: number }

Settings = { downloadDir: string, browserVisible: boolean,
             cookiesBrowser: ''|'edge'|'chrome'|'firefox', useLoginProfile: boolean,
             concurrentFragments: number /* 1~16 */ }
```

## 엔드포인트

| 메서드 | 경로 | 요청 | 응답 |
|---|---|---|---|
| GET | `/api/state` | – | `{ tools: Tool[], toolsBusy: boolean, settings, analyses: Analysis[] (최근 20), jobs: Job[] }` |
| POST | `/api/tools/install` | `{ names?: string[] }` (생략 시 없거나 오래된 것 전부) | `{ ok: true }` — 진행은 `tools`/`toolLog` 이벤트 |
| POST | `/api/analyze` | `{ url: string, forceStage?: 1\|2\|3 }` | `{ id }` — 진행은 `analysis` 이벤트 |
| POST | `/api/download` | `{ analysisId, itemId, format: 'best'\|'audio'\|'<format id>' , height?: number }` | `{ id }` (Job id) |
| POST | `/api/jobs/:id/cancel` | – | `{ ok }` |
| POST | `/api/jobs/:id/reveal` | – | `{ ok }` 탐색기에서 파일 위치 열기 |
| DELETE | `/api/jobs/:id` | – | `{ ok }` 목록에서 제거(완료/실패만) |
| POST | `/api/settings` | `Partial<Settings>` | `{ settings }` |
| POST | `/api/login-browser` | `{ url }` | `{ ok }` 화면이 보이는 브라우저를 전용 프로필로 열어 사용자가 로그인하게 함(3단계가 같은 프로필 재사용) |
| POST | `/api/open-folder` | – | `{ ok }` 다운로드 폴더 열기 |
| POST | `/api/shutdown` | – | `{ ok }` 진행 중 다운로드를 취소하고 서버 종료 |
| GET | `/api/sites` | – | `{ sites: Site[] }` 학습된 사이트 |
| DELETE | `/api/sites/:domain` | – | `{ ok }` 학습 기록 삭제 |

`Site = { domain, stage: 2|3, hits, fails, lastSuccess: ISO 문자열, sample: 성공한 미디어 주소 }`.
`/api/state`와 `state` 이벤트에 `sites: Site[]`가 포함되고, 변경 시 `sites` 이벤트(`{ sites }`)가 온다.
Analysis에는 학습된 단계부터 시작했을 때 `learnedStage: 2|3`이 붙는다.

오류 응답: HTTP 4xx/5xx + `{ error: string }`.

`format` 의미: `best` = 최고 화질 영상+음성(`height`가 있으면 그 높이 이하 최고), `audio` = 음성만 mp3 추출, 그 외 = 해당 format id(영상 전용 형식이면 서버가 자동으로 `+bestaudio` 붙임).

## SSE `/api/events`

`event: <type>` / `data: <JSON>`. 연결 직후 `state` 이벤트로 `/api/state`와 같은 전체 스냅샷을 1회 보냄.

| type | data |
|---|---|
| `state` | `/api/state`와 동일 |
| `tools` | `{ tools: Tool[], toolsBusy: boolean }` |
| `toolLog` | `{ line: string }` 설치 진행 메시지 |
| `analysis` | `Analysis` (변경 시마다 전체 객체) |
| `job` | `Job` (변경 시마다 전체 객체) |
| `jobRemoved` | `{ id }` |
| `settings` | `Settings` |
