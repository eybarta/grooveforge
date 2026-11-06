require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# Mirrors react-native-audio-worklets' podspec (the reference extension for react-native-audio-api 1.x).
Pod::Spec.new do |s|
  s.name         = "GfEngine"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://github.com/eybarta/grooveforge"
  s.license      = "UNLICENSED"
  s.authors      = "Eyal Barta"
  s.platforms    = { :ios => "16.4" }
  s.source       = { :git => "https://github.com/eybarta/grooveforge.git" }

  s.source_files = "src/**/*.{cpp,h}", "include/**/*.h", "rn/**/*.{cpp,h}", "ios/**/*.{mm,h}"
  s.preserve_paths = "third_party/**/*"

  s.dependency "RNAudioAPI"
  s.dependency "React-jsi"

  s.pod_target_xcconfig = {
    "HEADER_SEARCH_PATHS" => [
      '"$(PODS_TARGET_SRCROOT)/include"',
      '"$(PODS_TARGET_SRCROOT)/rn"',
      '"$(PODS_TARGET_SRCROOT)/third_party"',
      '"$(PODS_TARGET_SRCROOT)/third_party/signalsmith-basics/include"',
      '"$(PODS_ROOT)/Headers/Public/RNAudioAPI"',
      '"$(PODS_ROOT)/Headers/Private/ReactCodegen"',
      '"$(PODS_ROOT)/../build/generated/ios/ReactCodegen"',
    ].join(" "),
    "CLANG_CXX_LANGUAGE_STANDARD" => "c++20",
  }

  install_modules_dependencies(s)
end
