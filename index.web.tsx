// Web entry: Skia draws through CanvasKit (WASM), which must load before any screen renders. Skia's Expo Router
// recipe (docs/getting-started/web.mdx @ v2.14.0); `npm install` copies canvaskit.wasm to public/ (postinstall).
import "@expo/metro-runtime"; // first, for Fast Refresh on web
import { LoadSkiaWeb } from "@shopify/react-native-skia/lib/module/web";
import { App } from "expo-router/build/qualified-entry";
import { renderRootComponent } from "expo-router/build/renderRootComponent";

LoadSkiaWeb({ locateFile: (file: string) => `/${file}` }).then(() => renderRootComponent(App));
