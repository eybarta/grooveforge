#include "NativeGfEngineModule.h"

#include <utility>

#include "GfEngineNode.h"

namespace facebook::react {

NativeGfEngineModule::NativeGfEngineModule(std::shared_ptr<CallInvoker> jsInvoker)
    : NativeGfEngineModuleCxxSpec(std::move(jsInvoker)) {}

bool NativeGfEngineModule::install(jsi::Runtime &runtime) {
  // __gfCreateEngineNode(context, captureSeconds) → GfEngineNode host object (works for live and offline contexts)
  runtime.global().setProperty(
      runtime, "__gfCreateEngineNode",
      jsi::Function::createFromHostFunction(
          runtime, jsi::PropNameID::forAscii(runtime, "__gfCreateEngineNode"), 2,
          [](jsi::Runtime &rt, const jsi::Value &, const jsi::Value *args, size_t count) -> jsi::Value {
            if (count < 2) throw jsi::JSError(rt, "[gf-engine] __gfCreateEngineNode(context, captureSeconds)");
            auto context = args[0].asObject(rt).getHostObject<audioapi::BaseAudioContextHostObject>(rt);
            if (!context) throw jsi::JSError(rt, "[gf-engine] first argument is not an AudioContext");
            auto node = std::make_shared<gf::GfEngineNodeHostObject>(context->getContext(),
                                                                     static_cast<int>(args[1].asNumber()));
            auto object = jsi::Object::createFromHostObject(rt, node);
            object.setExternalMemoryPressure(rt, node->getMemoryPressure());
            return object;
          }));
  return true;
}

}  // namespace facebook::react
