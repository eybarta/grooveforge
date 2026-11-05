import { Stack } from "expo-router";

const BG = "#07060B";

export default function RootLayout() {
  return (
    <Stack
      screenOptions={{
        contentStyle: { backgroundColor: BG },
        headerStyle: { backgroundColor: BG },
        headerTintColor: "#fff",
      }}
    />
  );
}
