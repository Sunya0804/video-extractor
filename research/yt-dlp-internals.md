# yt-dlp는 어떻게 영상을 찾나 — 소스 분석과 우리 프로젝트 반영

분석 대상: yt-dlp master `fa98866` (2026-10-23), 추출기 파일 941개. 파일·줄 번호는 이 커밋 기준.

## 1. 전체 흐름

1. **추출기 고르기** — `YoutubeDL.extract_info()`가 등록된 추출기(InfoExtractor)를 순서대로 돌며 `suitable(url)`을 묻는다. 각 추출기는 `_VALID_URL` 정규식을 갖고 있고(`extractor/common.py:592`, `suitable()` 627행), 처음 맞는 것이 처리한다. 맨 마지막은 `_VALID_URL = '.*'`인 **Generic**이다.
2. **정보 추출** — 고른 추출기의 `_real_extract()`가 페이지·내부 API를 호출해 "info dict"(제목, `formats` 목록, `http_headers` 등)를 돌려준다. HLS/DASH 목록은 공용 도우미 `_extract_m3u8_formats`/`_extract_mpd_formats`로 형식 목록이 된다(이 과정에서 DRM 표시 `has_drm`도 붙음).
3. **다운로드** — 형식을 고른 뒤 프로토콜별 다운로더(http, hls/dash 조각, ffmpeg)가 받고, 영상+음성이면 ffmpeg로 합친다.

즉 **"지원 사이트" = 그 사이트 전용 `_VALID_URL`을 가진 추출기가 있다는 뜻**이고, 없으면 전부 Generic이 떠안는다.

## 2. Generic 추출기가 하는 일 (`extractor/generic.py`)

`_real_extract()` (763행):
1. 페이지 요청. Cloudflare 403이면 안내만 하고 실패(818~843행).
2. 응답 Content-Type이 영상/음성/m3u8이면 **직접 링크**로 처리(858~886행). 앞 512바이트가 `#EXTM3U`면 HLS(895행), HTML이 아니면 직접 파일로 간주(903행).
3. XML이면 RSS·SMIL·XSPF·DASH(MPD)·F4M·ISM 목록으로 해석(925~963행).
4. HTML이면 `_extract_embeds()`(986행):
   - **모든 추출기의 `extract_from_webpage()`** 호출 — 각 추출기의 `_EMBED_REGEX`로 iframe/스크립트 임베드(YouTube, Vimeo, Brightcove …)를 찾음(1001~1018행)
   - JW Player 설정, Video.js `videojs(...).src(...)`, KVS 플레이어, **JSON-LD**(VideoObject), 몇 가지 정규식(`flashvars file=`, `jwplayer().setup({file:`, `file|video_url:`, Flowplayer), `twitter:player:stream`, `og:video`, `twitter:player` iframe(1020~1225행)
5. 아무것도 없으면 `raise UnsupportedError(url)`(984행) → 우리가 본 **"Unsupported URL"**.

### Generic이 하지 않는 것 (= "빠꾸"의 원인)

| 하지 않는 것 | 근거 |
|---|---|
| 일반 iframe 따라가기 | 알려진 추출기의 `_EMBED_REGEX`에 맞는 iframe만 처리. 같은 사이트의 `/embed/123` 같은 iframe은 무시 |
| 외부 JS 파일 읽기 | 받은 HTML 한 장만 검사. 플레이어 설정이 `player-config.js`에 있으면 못 찾음 |
| 난독화 해제 | `utils.decode_packed_codes()`(P.A.C.K.E.R. 해제)가 있지만 generic은 호출하지 않음(특정 사이트 추출기에서만 사용) |
| base64·퍼센트 인코딩된 주소 | 996~998행 주석: 페이지 전체 unquote는 "FIXME"로 꺼져 있음 |
| 상대 경로 미디어 주소 일반 탐색 | 정규식 대부분이 `http`로 시작하는 절대 주소만 찾음 |
| JavaScript 실행 | 실행 중 만들어지는 주소는 원리상 불가 |

## 3. 확장 지점

- **플러그인**(`plugins.py`, `--plugin-dirs`, options.py 443행): `<dir>/<패키지>/yt_dlp_plugins/extractor/*.py`를 불러온다. 플러그인 추출기는 내장보다 우선한다. 배포용 `yt-dlp.exe`에서도 동작함을 확인(`[debug] Extractor Plugins: VXHiddenMediaIE`).
- **임베드 전용 추출기**: `_VALID_URL = False`로 두고 `_extract_from_webpage()`를 구현하면, Generic 4단계의 "모든 추출기 `extract_from_webpage()` 호출"에 끼어든다(common.py 4077~4105행). 특정 사이트가 아니라 **Generic 자체를 강화**할 수 있다.
- **사이트 전용 추출기**: 특정 사이트를 제대로 지원하려면 `_VALID_URL`을 가진 추출기를 플러그인으로 작성(사이트 API 호출, 서명 등).

## 4. 우리 프로젝트에 반영한 것

| 반영 | 파일 | 효과 |
|---|---|---|
| yt-dlp 플러그인 `vx:hidden` | `plugins/vx/yt_dlp_plugins/extractor/vx_hidden.py` | 1단계에서 P.A.C.K.E.R.·base64로 숨긴 m3u8/mp4를 찾아 Referer와 함께 Generic으로 넘김. 테스트 페이지가 "Unsupported URL" → 형식 5개로 바뀜 |
| 2단계 강화 | `lib/decode.mjs`, `lib/scan.mjs` | 난독화·base64·퍼센트 인코딩 해제, 상대 경로, 플레이어 설정 키(Clappr/DPlayer/ArtPlayer 등), **iframe 한 단계 따라가기**(찾은 주소의 Referer는 iframe 페이지), **같은 사이트 플레이어 스크립트 최대 4개 읽기**. hls.js 데모가 3단계(브라우저) 대신 2단계에서 해결됨 |
| 사이트 학습 | `lib/sites.mjs`, `data/sites.json` | 2·3단계로 성공한 도메인을 기억해 다음엔 그 단계부터 시도(테스트: 10.6초 → 3.6초). 실패가 더 많아지면 원래 순서로. 화면 "학습된 사이트"에서 확인·삭제 |

### 그래도 안 되는 경우
- 실행 중에만 만들어지는 주소, 토큰 서명 → 3단계(헤드리스 브라우저)가 담당
- 로그인 필요 → 로그인 프로필
- DRM → 원리상·법적으로 불가

## 5. 사이트 전용 플러그인을 더 만들려면

`plugins/vx/yt_dlp_plugins/extractor/` 아래에 파일을 추가한다. 최소 형태:

```python
from yt_dlp.extractor.common import InfoExtractor

class ExampleSiteIE(InfoExtractor):
    _VALID_URL = r'https?://(?:www\.)?example\.com/watch/(?P<id>\d+)'

    def _real_extract(self, url):
        video_id = self._match_id(url)
        webpage = self._download_webpage(url, video_id)
        m3u8 = self._search_regex(r'"hls"\s*:\s*"([^"]+)"', webpage, 'm3u8')
        return {
            'id': video_id,
            'title': self._og_search_title(webpage),
            'formats': self._extract_m3u8_formats(m3u8, video_id, 'mp4'),
            'http_headers': {'Referer': url},
        }
```

서버를 다시 켤 필요 없이 다음 분석부터 적용된다(yt-dlp를 매번 새로 실행하므로).
