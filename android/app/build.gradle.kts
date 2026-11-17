plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
    id("com.google.devtools.ksp")
}

// Optional settings, read from gradle.properties (yours in ~/.gradle/, or android/gradle.properties):
//   nexguard.apiUrl.release   the production API, e.g. https://api.nexera.rw/api/v1
//   nexguard.fcm.appId / apiKey / projectId / senderId   from the Firebase console (Android app settings)
//   nexguard.signing.storeFile / storePassword / keyAlias / keyPassword   the upload key for Google Play
// Without the Firebase values the app still works: it picks up commands each time it uploads.
// Keep the signing values in ~/.gradle/gradle.properties, never in this repository.
fun prop(name: String, default: String = ""): String = (project.findProperty(name) as String?) ?: default
fun quoted(value: String) = "\"" + value.replace("\"", "\\\"") + "\""

android {
    // The package name cannot change after the first Google Play release.
    namespace = "rw.nexera.nexguard"
    compileSdk = 35

    defaultConfig {
        applicationId = "rw.nexera.nexguard"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "0.4.0"

        // The emulator reaches the PC's localhost at 10.0.2.2.
        buildConfigField("String", "API_BASE_URL", quoted(prop("nexguard.apiUrl.debug", "http://10.0.2.2:4000/api/v1")))
        buildConfigField("String", "FCM_APP_ID", quoted(prop("nexguard.fcm.appId")))
        buildConfigField("String", "FCM_API_KEY", quoted(prop("nexguard.fcm.apiKey")))
        buildConfigField("String", "FCM_PROJECT_ID", quoted(prop("nexguard.fcm.projectId")))
        buildConfigField("String", "FCM_SENDER_ID", quoted(prop("nexguard.fcm.senderId")))
    }

    signingConfigs {
        // Release builds are signed only when the upload key is configured; otherwise they stay unsigned.
        val storeFile = prop("nexguard.signing.storeFile")
        if (storeFile.isNotBlank()) {
            create("release") {
                this.storeFile = file(storeFile)
                storePassword = prop("nexguard.signing.storePassword")
                keyAlias = prop("nexguard.signing.keyAlias")
                keyPassword = prop("nexguard.signing.keyPassword")
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.findByName("release")
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            buildConfigField("String", "API_BASE_URL", quoted(prop("nexguard.apiUrl.release", "https://api.example.com/api/v1")))
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.12.01")
    implementation(composeBom)
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")

    // Location, background work, local queue, settings
    implementation("com.google.android.gms:play-services-location:21.3.0")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    ksp("androidx.room:room-compiler:2.6.1")
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    // Network and JSON
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")

    // Push (wakes the phone for ring/lock). Configured at runtime, no google-services.json needed.
    implementation(platform("com.google.firebase:firebase-bom:33.7.0"))
    implementation("com.google.firebase:firebase-messaging")

    testImplementation("junit:junit:4.13.2")
}
