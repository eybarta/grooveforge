import { Figtree_400Regular } from "@expo-google-fonts/figtree/400Regular";
import { Figtree_500Medium } from "@expo-google-fonts/figtree/500Medium";
import { Figtree_600SemiBold } from "@expo-google-fonts/figtree/600SemiBold";
import { JetBrainsMono_500Medium } from "@expo-google-fonts/jetbrains-mono/500Medium";
import { Unbounded_700Bold } from "@expo-google-fonts/unbounded/700Bold";
import { Unbounded_800ExtraBold } from "@expo-google-fonts/unbounded/800ExtraBold";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { color } from "@/ui/theme";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  // only the weights the design uses (src/ui/theme.ts `font`); a failed load falls back to system fonts
  const [loaded, error] = useFonts({
    Unbounded_700Bold, Unbounded_800ExtraBold, Figtree_400Regular, Figtree_500Medium, Figtree_600SemiBold,
    JetBrainsMono_500Medium,
  });
  useEffect(() => {
    if (loaded || error) void SplashScreen.hideAsync();
  }, [loaded, error]);
  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: color.ground },
          headerStyle: { backgroundColor: color.ground },
          headerTintColor: color.text,
        }}
      />
    </GestureHandlerRootView>
  );
}
