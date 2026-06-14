# Keep Flutter engine classes — covers the platform-channel surface that
# R8 can't infer from static analysis alone.
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }
-keep class io.flutter.plugin.** { *; }

# Keep Kotlin metadata so reflection-driven plugins (none today, but defends
# future adds) keep working.
-keep class kotlin.Metadata { *; }
-keepattributes Signature, *Annotation*, EnclosingMethod
