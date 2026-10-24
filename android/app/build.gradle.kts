import java.util.Properties

plugins {
    id("com.android.application")
}

// 버전은 데스크톱과 같이 루트 package.json 하나에서 정한다. 1.2.3 → versionCode 10203.
val appVersion: String = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"")
    .find(rootProject.file("../package.json").readText())!!.groupValues[1]
val appVersionCode: Int = appVersion.split(".").map { it.toInt() }.let { (major, minor, patch) -> major * 10000 + minor * 100 + patch }

// 서명 키는 ChartDesk와 같은 것을 쓴다(사용자 폴더의 .chartdesk/android-signing.properties).
val signingDir = File(System.getProperty("user.home"), ".chartdesk")
val signing = Properties().apply {
    val file = File(signingDir, "android-signing.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}

android {
    namespace = "com.sunya0804.videoextractor"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.sunya0804.videoextractor"
        minSdk = 26
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersion
        ndk { abiFilters += "arm64-v8a" }
    }

    signingConfigs {
        if (signing.isNotEmpty()) {
            create("release") {
                storeFile = File(signingDir, signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    // youtubedl-android는 python/ffmpeg/qjs를 .so 파일로 싣고 설치 때 풀린 파일을 실행한다.
    packaging {
        jniLibs { useLegacyPackaging = true }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

// 화면(public)과 yt-dlp 플러그인(plugins)은 데스크톱과 같은 것을 빌드 직전에 assets로 복사한다.
val copyWebAssets = tasks.register<Sync>("copyWebAssets") {
    into(layout.projectDirectory.dir("src/main/assets"))
    from(rootProject.file("../public")) { into("www") }
    from(rootProject.file("../plugins")) {
        into("plugins")
        exclude("**/__pycache__/**", "**/*.pyc")
    }
}
tasks.named("preBuild") { dependsOn(copyWebAssets) }

dependencies {
    implementation("io.github.junkfood02.youtubedl-android:library:0.18.1")
    implementation("io.github.junkfood02.youtubedl-android:ffmpeg:0.18.1")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.core:core:1.13.0")
}
