import { type ComponentRef, type ReactNode, type Ref, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle, useReducedMotion, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { routeName, useCalibration } from "@/audio/calibration";
import { outputLatency } from "@/audio/latency";
import { LOUDNESS_TARGETS } from "@/audio/master";
import type { AudioEngine } from "@/audio/types";
import type { useStudio } from "@/audio/useStudio";
import { barCells, barUnsure, toggleStep } from "@/song/grid";
import { loopSeconds } from "@/song/time";
import { Button, Chip, Glass, PlayButton } from "../controls";
import { FLOW } from "../forge/flow";
import { Knob } from "../Knob";
import { spring } from "../motion";
import { StepGrid } from "../StepGrid";
import { color, space, type } from "../theme";
import { usePlayhead } from "../usePlayhead";

export const STUDIO_LANES = ["kick", "snare", "hatClosed", "hatOpen", "perc", "bass"] as const;
const SWING_MIN = 0.5, SWING_RANGE = 0.25; // straight … heavy swing
const pct = (v: number) => `${Math.round(v * 100)}`;

/** While the forge plays (src/ui/forge/flow.ts): its clock, when each cell's dot lands, and the beam sweep. */
export interface ForgeIn { t: SharedValue<number>; land: number[][]; pos: SharedValue<number> }

/**
 * The Studio (docs/design/3-studio.dc.html): the song as a live grid, the mood, the macro knobs, export. During the
 * forge, the grid panel rises in and fills as dots land, then the rest rises in around it.
 */
export function StudioView({ st, forge, gridRef, footer }: {
  st: ReturnType<typeof useStudio>; forge?: ForgeIn; gridRef?: Ref<ComponentRef<typeof View>>; footer?: ReactNode;
}) {
  const { song } = st;
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const rtlMs = useCalibration((c) => c.rtlMs);
  const route = routeName(useCalibration((c) => c.route));
  const [bar, setBar] = useState(0);
  const shownBar = forge ? 0 : Math.min(bar, song.bars - 1);
  const latency = st.audio ? outputLatency(st.audio.reportedLatency(), rtlMs, st.audio.sampleRate) : null;
  const grid = {
    lanes: STUDIO_LANES, cells: barCells(song, shownBar, STUDIO_LANES), unsure: barUnsure(song, shownBar, STUDIO_LANES), bar: shownBar, bars: song.bars, loopSeconds: loopSeconds(song),
    reduceMotion, canvasRef: gridRef, onToggle: (row: number, step: number) => st.editSong(toggleStep(song, STUDIO_LANES[row]!, shownBar, step)),
  };

  return (
    <ScrollView style={s.screen} scrollEnabled={!forge} pointerEvents={forge ? "none" : "auto"}
      contentContainerStyle={[s.page, { paddingTop: insets.top + space.pageTop, paddingBottom: insets.bottom + space.pageBottom }]}>
      <Rise forge={forge} at={FLOW.chrome[0]} style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={[type.title, { color: color.text }]}>{song.id.startsWith("take-") ? "Your beat" : song.mood === "trap" ? "Trap demo" : "Boom Bap demo"}</Text>
          <Text style={[type.stat, s.muted]}>
            {song.bpm} BPM · swing {pct(song.swing)}% · {LOUDNESS_TARGETS[st.target]} LUFS
          </Text>
        </View>
        <PlayButton playing={st.playing || st.mouth} onPress={st.toggle} disabled={!st.audio || st.busy === "calibrate"} />
      </Rise>

      <Rise forge={forge} at={FLOW.chrome[1]} style={s.row}>
        <Chip label="Boom Bap" selected={song.mood === "boomBap"} onPress={() => st.setMood("boomBap")} />
        <Chip label="Trap" selected={song.mood === "trap"} onPress={() => st.setMood("trap")} />
        <View style={{ flex: 1 }} />
        {song.bars > 1 && Array.from({ length: song.bars }, (_, b) => (
          <Chip key={b} label={`${b + 1}`} selected={b === shownBar} onPress={() => setBar(b)} accent={color.cyan} />
        ))}
      </Rise>

      <Rise forge={forge} at={FLOW.gridIn} w={12}>
        <Glass style={s.grid}>
          {forge ? <StepGrid {...grid} pos={forge.pos} reveal={forge} />
            : st.audio && latency ? <LiveGrid audio={st.audio} latencyFrames={latency.frames} {...grid} />
              : <IdleGrid {...grid} />}
        </Glass>
        {grid.unsure.some((row) => row.some(Boolean)) && (
          <Text style={[type.stat, s.muted]}>Amber <Text style={{ color: "#FFB020" }}>?</Text> = not sure what you played. Tap to fix.</Text>
        )}
      </Rise>

      <Rise forge={forge} at={FLOW.chrome[2]} style={{ gap: space.gap }}>
        <Pressable accessibilityRole="button" onPress={st.runCalibration} disabled={!st.audio || st.busy !== null}
          accessibilityLabel={latency?.calibrated ? "Recalibrate sync" : "Calibrate sync"} style={s.sync}>
          <Text style={[type.stat, s.muted]}>
            {st.busy === "calibrate" ? "Listening for clicks… keep it quiet"
              : latency?.calibrated ? `Sync ${Math.round((latency.frames / st.audio!.sampleRate) * 1000)} ms on ${route} · measured · tap to redo`
                : `Sync not measured on ${route} yet · tap to calibrate`}
          </Text>
        </Pressable>
        <View style={s.knobs}>
          <Knob label="Quantize" value={song.quantize} accent={color.cyan} onChange={(v) => st.editSong({ ...song, quantize: v })} format={pct} />
          <Knob label="Swing" value={(song.swing - SWING_MIN) / SWING_RANGE} accent={color.magenta}
            onChange={(v) => st.editSong({ ...song, swing: SWING_MIN + v * SWING_RANGE })} format={(v) => pct(SWING_MIN + v * SWING_RANGE)} />
          <Knob label="Humanize" value={0} onChange={() => {}} accent={color.lime} format={() => "–"} disabled />
        </View>
        <View style={s.knobs}>
          <Knob label="Punch" value={st.knobs.punch} onChange={(v) => st.setKnob("punch", v)} accent="#FF5A1F" format={pct} />
          <Knob label="Space" value={st.knobs.space} onChange={(v) => st.setKnob("space", v)} accent="#8B5CFF" format={pct} />
          <Knob label="Loudness" value={st.target === "loud" ? 1 : 0} steps={2} accent="#FFB020"
            onChange={(v) => st.setTarget(v >= 0.5 ? "loud" : "streaming")} format={(v) => (v >= 0.5 ? "Loud" : "Stream")} />
        </View>
      </Rise>

      <Rise forge={forge} at={FLOW.chrome[3]} style={s.row}>
        <View style={{ flex: 1 }}>
          <Button label={st.mouth ? "Back to Studio" : "Your mouth ⇄ Studio"} onPress={st.compare} disabled={!st.audio || !st.canCompare || st.busy !== null}
            accessibilityLabel={!st.canCompare ? "Compare with your recording (after you record a take)" : st.mouth ? "Playing your recording. Switch to the Studio" : "Hear your recording instead"} />
        </View>
        <Button label={st.busy === "export" ? "Mastering…" : "Export"} variant="primary" onPress={st.exportWav}
          disabled={!st.audio || st.busy !== null} accessibilityLabel="Export WAV, 8 bars" />
      </Rise>
      {st.status ? <Text style={[type.stat, s.muted]}>{st.status}</Text> : null}
      {footer}
    </ScrollView>
  );
}

/** A block that rises into place at forge time `at` (spring ω `w`, ζ 0.85); without a forge it just sits there. */
function Rise({ forge, at, w = 14, style, children }: { forge?: ForgeIn; at: number; w?: number; style?: object; children: ReactNode }) {
  const t = forge?.t;
  const anim = useAnimatedStyle(() => {
    if (!t) return { opacity: 1, transform: [{ translateY: 0 }] };
    const u = spring(t.value - at, w, 0.85);
    return { opacity: Math.min(1, Math.max(0, u)), transform: [{ translateY: 24 * (1 - u) }] };
  });
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

type GridProps = Omit<Parameters<typeof StepGrid>[0], "pos">;

function LiveGrid({ audio, latencyFrames, ...grid }: GridProps & { audio: AudioEngine; latencyFrames: number }) {
  const { pos } = usePlayhead(audio.clock, latencyFrames, audio.sampleRate, (stats) => console.log("[studio]", JSON.stringify({ step: "clock", ...stats })));
  return <StepGrid {...grid} pos={pos} />;
}

function IdleGrid(grid: GridProps) {
  const pos = useSharedValue(-1);
  return <StepGrid {...grid} pos={pos} />;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  page: { paddingHorizontal: space.page, gap: space.gap, width: "100%", maxWidth: 520, alignSelf: "center" }, // phone-sized on desktop web
  header: { flexDirection: "row", alignItems: "center", gap: space.row },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  grid: { paddingVertical: 12, paddingHorizontal: 10 },
  sync: { minHeight: 44, justifyContent: "center", marginTop: -10, marginBottom: -6 },
  knobs: { flexDirection: "row", gap: space.row },
  muted: { color: color.muted, marginTop: 4 },
});
