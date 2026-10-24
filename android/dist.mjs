// 안드로이드 APK를 만들어 dist/VideoExtractor-<버전>.apk로 둔다.
// 서명 키(ChartDesk와 같은 ~/.chartdesk/android-signing.properties)가 없으면 서명되지 않은 APK가 나와 설치할 수 없으므로 멈춘다.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const { version } = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
if (!existsSync(join(homedir(), ".chartdesk", "android-signing.properties"))) {
  console.error("서명 키가 없습니다: ~/.chartdesk/android-signing.properties");
  process.exit(1);
}
const gradle = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
// Windows의 .bat은 셸로만 돌릴 수 있다. 인자가 고정이라 명령 한 줄로 넘긴다.
const result = spawnSync(`"${join(here, gradle)}" assembleRelease --console=plain`, { cwd: here, stdio: "inherit", shell: true });
if (result.status !== 0) process.exit(result.status ?? 1);
mkdirSync(join(here, "..", "dist"), { recursive: true });
const target = join(here, "..", "dist", `VideoExtractor-${version}.apk`);
copyFileSync(join(here, "app", "build", "outputs", "apk", "release", "app-release.apk"), target);
console.log(target);
