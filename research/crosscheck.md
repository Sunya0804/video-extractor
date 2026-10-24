# 영상 다운로드 도구 교차검증

확인일: **2026-10-24 (Asia/Seoul)**. 공식 제품 페이지, 개발자 공지 및 원본 이슈/PR을 우선했다. 웹 조사만 수행했으며 프로그램 설치·실행, 실제 영상 다운로드, 프로젝트 코드 수정은 하지 않았다. 따라서 아래의 “지원”은 문서·구현상 지원이며 당일 모든 영상의 다운로드 성공을 뜻하지 않는다.

## 1. GitHub 밖에서 배포되는 데스크톱 도구

| 도구 | 현재 버전·유지보수 | 무료/유료 | 내부 yt-dlp 사용 | YouTube 상태 |
|---|---|---|---|---|
| **JDownloader 2** | 현재 제품명은 2. 공식 빌드 표시 **revision 50639**, 빌드 날짜 **2026-10-20 15:00:52 CEST**. 코어·플러그인을 계속 갱신하는 방식 | 무료·오픈소스. 외부 파일호스팅 사이트의 Premium 계정 비용과는 별개 | 기본 YouTube 경로는 **자체 Java 플러그인**. yt-dlp GUI로 분류하면 부정확 | 자체 YouTube 플러그인 지원이 존재. 사이트 변경·봇 감지·계정/세션에 따른 장애가 있으므로 “완전 정상 작동”으로 단정하지 않음 |
| **4K Video Downloader (구형)** | 현행 **Plus와 구분 필요**. 제조사 FAQ는 원본 제품이 **2026-02-01 종료**되었다고 명시. 구형 최종 세부 버전은 이번 공식 자료에서 확정하지 못함 | 과거 라이선스와 현행 Plus 라이선스를 혼동하지 말 것 | 현행 Plus의 자체 엔진에 대한 공식 설명을 구형 모든 버전의 내부 구성까지 확장하지 않음 | 현행 유지보수·YouTube 대응 제품으로 소개하기에는 부적절 |
| **4K Video Downloader Plus** | 공식 다운로드 페이지 현재 **26.3.5.0396**, **2026-09-29**, Windows/macOS/Ubuntu | 영구 무료 플랜에 수량 제한. Lite 연간 구독, Personal/Pro 일회성 라이선스 제공 | **아니오.** 제품 관리자가 자체 파서·다운로드 파이프라인을 사용한다고 명시 | YouTube를 공식 지원·판매 중. 영상·재생목록·채널 등 지원. 제조사 지원 표기이며 실다운로드 검증은 하지 않음 |
| **Stacher 7** | 공식 사이트 현재 **7.1.13**. 개발자 Patreon 목록에 **2026-10-22 “Update 7.1.13”** | yt-dlp GUI 기능은 제한 없이 무료. Library·테마 등 추가 기능은 **Stacher Premium**. Library 30일 무료 체험 안내 | **예.** yt-dlp와 FFmpeg에 의존하며 공식 소스에서 설치·관리하는 기능 제공. 현재 사이트는 이 도구들을 직접 호스팅·배포하지 않는다고 명시 | yt-dlp를 통한 YouTube 지원. 실제 호환성은 설치된 yt-dlp 버전·설정·필요 런타임 등에 의존하며 Stacher 버전만으로 보장할 수 없음 |

### JDownloader 근거 및 해석

- [공식 홈페이지](https://jdownloader.org/): 무료·오픈소스 다운로드 관리 도구라고 명시.
- [공식 설치 페이지](https://jdownloader.org/jdownloader2): JDownloader 2 배포 유지, 설치 패키지 갱신 표시는 2026-09-04. 이 날짜는 코어 최신 빌드 날짜와 다르다.
- [공식 현재 빌드 표시](https://svn.jdownloader.org/build.php): 내부 브라우저에서 직접 읽은 값은 `Latest Revision: 50639`, `Date: Tue Oct 20 15:00:52 CEST 2026`. 검색/텍스트 수집기의 해당 URL 접근은 시간 초과였으나 실제 페이지 열람은 성공했다.
- [공식 업데이트 정책](https://support.jdownloader.org/en/knowledgebase/article/updates-update-behavior): 플러그인만 갱신될 때 빌드 번호가 바뀌지 않을 수 있고, 같은 revision이라도 새 릴리스의 빌드 날짜가 달라질 수 있다. 따라서 타 사이트의 `2 r19xxx` 표기를 최신 공식 코어 번호로 재사용하지 않았다.
- [공개 소스: YoutubeDashV2.java](https://raw.githubusercontent.com/mirror/jdownloader/master/src/jd/plugins/hoster/YoutubeDashV2.java), [YoutubeHelper.java](https://raw.githubusercontent.com/mirror/jdownloader/master/src/org/jdownloader/plugins/components/youtube/YoutubeHelper.java): 자체 플러그인·추출·다운로드·FFmpeg 연계 구현을 확인했다. 기본 동작을 yt-dlp 기반으로 분류하지 않는 근거다. 사용자가 별도 스크립트로 yt-dlp를 호출하는 것은 다른 경우다.
- [개발자 공식 포럼 답변](https://board.jdownloader.org/showthread.php?p=547158): YouTube 플러그인과 SABR/봇 감지에 관한 설명. **2025년 답변**이므로 당시 장애·우회를 2026년 당일의 전면 장애나 완전 해결로 해석하지 않았다. 이번 조사로 당일 실동작과 모든 고화질 형식 지원까지 확정하지는 못했다.

### 4K Download 근거 및 버전 주의점

- [공식 최신 다운로드 표](https://www.4kdownload.com/downloads/34): 직접 열람한 현재 표는 **26.3.5.0396 / 2026-09-29**. 검색 결과 요약에는 과거 `26.1.5.0370 / 2026-06-17`이 남아 있어 본문 값을 우선했다.
- [공식 제품 페이지](https://www.4kdownload.com/products/videodownloader-42): YouTube 지원 및 제한이 있는 영구 무료 버전 안내.
- [공식 라이선스 비교](https://www.4kdownload.com/buy/videodownloader-8): Lite 연간 구독, Personal/Pro lifetime 구분. 열람 당시 EUR 표시가는 Lite **€17.85/년**, Personal **€29.75**, Pro **€47.60**였고 할인 배너가 있었다. 지역·세금·프로모션에 따라 바뀔 수 있으므로 고정 정가로 인용하지 말 것.
- [제품 관리자 공식 AMA 답변, 2026-01-26](https://www.4kdownload.com/blog/2026/01/26/your-faqs-answered-part-ii/): 자체 파서와 다운로드 파이프라인을 사용하며 yt-dlp의 진행 상황을 참고한다고 설명. “yt-dlp 래퍼”라는 주장을 반박하는 직접 근거다.
- [제조사 2026 FAQ: 원본 제품 종료 및 Plus 대체](https://www.4kdownload.com/blog/2026/05/25/best-free-youtube-downloader-in-2026/): 원본 제품 종료일을 2026-02-01로 명시하고 기존 라이선스가 Plus로 자동 이전되지 않는다고 설명. 이 글의 마케팅성 성공률·경쟁제품 평가는 이번 비교의 검증 사실로 채택하지 않았다.

### Stacher 근거

- [공식 사이트](https://www.stacher.io/): 내부 브라우저에서 **7.1.13**과 yt-dlp/FFmpeg 의존성을 직접 확인했다. JavaScript 없는 텍스트 열람에서는 안내문만 보일 수 있다.
- [공식 사이트의 무료/Premium 설명이 수집된 URL](https://stacher.io/?trk=public_post_comment-text): GUI 기능 무료·무제한, Premium 추가 기능과 Library 체험 안내.
- [개발자 Patreon 게시물 목록](https://www.patreon.com/cw/stacher/sitemap): 2026-10-22 버전 7.1.13 갱신 게시물 확인.
- [공식 변경 기록](https://changelog.stacher.io/): yt-dlp 업데이트 관리·JS 런타임 관리·Deno 관련 변경을 안내한다. 이 페이지의 검색 색인에는 과거 버전이 섞이므로 현재 버전 판정은 공식 첫 화면과 개발자 게시물로 교차확인했다.

## 2. cobalt.tools 공용 인스턴스의 YouTube 지원

**현재 판정: 공용 기본 인스턴스의 YouTube 다운로드는 사용 불가 상태로 안내해야 한다.** 저장소의 지원표에 YouTube가 있다는 이유로 `cobalt.tools에서 현재 YouTube 지원`이라고 쓰면 부정확하다.

- [원본 추적 이슈 imputnet/cobalt #1356](https://github.com/imputnet/cobalt/issues/1356)는 확인 시점에도 **Open**, `main instance issue`다. 운영자는 YouTube의 네트워크 제한으로 공용 서버 요청이 차단되고 이전 우회도 통하지 않는다고 설명했다. 2025-08-15 갱신에서도 현재 규모의 중앙 서버 방식으로 제한을 피하지 못한다고 명시한다.
- [2026년 현재 이슈 목록](https://github.com/imputnet/cobalt/issues)에도 해당 공용 인스턴스 장애가 고정되어 있다. 단순히 오래된 종료 이슈를 현행 상태로 오인한 것은 아니다.
- [공식 API README](https://github.com/imputnet/cobalt/blob/main/api/README.md)는 코드 차원의 YouTube 지원과 `youtube.js` 사용을 명시한다. 이는 공용 인스턴스의 가용성과 다른 층위다. 자체 호스팅/다른 인스턴스의 성공 여부를 공용 서버의 성공으로 대입할 수 없다.

검증 한계: 운영자 공지와 현재 열린 추적 상태에 근거한 판정이다. 공용 API로 영상을 내려받는 실험은 수행하지 않았다.

## 3. yt-dlp의 SABR 대응 현황

**현재 판정: SABR 다운로드 구현은 시험 가능한 개발 PR에 존재하지만, 공식 master에 병합되어 정식 지원이 완료된 상태는 아니다.** 비-SABR 형식을 얻는 클라이언트/HLS 우회와 SABR 프로토콜 자체 구현을 구분해야 한다.

| 번호 | 확인된 상태·날짜 | 핵심 내용 |
|---|---|---|
| [이슈 #12482](https://github.com/yt-dlp/yt-dlp/issues/12482) | **Open**, 2025-02-26 개설 | `web` 클라이언트가 직접 HTTPS 형식 대신 SABR URL만 주는 문제의 핵심 추적 이슈. 2025-04-29 개발자는 SABR 다운로더 개발 중이라고 설명. 당시 tv/mweb 등의 우회 안내를 현재의 영구 해결책으로 해석하면 안 됨 |
| [PR #13515](https://github.com/yt-dlp/yt-dlp/pull/13515) | **Open / 미병합**, 현재 안내 시험 빌드 갱신일 **2026-10-21** | YouTube **Server Adaptive Bit Rate (SABR)** 프로토콜 다운로더 구현. PR 설명은 #12482 해결을 목표로 명시. 테스트용 별도 브랜치/빌드가 있으며 일반 stable/nightly/master 업데이트와 구분 필요 |
| [이슈 #17666](https://github.com/yt-dlp/yt-dlp/issues/17666) | 2026-09-10 개설, 09-16 재개방 | 일부 세션에서 `mweb`, `web_embedded`까지 SABR-only가 되어 형식 18 외 HTTPS 형식이 사라지는 사례. 로그인 쿠키가 없는 경우도 보고됨. 과거 mweb 우회가 모든 세션에서 유효하지 않음을 보여 줌 |
| [PR #17684](https://github.com/yt-dlp/yt-dlp/pull/17684) | **Merged, 2026-09-16**, `c7fb478` | `web_embedded`에 Safari User-Agent를 사용해 **HLS 형식 91–96**을 확보하는 부분 대응. #17666을 일부 완화하며 SABR 다운로더 완성을 뜻하지 않음 |

PR #13515의 현재 설명상 구현 범위:

- SABR URL을 반환하는 클라이언트에서 SABR 형식을 제공하며 기본적으로 HTTPS 형식을 우선한다.
- Protobuf 처리를 위한 `protobug` 라이브러리를 요구한다.
- 라이브·종료 직후 라이브·프리미어 지원 코드는 있으나 기본 비활성화/실험적 범위로 안내한다.
- `web` 클라이언트에는 PO Token이 필요하다는 안내가 있다. 시험 빌드가 존재한다는 사실과 실험 기능의 안정성 보장은 다르다.
- [PR에서 연결한 SABR 시험 빌드](https://github.com/bashonly/yt-dlp/releases/tag/sabr)는 **별도 시험 배포 경로**다. 이번 조사에서는 설치하지 않았다.

[공식 PO Token 가이드](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)는 mweb용 GVS PO Token 공급 플러그인을 안내하지만, PO Token 자체가 SABR 프로토콜 구현을 대신하지는 않는다. 또한 n/signature JavaScript 처리 문제, HTTP 403, 봇 감지 등 모든 YouTube 실패를 SABR 하나로 설명해서도 안 된다.

## 비교 문서에 반영할 핵심 교정

1. **yt-dlp GUI는 Stacher**다. JDownloader와 4K Video Downloader Plus까지 동일한 yt-dlp 기반으로 묶지 않는다.
2. **구형 4K Video Downloader와 현행 Plus를 분리**한다. 현행 비교에는 Plus의 버전·요금·지원 상태를 사용한다.
3. **cobalt 코드의 YouTube 지원 ≠ cobalt.tools 공용 서버의 현재 가용성**이다.
4. **yt-dlp의 SABR은 “개발 PR/시험 빌드 존재, 아직 미병합”**으로 표현한다. 단순히 “미지원”이라고만 써도 현재 개발 진척을 놓치고, “지원 완료”라고 써도 과장이다.
