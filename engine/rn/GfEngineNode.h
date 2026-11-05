#pragma once
// gf::Engine as a react-native-audio-api AudioNode (iOS + Android). Only StableAPI.h from audio-api, per its
// EXTENSION_API.md contract.
#include <audioapi/compatibility/StableAPI.h>
#include <jsi/jsi.h>

#include <cstring>
#include <memory>

#include "gf/Engine.h"

namespace gf {

using namespace facebook;

class GfEngineNode : public audioapi::AudioNode {
 public:
  GfEngineNode(const std::shared_ptr<audioapi::BaseAudioContext> &context, int captureSeconds)
      : audioapi::AudioNode(context, options()), engine_(context->getSampleRate(), captureSeconds) {}

  Engine &engine() { return engine_; }

  /** Mono in (mic, downmixed by the graph), mono out (upmixed by the destination). */
  static audioapi::AudioNodeOptions options() {
    audioapi::AudioNodeOptions o;
    o.channelCount = 1;
    o.channelCountMode = audioapi::ChannelCountMode::EXPLICIT;
    return o;
  }

 protected:
  // audio-api processes in place: the negotiated input buffer is also the output buffer.
  void processNode(int frames) override {
    auto buffer = getOutputBuffer();
    const size_t channels = buffer->getNumberOfChannels();
    if (channels == 0) return;
    float *x = buffer->getChannel(0)->begin();
    engine_.process(x, x, frames);
    for (size_t c = 1; c < channels; ++c) std::memcpy(buffer->getChannel(c)->begin(), x, frames * sizeof(float));
  }

 private:
  Engine engine_;
};

class GfEngineNodeHostObject : public audioapi::AudioNodeHostObject {
 public:
  GfEngineNodeHostObject(const std::shared_ptr<audioapi::BaseAudioContext> &context, int captureSeconds)
      : GfEngineNodeHostObject(context->getGraph(), new GfEngineNode(context, captureSeconds)) {}

  JSI_HOST_FUNCTION_DECL(setEvents) {
    auto buffer = args[0].asObject(runtime).getArrayBuffer(runtime);
    const int rows = static_cast<int>(buffer.size(runtime) / (kEventStride * sizeof(float)));
    const bool ok = engine_->setEvents(reinterpret_cast<const float *>(buffer.data(runtime)), rows,
                                       static_cast<int64_t>(args[1].asNumber()));
    return jsi::Value(ok);
  }
  JSI_HOST_FUNCTION_DECL(play) { engine_->play(); return jsi::Value::undefined(); }
  JSI_HOST_FUNCTION_DECL(stop) { engine_->stop(); return jsi::Value::undefined(); }
  JSI_HOST_FUNCTION_DECL(setDrive) {
    engine_->setDrive(static_cast<float>(args[0].asNumber()));
    return jsi::Value::undefined();
  }
  JSI_HOST_FUNCTION_DECL(captureStart) { engine_->startCapture(); return jsi::Value::undefined(); }
  JSI_HOST_FUNCTION_DECL(captureStop) {
    engine_->stopCapture();
    const int n = engine_->captured();
    jsi::Object result(runtime);
    result.setProperty(runtime, "input", copy(runtime, engine_->captureIn(), n));
    result.setProperty(runtime, "output", copy(runtime, engine_->captureOut(), n));
    return result;
  }

 private:
  // The graph owns the node; it lives as long as this HostObject, so the raw engine pointer stays valid.
  GfEngineNodeHostObject(const std::shared_ptr<audioapi::utils::graph::Graph> &graph, GfEngineNode *node)
      : audioapi::AudioNodeHostObject(graph, std::unique_ptr<audioapi::AudioNode>(node), GfEngineNode::options()),
        engine_(&node->engine()) {
    addFunctions(JSI_EXPORT_FUNCTION(GfEngineNodeHostObject, setEvents),
                 JSI_EXPORT_FUNCTION(GfEngineNodeHostObject, play),
                 JSI_EXPORT_FUNCTION(GfEngineNodeHostObject, stop),
                 JSI_EXPORT_FUNCTION(GfEngineNodeHostObject, setDrive),
                 JSI_EXPORT_FUNCTION(GfEngineNodeHostObject, captureStart),
                 JSI_EXPORT_FUNCTION(GfEngineNodeHostObject, captureStop));
  }

  static jsi::Value copy(jsi::Runtime &rt, const float *src, int n) {
    auto object = rt.global().getPropertyAsFunction(rt, "ArrayBuffer").callAsConstructor(rt, n * 4).asObject(rt);
    std::memcpy(object.getArrayBuffer(rt).data(rt), src, static_cast<size_t>(n) * sizeof(float));
    return object;
  }

  Engine *engine_;
};

}  // namespace gf
