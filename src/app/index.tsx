import { Link, Redirect } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

// dev hook: `EXPO_PUBLIC_SPIKE_AUTO=render npx expo start` opens the spike and runs the offline render headlessly
const SPIKE_AUTO = process.env.EXPO_PUBLIC_SPIKE_AUTO;

export default function Index() {
  if (SPIKE_AUTO) return <Redirect href={{ pathname: "/spike", params: { auto: SPIKE_AUTO } }} />;
  return (
    <View style={styles.container}>
      <Text style={styles.title}>GrooveForge 2.0</Text>
      <Link href="/spike" style={styles.link} accessibilityRole="button">
        Audio spike →
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center", gap: 24 },
  title: { color: "#fff", fontSize: 24, fontWeight: "700" },
  link: { color: "#00E5FF", fontSize: 18, padding: 12, minHeight: 44 },
});
