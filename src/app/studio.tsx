import { Stack } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useReducedMotion, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCalibration } from "@/audio/calibration";
import { outputLatency } from "@/audio/latency";
import { LOUDNESS_TARGETS } from "@/audio/master";
import type { AudioEngine } from "@/audio/types";
import { useStudio } from "@/audio/useStudio";
import { barCells, toggleStep } from "@/song/grid";
import { loopSeconds } from "@/song/time";
import { Button, Chip, Glass, PlayButton } from "@/ui/controls";
import { Knob } from "@/ui/Knob";
import { StepGrid } from "@/ui/StepGrid";
import { color, space, type } from "@/ui/theme";
import { usePlayhead } from "@/ui/usePlayhead";

const LANES = ["kick", "snare", "hatClosed", "hatOpen", "perc", "bass"] as const;
const SWING_MIN = 0.5, SWING_RANGE = 0.25; // straight … heavy swing
const pct = (v: number) => `${Math.round(v * 100)}`;

/** The Studio (docs/design/3-studio.dc.html): the song as a live grid, the mood, the macro knobs, export. */
export default function Studio() {
  const st = useStudio();
  const { song } = st;
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const rtlMs = useCalibration((c) => c.rtlMs);
  const [bar, setBar] = useState(0);
  const shownBar = Math.min(bar, song.bars - 1);
  const latency = st.audio ? outputLatency(st.audio.reportedLatency(), rtlMs, st.audio.sampleRate) : null;
  const grid = {
    lanes: LANES, cells: barCells(song, shownBar, LANES), bar: shownBar, bars: song.bars, loopSeconds: loopSeconds(song),
    reduceMotion, onToggle: (row: number, step: number) => st.editSong(toggleStep(song, LANES[row]!, shownBar, step)),
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={[s.page, { paddingTop: insets.top + space.pageTop, paddingBottom: insets.bottom + space.pageBottom }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={[type.title, { color: color.text }]}>{song.mood === "trap" ? "Trap demo" : "Boom Bap demo"}</Text>
          <Text style={[type.stat, s.muted]}>
            {song.bpm} BPM · swing {pct(song.swing)}% · {LOUDNESS_TARGETS[st.target]} LUFS
          </Text>
        </View>
        <PlayButton playing={st.playing} onPress={st.toggle} disabled={!st.audio || st.busy === "calibrate"} />
      </View>

      <View style={s.row}>
        <Chip label="Boom Bap" selected={song.mood === "boomBap"} onPress={() => st.setMood("boomBap")} />
        <Chip label="Trap" selected={song.mood === "trap"} onPress={() => st.setMood("trap")} />
        <View style={{ flex: 1 }} />
        {song.bars > 1 && Array.from({ length: song.bars }, (_, b) => (
          <Chip key={b} label={`${b + 1}`} selected={b === shownBar} onPress={() => setBar(b)} accent={color.cyan} />
        ))}
      </View>

      <Glass style={s.grid}>
        {st.audio && latency
          ? <LiveGrid audio={st.audio} latencyFrames={latency.frames} {...grid} />
          : <IdleGrid {...grid} />}
      </Glass>
      <Pressable accessibilityRole="button" onPress={st.runCalibration} disabled={!st.audio || st.busy !== null}
        accessibilityLabel={latency?.calibrated ? "Recalibrate sync" : "Calibrate sync"} style={s.sync}>
        <Text style={[type.stat, s.muted]}>
          {st.busy === "calibrate" ? "Listening for clicks… keep it quiet"
            : latency?.calibrated ? `Sync ${Math.round((latency.frames / st.audio!.sampleRate) * 1000)} ms · measured · tap to redo`
              : "Sync not measured yet · tap to calibrate"}
        </Text>
      </Pressable>

      <View style={s.knobs}>
        <Knob label="Quantize" value={0} onChange={() => {}} accent={color.cyan} format={() => "–"} disabled />
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

      <View style={s.row}>
        <View style={{ flex: 1 }}>
          <Button label="Your mouth ⇄ Studio" onPress={() => {}} disabled accessibilityLabel="Compare with your recording (after you record a take)" />
        </View>
        <Button label={st.busy === "export" ? "Mastering…" : "Export"} variant="primary" onPress={st.exportWav}
          disabled={!st.audio || st.busy !== null} accessibilityLabel="Export WAV, 8 bars" />
      </View>
      {st.status ? <Text style={[type.stat, s.muted]}>{st.status}</Text> : null}
    </ScrollView>
  );
}

type GridProps = Omit<Parameters<typeof import("@/ui/StepGrid").StepGrid>[0], "pos">;

function LiveGrid({ audio, latencyFrames, ...grid }: GridProps & { audio: AudioEngine; latencyFrames: number }) {
  const pos = usePlayhead(audio.clock, latencyFrames, audio.sampleRate, (stats) => console.log("[studio]", JSON.stringify({ step: "clock", ...stats })));
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
