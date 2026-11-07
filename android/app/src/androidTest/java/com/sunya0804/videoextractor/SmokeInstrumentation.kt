package com.sunya0804.videoextractor

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.os.Bundle
import android.os.SystemClock
import android.view.KeyEvent
import org.json.JSONObject
import org.json.JSONTokener
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** emulator-5554에서 릴리스 APK의 실제 WebView·yt-dlp·서비스 경로를 검증한다. */
class SmokeInstrumentation : Instrumentation() {
    private lateinit var activity: MainActivity
    private lateinit var fixture: String
    private var mode = "smoke"
    private val results = mutableListOf<String>()
    override fun onCreate(arguments: Bundle?) {
        fixture = arguments?.getString("fixture") ?: "http://127.0.0.1:8765/sample.mp4"
        mode = arguments?.getString("mode") ?: "smoke"
        super.onCreate(arguments)
        start()
    }

    private fun js(script: String): String {
        val wait = CountDownLatch(1)
        var result = "null"
        runOnMainSync { activity.web.evaluateJavascript(script) { result = it; wait.countDown() } }
        check(wait.await(5, TimeUnit.SECONDS)) { "JavaScript timeout" }
        return result
    }
    private fun waitFor(label: String, timeout: Long = 60_000, condition: () -> Boolean) {
        val end = SystemClock.elapsedRealtime() + timeout
        while (SystemClock.elapsedRealtime() < end) {
            if (runCatching(condition).getOrDefault(false)) return
            SystemClock.sleep(250)
        }
        error("$label timeout: ${js("document.body.innerText.slice(-2000)")}")
    }
    private fun record(text: String) { results.add(text); sendStatus(0, Bundle().apply { putString("stream", "$text\n") }) }
    private fun request(path: String, body: String = "{}", method: String = "POST"): JSONObject {
        js("window.smokeResult=null;window.smoke.request(${JSONObject.quote(path)},$body,${JSONObject.quote(method)}).then(value=>window.smokeResult={value},error=>window.smokeResult={error:error.message,status:error.status});true")
        waitFor(path) { js("window.smokeResult!==null") == "true" }
        val outer = JSONTokener(js("JSON.stringify(window.smokeResult)")).nextValue() as String
        return JSONObject(outer)
    }
    private fun jobs() = js("localStorage.getItem('vx.jobs') || '[]'").let { JSONTokener(it).nextValue() as String }
    private fun harness() {
        js("window.smoke=null;import('https://appassets.androidplatform.net/assets/www/android.js').then(m=>window.smoke=m.createAndroid(()=>{},()=>{}));true")
        waitFor("test transport") { js("!!window.smoke") == "true" }
        waitFor("engine") { !request("/api/state", method = "GET").has("error") }
    }

    override fun onStart() {
        try {
            activity = startActivitySync(Intent(targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) as MainActivity
            waitFor("page") { js("document.querySelector('#urls')!==null && document.querySelector('#connection').textContent.includes('준비됨')") == "true" }
            if (mode == "restore") {
                waitFor("process restart resume", 180_000) {
                    js("(()=>{const jobs=JSON.parse(localStorage.getItem('vx.jobs')||'[]').filter(j=>j._url?.includes('/resume.mp4'));return jobs.length>=2&&jobs.every(j=>j.status==='done')})()") == "true"
                }
                record("앱 프로세스 재시작 후 대기열 2개 자동 복원·완료 성공")
                finish(Activity.RESULT_OK, Bundle().apply { putString("stream", results.joinToString("\n")); putBoolean("passed", true) })
                return
            }
            targetContext.startActivity(Intent(targetContext, MainActivity::class.java).setAction(Intent.ACTION_SEND).setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, "공유 테스트 $fixture").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            waitFor("shared analysis", 120_000) { js("document.querySelectorAll('#analyses .item').length>0") == "true" }
            record("공유 인텐트·HTTP 분석 성공")
            harness()
            request("/api/settings", "{\"concurrentDownloads\":1,\"useLoginProfile\":false}")
            val analysisId = request("/api/analyze", "{\"url\":${JSONObject.quote(fixture)}}").getJSONObject("value").getString("id")
            waitFor("analysis", 120_000) { request("/api/state", method = "GET").optJSONObject("value")?.getJSONArray("analyses")?.let { list ->
                (0 until list.length()).any { list.getJSONObject(it).optString("id") == analysisId && list.getJSONObject(it).optString("status") == "done" }
            } == true }
            val all = request("/api/state", method = "GET").getJSONObject("value").getJSONArray("analyses")
            val analysis = (0 until all.length()).map { all.getJSONObject(it) }.first { it.getString("id") == analysisId }
            val itemId = analysis.getJSONArray("items").getJSONObject(0).getString("id")
            val body = JSONObject().put("analysisId", analysisId).put("itemId", itemId).put("format", "best").toString()
            if (mode == "prepare") {
                val first = request("/api/download", body).getJSONObject("value").getString("id")
                val second = request("/api/download", JSONObject(body).put("height", 720).toString()).getJSONObject("value").getString("id")
                waitFor("persist queued") { js("JSON.parse(localStorage.getItem('vx.jobs')||'[]').some(j=>j.status==='queued')") == "true" }
                record("재시작용 실행·대기 작업 저장: $first, $second")
                finish(Activity.RESULT_OK, Bundle().apply { putString("stream", results.joinToString("\n")); putBoolean("passed", true) })
                return
            }
            val first = request("/api/download", body).getJSONObject("value").getString("id")
            check(request("/api/download", body).optInt("status") == 409)
            waitFor("native progress", 120_000) { File(targetContext.cacheDir, "downloads/$first").listFiles()?.isNotEmpty() == true }
            sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
            SystemClock.sleep(800)
            check(!activity.isFinishing)
            targetContext.startActivity(Intent(targetContext, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            waitFor("return to app") { activity.hasWindowFocus() }
            record("중복409·다운로드 중 뒤로 가기 후 재진입 성공")
            request("/api/jobs/$first/cancel")
            waitFor("cancel") { jobs().contains("cancelled") }
            check(!File(targetContext.cacheDir, "downloads/$first").exists())
            record("네이티브 취소·임시 조각 정리 성공")
            val retried = request("/api/jobs/$first/retry").getJSONObject("value").getString("id")
            check(first != retried)
            waitFor("retry active") { File(targetContext.cacheDir, "downloads/$retried").listFiles()?.isNotEmpty() == true }
            // renderer를 실제 종료시킨다. Bridge와 서비스는 같은 앱 프로세스에 남아야 한다.
            runOnMainSync { activity.web.loadUrl("chrome://crash") }
            SystemClock.sleep(1500)
            waitFor("renderer recovery", 90_000) { js("document.querySelector('#connection')?.textContent.includes('준비됨')") == "true" }
            check(!activity.isDestroyed)
            record("렌더러 강제 종료 후 화면 복구·다운로드 유지 성공")
            waitFor("download done", 180_000) {
                js("JSON.parse(localStorage.getItem('vx.jobs')||'[]').find(j=>j.id===${JSONObject.quote(retried)})?.status==='done'") == "true"
            }
            record("다시 받기·실제 파일 완료 성공")
            finish(Activity.RESULT_OK, Bundle().apply { putString("stream", results.joinToString("\n")); putBoolean("passed", true) })
        } catch (error: Throwable) {
            finish(Activity.RESULT_CANCELED, Bundle().apply { putString("stream", results.joinToString("\n") + "\n" + error.stackTraceToString()); putBoolean("passed", false) })
        }
    }
}
