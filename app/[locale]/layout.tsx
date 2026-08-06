import {NextIntlClientProvider} from 'next-intl';
import { getMessages } from 'next-intl/server';
import {notFound} from 'next/navigation';
import {routing} from '@/utils/routing';
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./../globals.css";


const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export async function generateMetadata({ params }: { params: { locale: string } }): Promise<Metadata> {
  const { locale } = params;
  if (!routing.locales.includes(locale as any)) {
    return {
      metadataBase: new URL(siteUrl),
      title: "",
    } as Metadata;
  }

  const messages = (await import(`../../messages/${locale}.json`)).default;
  const siteName = messages.Metadata?.siteName || "Video Downloader";
  const siteDescription = messages.Metadata?.siteDescription || "Download and share videos from YouTube, Facebook, Twitch, X and direct links.";
  const localeCode = locale === "es" ? "es_ES" : locale === "ar" ? "ar_AR" : "en_US";

  return {
    metadataBase: new URL(siteUrl),
    applicationName: siteName,
    title: {
      default: `${siteName}${messages.Metadata?.titleSuffix ? messages.Metadata.titleSuffix : ""}`,
      template: `%s | ${siteName}`,
    },
    description: siteDescription,
    keywords: messages.Metadata?.keywords || [],
    authors: messages.Metadata?.authors || [{ name: siteName }],
    creator: messages.Metadata?.creator || siteName,
    publisher: messages.Metadata?.publisher || siteName,
    category: messages.Metadata?.category || "tools",
    alternates: {
      canonical: "/",
    },
    openGraph: {
      type: "website",
      url: "/",
      title: siteName,
      siteName,
      description: siteDescription,
      locale: localeCode,
      images: [
        {
          url: "/og-image.svg",
          width: 1200,
          height: 630,
          alt: siteName,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      site: "@",
      creator: "@",
      title: siteName,
      description: siteDescription,
      images: ["/og-image.svg"],
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    },
    icons: {
      icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
    },
    manifest: "/site.webmanifest",
  };
}

export default async function LocaleLayout({
                                             children,
                                             params
                                           }: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as any)) {
    notFound();
  }
  // Providing all messages to the client
  // side is the easiest way to get started
  const messages = await getMessages();
  const siteName = messages.Metadata?.siteName || "Video Downloader";
  const siteDescription = messages.Metadata?.siteDescription || "Download and share videos from YouTube, Facebook, Twitch, X and direct links.";

  return (
      <html lang={locale}>
      <head>
        <script
            type="application/ld+json"
            // JSON-LD para SEO (WebSite + WebApplication)
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "WebSite",
                name: siteName,
                url: siteUrl,
                description: siteDescription,
                inLanguage: {locale},
                potentialAction: {
                  "@type": "SearchAction",
                  target: `${siteUrl}/?q={query}`,
                  "query-input": "required name=query",
                },
              }),
            }}
        />
        <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{
              __html: JSON.stringify({
                "@context": "https://schema.org",
                "@type": "WebApplication",
                name: siteName,
                applicationCategory: "UtilitiesApplication",
                operatingSystem: "Any",
                url: siteUrl,
                description: siteDescription,
                offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
              }),
            }}
        />
      </head>
      <body
          className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
      <NextIntlClientProvider messages={messages}>
        {children}
      </NextIntlClientProvider>
      </body>
      </html>
  );
}
