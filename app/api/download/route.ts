import {NextRequest} from "next/server";
import ytdl from "ytdl-core";
import type { videoFormat } from "ytdl-core";
import ar from "@/messages/ar.json";
import en from "@/messages/en.json";
import es from "@/messages/es.json";

export const runtime = "nodejs";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";

const dictionaries = { ar, en, es } as const;
type Locale = keyof typeof dictionaries;

function getLocale(req: NextRequest): Locale {
  const q = new URL(req.url).searchParams.get("locale");
  if(q=="ar" || q == "en" || q == "es") return q;
  return "en";
}

// Reads Errors.<key> from the right messages/*.json file and fills in
// {placeholders}. One call, one line, always localized.
function msg(locale: Locale,key: keyof typeof  en.Errors, vars?: Record<string, string | number>){
  let text:string = dictionaries[locale].Errors[key]?? dictionaries.en.Errors[key];
  if(vars){
    for(const [k, v] of Object.entries(vars)){
      text = text.replace(`${k}`, String(v));
    }
  }
  return text;
}

function isHttpUrl(u: string) {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

function inferFileName(target: string) {
  try {
    const { pathname } = new URL(target);
    const last = pathname.split("/").pop() || "video";
    if (/(\.\w{2,5})$/.test(last)) return last;
    return `${last}.mp4`;
  } catch {
    return "video.mp4";
  }
}

export async function GET(req: NextRequest) {
  const locale = getLocale(req);
  const u = new URL(req.url);
  const target = u.searchParams.get("url");
  if (!target || !isHttpUrl(target)) return new Response(msg(locale,"resolveFailed"), { status: 400 });

  // If it's a YouTube URL, handle with ytdl-core
  const isYoutube = ytdl.validateURL(target);

  if (isYoutube) {
    try {
      // Extraer ID robustamente (maneja watch, youtu.be, shorts, playlists)
      const getIdSafe = (input: string) => {
        try { return ytdl.getURLVideoID(input); } catch {}
        try {
          const urlObj = new URL(input);
          if (urlObj.hostname.includes("youtu.be")) {
            const seg = urlObj.pathname.split("/").filter(Boolean)[0];
            if (seg) return seg;
          }
          if (urlObj.hostname.includes("youtube.com")) {
            const v = urlObj.searchParams.get("v");
            if (v) return v;
            // shorts
            const parts = urlObj.pathname.split("/").filter(Boolean);
            const shortsIdx = parts.findIndex(p => p.toLowerCase() === 'shorts');
            if (shortsIdx !== -1 && parts[shortsIdx + 1]) return parts[shortsIdx + 1];
          }
        } catch {}
        throw new Error(msg(locale,"youtubeIdError"));
      };

      const videoId = getIdSafe(target);
      const canonical = `https://www.youtube.com/watch?v=${videoId}`;

      const info = await ytdl.getInfo(canonical, {
        requestOptions: {
          maxRetries: 2,
          headers: {
            'user-agent': UA,
            'accept-language': 'es-ES,es;q=0.9,en;q=0.8',
          }
        }
      });

      if (info.videoDetails.isLiveContent) {
        return new Response(msg(locale,"youtubeLiveError"), { status: 400 });
      }

      // Elegir mejor formato progresivo (video+audio) priorizando MP4
      const progressive = (info.formats as videoFormat[])
        .filter((f: videoFormat) => (f.hasVideo && f.hasAudio));

      // ytdl-core chooseFormat ayuda a escoger por calidad
      let chosen: videoFormat | undefined;
      try {
        chosen = ytdl.chooseFormat(progressive, { quality: 'highest' }) as videoFormat;
      } catch {
        // fallback manual si chooseFormat no encuentra
        chosen = progressive
          .sort((a: videoFormat, b: videoFormat) => (b.bitrate || 0) - (a.bitrate || 0))[0];
      }
      // Preferir MP4 si hay empate o el elegido no es MP4
      if (chosen && chosen.container !== 'mp4') {
        const mp4 = progressive.find((f: videoFormat) => (f.container === 'mp4') || /mp4/i.test(f.mimeType || ""));
        if (mp4) chosen = mp4;
      }

      if (!chosen) {
        return new Response(msg(locale,"youtubeNoProgressive"), { status: 400 });
      }

  const nodeStream = ytdl.downloadFromInfo(info, { format: chosen });

      // Convertir a ReadableStream Web
      const webStream = new ReadableStream<Uint8Array>({
        start(controller) {
          nodeStream.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          nodeStream.on("end", () => controller.close());
          nodeStream.on("error", (err: Error) => controller.error(err));
        },
        cancel() {
          try { nodeStream.destroy(); } catch {}
        }
      });

      // Sugerir nombre de archivo limpio
      const rawTitle = info.videoDetails.title || "video";
      const safeTitle = rawTitle
        .replace(/[\\/:*?"<>|]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 100) || "video";
      const ext = (chosen.container === "mp4" || /mp4/i.test(chosen.mimeType || "")) ? "mp4" : (chosen.container || "webm");
      const filename = `${safeTitle}.${ext}`;

      const headers = new Headers();
      headers.set("content-type", chosen.mimeType || (ext === "mp4" ? "video/mp4" : "video/webm"));
      headers.set("content-disposition", `attachment; filename="${filename}"`);
      headers.set("cache-control", "no-store");

      return new Response(webStream, { status: 200, headers });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : msg(locale,"unKnownError");
      console.error("youtube download error", message);
      // Propaga un mensaje legible al cliente
      return new Response(msg(locale,"youtubeDownloadError",{message}), { status: 400 });
    }
  }

  const upstream = await fetch(target, {
    redirect: "follow",
    headers: {
      "user-agent": UA,
      accept: "*/*",
      // Some CDNs require an Origin to be set; spoof our own host as origin
      ...(req.headers.get("host") ? { origin: `https://${req.headers.get("host")}` } : {}),
    },
  });

  if (!upstream.ok || !upstream.body) {
    return new Response(`Upstream error: ${upstream.status}`, { status: upstream.status || 502 });
  }

  const headers = new Headers();
  const ct = upstream.headers.get("content-type") || "application/octet-stream";
  const cl = upstream.headers.get("content-length");
  if (ct) headers.set("content-type", ct);
  if (cl) headers.set("content-length", cl);
  const filename = inferFileName(target);
  headers.set("content-disposition", `attachment; filename="${filename}"`);
  // Disable caching for safety
  headers.set("cache-control", "no-store");

  return new Response(upstream.body, { status: 200, headers });
}
