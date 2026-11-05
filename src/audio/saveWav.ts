import { File, Paths } from "expo-file-system";
import { shareAsync } from "expo-sharing";

/** Native: writes to the app's documents and opens the share sheet so the WAV can be AirDropped / inspected. */
export async function saveWav(bytes: Uint8Array, name: string): Promise<string> {
  const file = new File(Paths.document, name);
  if (file.exists) file.delete();
  await file.write(bytes);
  await shareAsync(file.uri, { mimeType: "audio/wav", UTI: "com.microsoft.waveform-audio" });
  return file.uri;
}
