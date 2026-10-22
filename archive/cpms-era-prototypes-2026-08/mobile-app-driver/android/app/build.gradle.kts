import java.util.Properties
import java.io.FileInputStream

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Release signing config. Reads android/key.properties (gitignored) if
// present. Falls back to the debug keystore so `flutter run` works without
// the upload keystore being set up. Play Store uploads MUST be signed with
// the upload key — never the debug key.
val keystorePropsFile = rootProject.file("key.properties")
val keystoreProps = Properties().apply {
    if (keystorePropsFile.exists()) {
        load(FileInputStream(keystorePropsFile))
    }
}
val hasReleaseKeystore = keystorePropsFile.exists()

android {
    namespace = "com.example.straumvakt_mock1"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        applicationId = "is.straumvakt.driver"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        create("release") {
            if (hasReleaseKeystore) {
                storeFile = file(keystoreProps["storeFile"] as String)
                storePassword = keystoreProps["storePassword"] as String
                keyAlias = keystoreProps["keyAlias"] as String
                keyPassword = keystoreProps["keyPassword"] as String
            }
        }
    }

    // Skip native debug symbol stripping — the local NDK toolchain on this
    // box doesn't supply objcopy, and Play accepts AABs with symbols
    // present (just a few MB larger).
    packagingOptions {
        jniLibs {
            keepDebugSymbols += "**/*.so"
        }
    }

    buildTypes {
        release {
            signingConfig = if (hasReleaseKeystore) {
                signingConfigs.getByName("release")
            } else {
                signingConfigs.getByName("debug")
            }
            // Minification disabled — Flutter's embedding references
            // Play Core SplitInstall classes that aren't in the bundle, so
            // R8 fails the build looking for them. We don't use deferred
            // components, so the size win isn't worth the friction.
            isMinifyEnabled = false
            isShrinkResources = false
        }
    }
}

flutter {
    source = "../.."
}
