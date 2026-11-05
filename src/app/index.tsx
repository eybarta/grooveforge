import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

export default function Index() {
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
