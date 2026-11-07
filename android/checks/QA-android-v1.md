# Android 1.0 안정성 검사 (2026-11-07)

버전은 올리지 않았습니다. `emulator-5554` / `vx_phone` / Android 36 x86_64에서 확인했습니다. 사용자의 다른 에뮬레이터는 조작하지 않았습니다.

## 통과

- 통합 소스의 루트 `npm test`: 54개 통과.
- PowerShell에서 `android/`의 `.\gradlew.bat assembleRelease "-Pvx.abis=arm64-v8a,x86_64"`: 성공.
- 위 빌드에 연결된 `AndroidPolicyTest`: 공유 URL 추출과 외부 설치 콜백 거부 2개 통과. 실행되지 않던 `SharedLinkCheck.kt`를 이 검사로 옮겼습니다.
- 릴리스 APK와 별도 검사 APK를 `adb -s emulator-5554 install -r`로 설치했습니다.
- 실제 WebView·브리지·yt-dlp 경로: 공유 인텐트/HTTP 분석, 동일 작업 409, 다운로드 중 Back 후 재진입, 취소/임시 조각 삭제, 새 ID 다시 받기와 실제 MP4 완료를 확인했습니다.
- `chrome://crash`로 화면 렌더러를 실제 종료하고 같은 앱 프로세스에서 새 WebView가 열리며 진행 중 다운로드에 다시 연결되는 것을 확인했습니다.
- 실행 중 1개·대기 중 1개를 저장한 직후 앱 프로세스를 종료하고 다시 실행해 두 작업이 자동으로 복원·완료되는 것을 확인했습니다. 이 검사에서 찾은 Chromium localStorage의 지연 디스크 반영 문제는 네이티브 `saveJobs` commit과 revision 검사로 수정했습니다.
- `READ_EXTERNAL_STORAGE` 참조는 앱 소스에서 0개입니다. 저장 권한은 API 29 이하, FileProvider는 `Download/VideoExtractor/`로 제한했습니다. 업데이트 APK는 FileProvider를 사용하지 않습니다.

## 재현

검사 APK는 실제 앱과 별도로 설치되며 앱에 테스트 진입점이나 디버그 포트를 추가하지 않습니다. 테스트는 전용 기기의 앱 데이터를 바꿉니다.

1. `ffmpeg -f lavfi -i testsrc2=size=320x180:rate=15 -t 40 -c:v mpeg4 -b:v 600k -movflags +faststart smoke.mp4`
2. 루트에서 `node android/checks/media-server.mjs smoke.mp4`를 실행합니다.
3. PowerShell의 `android/`에서 `.\gradlew.bat assembleRelease assembleReleaseAndroidTest "-Pvx.abis=arm64-v8a,x86_64"`를 실행합니다.
4. 두 APK(`app/build/outputs/apk/release/app-release.apk`, `app/build/outputs/apk/androidTest/release/app-release-androidTest.apk`)를 `adb -s emulator-5554 install -r`로 설치합니다.
5. `adb -s emulator-5554 reverse tcp:8765 tcp:8765`
6. `adb -s emulator-5554 shell am instrument -w -e fixture http://127.0.0.1:8765/sample.mp4 com.sunya0804.videoextractor.test/com.sunya0804.videoextractor.SmokeInstrumentation`
7. 재시작 검사는 같은 명령에 `-e mode prepare -e fixture http://127.0.0.1:8765/resume.mp4`를 사용하고, 완료 직후 `adb -s emulator-5554 shell am force-stop com.sunya0804.videoextractor` 후 `-e mode restore`로 다시 실행합니다.

## 한계

- API 29 기기에서 런타임 저장 권한 대화상자를 직접 누르는 검사는 하지 못했습니다(설치된 시스템 이미지는 API 36).
- 실제 새 APK를 유료 네트워크에서 받거나 설치하는 검사는 하지 않았습니다. 명시적 다운로드 요청/무제한 네트워크 확인과 전환 중단은 코드로, 설치 세션·토큰 일치 조건은 JVM 검사로 확인했습니다.
- 기본 한글 AVD 경로에서 부팅이 멈춰 테스트 AVD를 `C:/Android/vx-avds`에 만들었습니다. `ANDROID_AVD_HOME`을 그 경로로 지정하면 같은 `vx_phone`을 사용할 수 있습니다.

동시 다운로드 큐 테스트의 입력을 6개 서로 다른 영상으로 바꾼 것은 사용자가 별도로 허용한 범위 확장입니다. 동시 작업의 PC 코드·화면·릴리스 스크립트는 통합 때 공용 최신 내용을 그대로 보존했습니다.
