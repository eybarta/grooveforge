import type { SkFont } from "@shopify/react-native-skia";

/**
 * Text width by glyph advances (Skia's measureText gives ink bounds: a space measures 0). A module-level worklet
 * with a plain loop: inline callbacks inside a component's worklet get hoisted by the React Compiler into plain JS
 * functions, which the UI thread can't call.
 */
export function advance(font: SkFont, text: string) {
  "worklet";
  const widths = font.getGlyphWidths(font.getGlyphIDs(text));
  let w = 0;
  for (let i = 0; i < widths.length; i++) w += widths[i]!;
  return w;
}
