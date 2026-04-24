import { AppLanguage } from "@/lib/i18n";

// English-only mode. Icelandic translations are parked per V3 scope;
// `pickLanguage` call sites always see "en". See language-provider.tsx
// for the parallel client-side force and instructions to restore
// bilingual mode when Sprint 3 lights up Auðkenni.
export async function getServerLanguage(): Promise<AppLanguage> {
  return "en";
}
