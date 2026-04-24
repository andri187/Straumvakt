import type { Metadata } from "next";
import { LanguageProvider } from "@/components/language-provider";
import { getServerLanguage } from "@/lib/server-i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Straumvakt",
    template: "%s · Straumvakt",
  },
  description:
    "Straumvakt — charging operating platform. Control · Overview · Convenience.",
  applicationName: "Straumvakt",
  icons: {
    icon: "/icon.svg",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const language = await getServerLanguage();

  return (
    <html lang={language}>
      <body>
        <LanguageProvider initialLanguage={language}>
          {children}
        </LanguageProvider>
      </body>
    </html>
  );
}
