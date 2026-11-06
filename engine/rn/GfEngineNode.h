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

  /** Stereo: the mic (mono, upmixed by the graph) arrives on channel 0; the engine writes L/R to channels 0/1. */
  static audioapi::AudioNodeOptions options() {
    audioapi::AudioNodeOptions o;
    o.channelCount = 2;
    o.channelCountMode = audioapi::ChannelCountMode::EXPLICIT;
    return o;
  }

 protected:
  // audio-api processes in place: the negotiated input buffer is also the output buffer.
  void processNode(int frames) override {
    auto buffer = getOutputBuffer();
    const size_t channels = buffer->getNumberOfChannels();
    if (channels < 2) return;
    float *l = buffer->getChannel(0)->begin();
    engine_.process(l, l, buffer->getChannel(1)->begin(), frames);  // the engine reads mic[i] before writing l[i]
  }

 private:
  Engine engine_;
};

/**
 * Read-only view of the engine clock for the UI thread. A worklet that captures this object gets the same C++
 * instance re-wrapped on the UI runtime, so every `frame` read is a direct atomic load (no JS thread, no locks).
 */
class GfClockHostObject : public jsi::HostObject {
 public:
  explicit GfClockHostObject(std::shared_ptr<const Clock> clock) : clock_(std::move(clock)) {}

  jsi::Value get(jsi::Runtime &rt, const jsi::PropNameID &name) override {
    const auto prop = name.utf8(rt);
    if (prop == "frame") return jsi::Value(static_cast<double>(clock_->frame.load(std::memory_order_relaxed)));
    if (prop == "loopFrames") return jsi::Value(static_cast<double>(clock_->loopFrames.load(std::memory_order_relaxed)));
    if (prop == "playing") return jsi::Value(clock_->playing.load(std::memory_order_relaxed));
    return jsi::Value::undefined();
  }

  std::vector<jsi::PropNameID> getPropertyNames(jsi::Runtime &rt) override {
    return jsi::PropNameID::names(rt, "frame", "loopFrames", "playing");
  }

 private:
  std::shared_ptr<const Clock> clock_;
};

class GfEngineNodeHostObject : public audioapi::AudioNodeHostObject {
 public:
  GfEngineNodeHostObject(const std::shared_ptr<audioapi::BaseAudioContext> &context, int captureSeconds)
      : GfEngineNodeHostObject(context->getGraph(), new GfEngineNode(context, captureSeconds)) {}

  JSI_HOST_FUNCTION_DECL(setEvents) {
    auto buffer = args[0].asObject(runtime).getArrayBuffer(runtime);
    const int rows = static_cast<int>(buffer.size(runtime) / (kEventStride * sizeof(float)));
    engine_->setEvents(reinterpret_cast<const float *>(buffer.data(runtime)), rows,
                       static_cast<int64_t>(args[1].asNumber()));
    return jsi::Value::undefined();
  }
  JSI_HOST_FUNCTION_DECL(setInstruments) {
    auto buffer = args[0].asObject(runtime).getArrayBuffer(runtime);
    const int count = static_cast<int>(buffer.size(runtime) / (kInstrumentStride * sizeof(float)));
    engine_->setInstruments(reinterpret_cast<const float *>(buffer.data(runtime)), count);
    return jsi::Value::undefined();
  }
  JSI_HOST_FUNCTION_DECL(play) { engine_->play(); return jsi::Value::undefined(); }
  JSI_HOST_FUNCTION_DECL(stop) { engine_->stop(); return jsi::Value::undefined(); }
  JSI_HOST_FUNCTION_DECL(setDrive) {
    engine_->setDrive(static_cast<float>(args[0].asNumber()));
    return jsi::Value::undefined();
  }
  JSI_HOST_FUNCTION_DECL(clock) {
    return jsi::Object::createFromHostObject(runtime, std::make_shared<GfClockHostObject>(engine_->clock()));
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
                 JSI_EXPORT_FUNCTION(GfEngineNodeHostObject, setInstruments),
                 JSI_EXPORT_FUNCTION(GfEngineNodeHostObject, play),
                 JSI_EXPORT_FUNCTION(GfEngineNodeHostObject, stop),
                 JSI_EXPORT_FUNCTION(GfEngineNodeHostObject, setDrive),
                 JSI_EXPORT_FUNCTION(GfEngineNodeHostObject, clock),
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
