import { Stack } from "expo-router";
import { Text, View } from "react-native";
import { useEngine } from "@/audio/useEngine";
import { useStudio } from "@/audio/useStudio";
import { StudioView } from "@/ui/studio/StudioView";
import { color, type } from "@/ui/theme";

/** The Studio on its own (deep link grooveforge://studio); after a take it's reached through the forge instead. */
export default function Studio() {
  const { audio, error } = useEngine();
  const st = useStudio(audio);
  return (
    <View style={{ flex: 1, backgroundColor: color.ground }}>
      <Stack.Screen options={{ headerShown: false }} />
      <StudioView st={st} />
      {error && <Text style={[type.body, { color: color.magenta, padding: 16 }]}>{error}</Text>}
    </View>
  );
}
