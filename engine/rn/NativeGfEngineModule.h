#pragma once
// Pure C++ TurboModule whose only job is to install the JSI factory for GfEngineNode
// (same pattern as react-native-audio-worklets). Generated from engine/js/specs/NativeGfEngineModule.ts.
#include <gfengineJSI.h>
#include <jsi/jsi.h>

#include <memory>

namespace facebook::react {

class NativeGfEngineModule : public NativeGfEngineModuleCxxSpec<NativeGfEngineModule> {
 public:
  explicit NativeGfEngineModule(std::shared_ptr<CallInvoker> jsInvoker);
  bool install(jsi::Runtime &runtime);
};

}  // namespace facebook::react
