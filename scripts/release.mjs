// 실제 게시 전 태그 중복을 확인하고 APK·NSIS·업데이트 메타데이터를 함께 올린다.
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('정식 major.minor.patch 버전이 필요합니다');
const repo = 'Sunya0804/video-extractor';
const tag = `v${version}`;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} 실패: ${result.error?.message || result.stderr || result.status}`);
  return result.stdout || '';
}
// release view 실패를 "태그 없음"으로 간주하지 않는다. 인증·네트워크 실패도 중단한다.
run('gh', ['api', `repos/${repo}`]);
const query = `query($owner:String!,$name:String!,$tag:String!){repository(owner:$owner,name:$name){ref(qualifiedName:$tag){name} release(tagName:$tag){tagName}}}`;
const metadata = JSON.parse(run('gh', ['api', 'graphql', '-f', `query=${query}`, '-f', 'owner=Sunya0804', '-f', 'name=video-extractor', '-f', `tag=refs/tags/${tag}`]));
if (metadata.errors || !metadata.data?.repository) throw new Error('태그 상태를 확인하지 못했습니다');
// GraphQL release에는 refs/tags 접두사 없는 태그를 따로 조회한다.
const releases = JSON.parse(run('gh', ['api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`]));
if (metadata.data.repository.ref || releases.flat().some((r) => r.tag_name === tag)) throw new Error(`${tag} 태그 또는 릴리스가 이미 있습니다`);
if (run('git', ['tag', '--list', tag]).trim()) throw new Error(`${tag} 로컬 태그가 이미 있습니다`);
run(process.execPath, ['android/dist.mjs'], { stdio: 'inherit' });
// .cmd 셸 보간 없이 electron-builder의 JS CLI를 실행한다.
run(process.execPath, ['node_modules/electron-builder/cli.js', '--win', '--publish', 'never'], { stdio: 'inherit' });
const files = [`VideoExtractor-${version}.apk`, `VideoExtractor-Setup-${version}.exe`, `VideoExtractor-Setup-${version}.exe.blockmap`, 'latest.yml'].map((name) => path.join(root, 'dist', name));
for (const file of files) if (!existsSync(file)) throw new Error(`빌드 파일이 없습니다: ${path.basename(file)}`);
run('gh', ['release', 'create', tag, ...files, '--repo', repo, '--target', run('git', ['rev-parse', 'HEAD']).trim(), '--title', `Video Extractor ${version}`, '--generate-notes'], { stdio: 'inherit' });
