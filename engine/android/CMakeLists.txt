# Android build of the engine + its TurboModule; linked into the app by autolinking (react-native.config.js).
# shortcut: written alongside iOS but first built in Phase 0 step 11 (Android).
cmake_minimum_required(VERSION 3.13)
project(gf-engine)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(ROOT ${CMAKE_CURRENT_SOURCE_DIR}/..)

add_library(gf-engine STATIC ${ROOT}/src/Engine.cpp ${ROOT}/src/Mixer.cpp ${ROOT}/rn/NativeGfEngineModule.cpp)
target_include_directories(gf-engine PUBLIC ${ROOT}/include ${ROOT}/rn)
target_include_directories(gf-engine SYSTEM PRIVATE ${ROOT}/third_party ${ROOT}/third_party/signalsmith-basics/include)
target_compile_definitions(gf-engine PRIVATE RCT_NEW_ARCH_ENABLED)

find_package(ReactAndroid REQUIRED CONFIG)
find_package(fbjni REQUIRED CONFIG)
find_package(react-native-audio-api REQUIRED CONFIG)

target_link_libraries(gf-engine
  fbjni::fbjni
  ReactAndroid::jsi
  ReactAndroid::reactnative
  react_codegen_gfengine
  react-native-audio-api::react-native-audio-api
  android
  log
)
