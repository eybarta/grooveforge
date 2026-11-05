// Autolinking for the pure C++ TurboModule (same keys as react-native-audio-worklets).
// iOS: GfEngine.podspec + NativeGfEngineModuleProvider. Android: codegen CMake + android/CMakeLists.txt.
module.exports = {
  dependency: {
    platforms: {
      ios: {},
      android: {
        cmakeListsPath: "build/generated/source/codegen/jni/CMakeLists.txt",
        cxxModuleCMakeListsModuleName: "gf-engine",
        cxxModuleCMakeListsPath: "CMakeLists.txt",
        cxxModuleHeaderName: "NativeGfEngineModule",
      },
    },
  },
};
