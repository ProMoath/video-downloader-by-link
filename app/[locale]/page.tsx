"use client"

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";

// TypeScript declaration for Instagram embed
declare global {
  interface Window {
    instgrm?: {
      Embeds?: {
        process: () => void;
      };
    };
  }
}

// Instagram embed script URL constant
const INSTAGRAM_EMBED_SCRIPT_URL = "https://www.instagram.com/embed.js" as const;

export default function Page() {
  const [theme, setTheme] = useState<"light" | "dark" | "system">("system");
  const [url, setUrl] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [provider, setProvider] = useState<"youtube" | "direct" | "facebook" | "x" | "twitch" | "instagram" | "unknown" | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const embedContainerRef = useRef<HTMLDivElement | null>(null);
  const [downloadable, setDownloadable] = useState(false);
  const [isHls, setIsHls] = useState(false);
  const [embedHtml, setEmbedHtml] = useState<string | null>(null);
  const [embedFailed, setEmbedFailed] = useState(false);

  const t = useTranslations('HomePage');
  const er = useTranslations('Errors');
  
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // initialize theme from localStorage or system
  useEffect(() => {
    try {
      const saved = localStorage.getItem("vd_theme");
      if (saved === "light" || saved === "dark" || saved === "system") {
        const themeVal = saved as "light" | "dark" | "system";
        setTheme(themeVal);
        applyTheme(themeVal);
      } else {
        setTheme("system");
        applyTheme("system");
      }
    } catch {
      setTheme("system");
    }
  }, []);

  // Load Instagram embed script when Instagram embed is present
  useEffect(() => {
    if (provider === "instagram" && embedHtml) {
      // Load Instagram embed script if not already loaded
      if (!document.querySelector(`script[src="${INSTAGRAM_EMBED_SCRIPT_URL}"]`)) {
        const script = document.createElement("script");
        script.src = INSTAGRAM_EMBED_SCRIPT_URL;
        script.async = true;
        document.body.appendChild(script);
        script.onload = () => {
          // Process embeds after script loads
          if (window.instgrm?.Embeds?.process) {
            window.instgrm.Embeds.process();
          }
        };
      } else {
        // Script already loaded, just process embeds
        setTimeout(() => {
          if (window.instgrm?.Embeds?.process) {
            window.instgrm.Embeds.process();
          }
        }, 100);
      }
    }
  }, [provider, embedHtml]);

  // Detect when embeds fail to render (common with third-party cookie blocking / tracking protection).
  useEffect(() => {
    setEmbedFailed(false);
    if (!embedHtml) return;

    const t = window.setTimeout(() => {
      const root = embedContainerRef.current;
      if (!root) return;

      // If we don't see an iframe after a short delay, consider it a failed embed.
      // Instagram's embed.js injects an iframe inside the blockquote.
      const iframe = root.querySelector("iframe");
      if (!iframe) {
        setEmbedFailed(true);
        return;
      }

      // For Facebook, we often inject the iframe immediately.
      // For Instagram, presence of the iframe is a good enough signal.
      setEmbedFailed(false);
    }, 2500);

    return () => window.clearTimeout(t);
  }, [embedHtml, provider]);

  function applyTheme(t: "light" | "dark" | "system") {
    try {
      const el = document.documentElement;
      if (t === "system") {
        el.removeAttribute("data-theme");
      } else {
        el.setAttribute("data-theme", t);
      }
    } catch {
      // ignore
    }
  }

  function handleSetTheme(t: "light" | "dark" | "system", event: React.MouseEvent<HTMLButtonElement>) {
    setTheme(t);
    event.currentTarget.blur();
    try { localStorage.setItem("vd_theme", t); } catch { }
    applyTheme(t);
  }

  function validUrl(u: string) {
    try {
      // basic validation
      const parsed = new URL(u);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  async function parseApiError(res: Response) {
    const contentType = res.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        const data = await res.json();
        return {
          code: data?.error || data?.code,
          message: data?.message || res.statusText,
          status: data?.status || res.status,
        };
      } catch {
        // fall through to text parse
      }
    }
    const text = await res.text().catch(() => "");
    return { message: text || res.statusText || `HTTP ${res.status}`, status: res.status };
  }

  function mapDownloadError(error: { code?: string; message: string; status?: number }) {
    if (error.code === "invalid_url") return t('toastInvalidUrl');
    if (error.code === "youtube_id_error") return er('youtubeIdError');
    if (error.code === "youtube_live") return er('youtubeLiveError');
    if (error.code === "youtube_no_progressive") return er('youtubeNoProgressive');
    if (error.code === "youtube_download_error") return er('youtubeDownloadError', { message: error.message });
    if (error.code === "upstream_error") return er('upstreamError', { status: error.status || "" });
    return er('genericDownloadError');
  }

  function isApiError(err: unknown): err is { code?: string; message: string; status?: number } {
    if (typeof err !== 'object' || err === null) return false;
    const record = err as Record<string, unknown>;
    return 'message' in record && typeof record.message === 'string';
  }

  async function handlePreview(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!url.trim()) {
      setToast(t('toastEmptyUrl'));
      return;
    }
    if (!validUrl(url.trim())) {
      setToast(t('toastInvalidUrl'));
      return;
    }

    setLoadingPreview(true);
    setPreviewUrl(null);
    setProvider(null);
    setDownloadable(false);
    setIsHls(false);
    setEmbedHtml(null);
    setEmbedFailed(false);

    // small delay so loading UI is visible
    await new Promise((r) => setTimeout(r, 250));
    const cleaned = url.trim();
    try {
      const res = await fetch(`/api/resolve?url=${encodeURIComponent(cleaned)}`, { cache: "no-store" });
      if (!res.ok) throw new Error("resolve failed");
      const data: {
        provider: "youtube" | "facebook" | "twitch" | "x" | "instagram" | "direct" | "unknown";
        previewUrl: string | null;
        downloadable: boolean;
        isHls?: boolean;
        embedHtml?: string | null;
      } = await res.json();

      setProvider(data.provider);
      setPreviewUrl(data.previewUrl);
      setDownloadable(!!data.downloadable);
      setIsHls(!!data.isHls);
      setEmbedHtml(data.embedHtml || null);
      setEmbedFailed(false);

      // Para X/Twitter ahora usamos iframe oficial, no requiere widgets.js
    } catch (err) {
      console.error(err);
      setToast(er('resolveFailed'));
      setProvider("unknown");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function handleDownload() {
    if (!previewUrl && !url) return;
    // If not supported, do nothing (button should already be disabled)
    if (!downloadable || (provider === "direct" && isHls)) return;

    // Para YouTube enviamos la URL original; para otros usamos la previewUrl directa
    const srcForDownload = provider === "youtube" ? url : (previewUrl || url);
    if (!srcForDownload) return;

    // Utilizamos fetch para obtener el archivo como Blob y disparar la descarga sin abrir pestañas
    setDownloadLoading(true);
    setToast(t('toastDownloading'));

    function filenameFromContentDisposition(cd: string | null): string | null {
      if (!cd) return null;
      // filename*=UTF-8''...
      const star = cd.match(/filename\*=(?:UTF-8''|)([^;\r\n]+)/i);
      if (star && star[1]) {
        try { return decodeURIComponent(star[1].replace(/^"|"$/g, "")); } catch { }
      }
      const normal = cd.match(/filename=("?)([^";\r\n]+)\1/i);
      if (normal && normal[2]) return normal[2];
      return null;
    }

    try {
      const proxyUrl = `/api/download?url=${encodeURIComponent(srcForDownload)}`;
      const res = await fetch(proxyUrl, { method: "GET" });
      if (!res.ok) {
        const apiError = await parseApiError(res);
        throw apiError;
      }

      const blob = await res.blob();
      const cd = res.headers.get("content-disposition");
      const suggested = filenameFromContentDisposition(cd);
      const fallbackExt = provider === "youtube" ? ".mp4" : "";
      const fallbackName = (url.split("/").pop() || "video") + fallbackExt;
      const filename = (suggested || fallbackName).replace(/[\\/:*?"<>|]+/g, " ").trim();

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename || "video";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);

      setToast(t('toastDownloadStarted'));
    } catch (err: unknown) {
      console.error(err);
      const msg = isApiError(err)
        ? mapDownloadError(err)
        : (typeof err === 'object' && err !== null && 'message' in err && typeof (err as { message?: unknown }).message === 'string')
          ? (err as { message: string }).message
          : er('genericDownloadError');
      setToast(msg);
    } finally {
      setDownloadLoading(false);
    }
  }

  function handleClear() {
    try {
      // stop any playing video
      if (videoRef.current) {
        videoRef.current.pause();
      }
    } catch { }
    setUrl("");
    setPreviewUrl(null);
    setProvider(null);
    setDownloadable(false);
    setIsHls(false);
    setEmbedHtml(null);
    setLoadingPreview(false);
    setDownloadLoading(false);
    setToast(null);
  }

  async function handleShare() {
    if (!previewUrl) return;
    if (navigator.share) {
      try {
        await navigator.share({ title: t('shareTitle'), url });
        setToast(t('shareButton'));
      } catch {
        setToast(t('toastShareCanceled'));
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      setToast(t('toastClipboard'));
    } catch {
      // fallback: open new tab
      window.open(url, "_blank");
      setToast(t('toastClipboardFailed'));
    }
  }

  return (
    <main className="min-h-screen bg-app text-app flex items-center justify-center p-6">
      <div className="w-full max-w-3xl">
        <div className="card shadow-lg rounded-2xl p-6 sm:p-10">
          <h1 className="text-xl sm:text-2xl font-semibold text-app">{t('title')}</h1>
          <div className="mt-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
            <p className="text-sm muted">{t('description')}</p>
            <div className="sm:ml-4 inline-flex items-center gap-2">
              <span className="text-xs muted">{t('themeLabel')}</span>
              <div className={`segmented ${theme === "light" ? "pos-light" : theme === "system" ? "pos-system" : "pos-dark"}`} role="tablist" aria-label={t('themeLabel')}>
                <div className="knob" aria-hidden />
                <button type="button" onClick={(e) => handleSetTheme("light", e)} className={`option ${theme === "light" ? "active" : ""}`} aria-pressed={theme === "light"} aria-label={t('themeLight')} data-tooltip={t('themeTooltipLight')}>
                  {/* Sun icon */}
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M12 4V2M12 22v-2M4 12H2M22 12h-2M5 5l-1.5-1.5M20.5 20.5 19 19M5 19l-1.5 1.5M20.5 3.5 19 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button type="button" onClick={(e) => handleSetTheme("system", e)} className={`option ${theme === "system" ? "active" : ""}`} aria-pressed={theme === "system"} aria-label={t('themeSystem')} data-tooltip={t('themeTooltipSystem')}>
                  {/* Monitor/system icon */}
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <rect x="3" y="4" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M8 20h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
                <button type="button" onClick={(e) => handleSetTheme("dark", e)} className={`option ${theme === "dark" ? "active" : ""}`} aria-pressed={theme === "dark"} aria-label={t('themeDark')} data-tooltip={t('themeTooltipDark')}>
                  {/* Moon icon */}
                  <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
                    <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          <form onSubmit={handlePreview} className="mt-6">
            <label className="block text-sm font-medium text-app">{t('videoLinkLabel')}</label>
            <div className="mt-2 flex flex-col sm:flex-row gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t('placeholder')}
                className="w-full sm:flex-1 input"
                aria-label={t('videoLinkLabel')}
              />
              <button
                type="submit"
                disabled={loadingPreview || !url.trim()}
                className="w-full sm:w-auto btn-primary px-4 py-3 font-medium shadow-md focus:outline-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('previewButton')}
              </button>
              {(url.trim().length > 0 || !!previewUrl) && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="w-full sm:w-auto btn-ghost px-4 py-3 font-medium hover:shadow cursor-pointer"
                  aria-label={t('clearButton')}
                >
                  {t('clearButton')}
                </button>
              )}
            </div>
          </form>

          <div className="mt-6">
            {!previewUrl && !embedHtml && (
              <div className="rounded-lg p-6 text-center muted border border-dashed border-(--border)">
                <p>{t('emptyState')}</p>
                <p className="mt-3 text-sm">{t('emptyStateNote')}</p>
              </div>
            )}

            {loadingPreview && (
              <div className="mt-4 flex items-center justify-center">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 spinner"></div>
              </div>
            )}

            {(previewUrl || embedHtml) && !loadingPreview && (
              <div className="mt-4 space-y-4 fade-in">
                <div className="rounded-lg overflow-hidden preview-bg preview-container">
                  {embedHtml ? (
                    // Render embedHtml from oEmbed (Instagram/Facebook)
                    // Note: embedHtml comes from trusted oEmbed APIs (Instagram/Facebook) via our server-side resolver
                    // The URLs are validated to ensure they're from legitimate domains before fetching oEmbed
                    <div ref={embedContainerRef} className="preview-html-wrapper" dangerouslySetInnerHTML={{ __html: embedHtml }} />
                  ) : provider === "youtube" || provider === "facebook" || provider === "twitch" || provider === "x" ? (
                    <div className="preview-embed-wrapper">
                      <iframe
                        src={previewUrl || undefined}
                        title={t('embedPreviewTitle')}
                        className="preview-embed"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                        allowFullScreen
                      />
                    </div>
                  ) : previewUrl ? (
                    <div className="preview-embed-wrapper">
                      <video
                        ref={videoRef}
                        controls
                        src={previewUrl || undefined}
                        className="preview-video"
                      >
                            {t('videoNotSupported')}
                      </video>
                    </div>
                  ) : null}
                </div>

                {/* Fallback banner when embed cannot be rendered */}
                {embedHtml && (provider === "instagram" || provider === "facebook") && embedFailed && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="w-full border bg-(--warning-bg) text-(--warning-text) border-(--warning-border) rounded-lg py-2.5 px-3"
                  >
                    {provider === "instagram"
                      ? er('instagramEmbedFailed')
                      : er('facebookEmbedFailed')}
                  </div>
                )}

                {/* Warning banner when download is not supported */}
                {(!downloadable || (provider === "direct" && isHls)) && (
                  <div
                    role="alert"
                    aria-live="polite"
                    className="w-full border bg-(--warning-bg) text-(--warning-text) border-(--warning-border) rounded-lg py-2.5 px-3"
                  >
                    {er('notDownloadable')}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={handleDownload}
                    disabled={downloadLoading || !downloadable || (provider === "direct" && isHls)}
                    className="disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer w-full sm:flex-1 inline-flex items-center justify-center gap-2 btn-primary px-4 py-3 font-medium shadow"
                  >
                    {downloadLoading ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="white" strokeWidth="4" strokeOpacity="0.25" /></svg>
                        {t('downloadLoading')}
                      </>
                    ) : (
                      t('downloadButton')
                    )}
                  </button>

                  {(provider === "instagram" || provider === "facebook") && (
                    <button
                      onClick={() => window.open(url, "_blank")}
                      className="cursor-pointer w-full sm:flex-1 inline-flex items-center justify-center gap-2 btn-ghost px-4 py-3 font-medium hover:shadow"
                    >
                      {t('openIn')} {provider === "instagram" ? "Instagram" : "Facebook"}
                    </button>
                  )}

                  <button
                    onClick={handleShare}
                    className="cursor-pointer w-full sm:flex-1 inline-flex items-center justify-center gap-2 btn-ghost px-4 py-3 font-medium hover:shadow"
                  >
                    {t('shareButton')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* toast */}
        {toast && (
          <div className="fixed bottom-6 left-1/2 transform -translate-x-1/2 z-50">
            <div className="toast">{toast}</div>
          </div>
        )}
      </div>
    </main>
  );
}
