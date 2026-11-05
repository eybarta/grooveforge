/** Web: downloads the WAV. */
export async function saveWav(bytes: Uint8Array, name: string): Promise<string> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "audio/wav" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return name;
}
