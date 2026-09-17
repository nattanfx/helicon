"use client";

import { CornersIn, CornersOut, Pause, SpeakerHigh, SpeakerSlash } from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { trackEvent } from "@/lib/client-analytics";

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** Play triangle with its centroid on the viewBox center, so it sits optically in a circle. */
function PlayGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M8.7 6.4v11.2L18.6 12 8.7 6.4z" />
    </svg>
  );
}

function canAutoplayWithoutJank() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  const slow = connection?.effectiveType === "slow-2g" || connection?.effectiveType === "2g";
  return (
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches &&
    !window.matchMedia("(pointer: coarse)").matches &&
    !connection?.saveData &&
    !slow &&
    window.innerWidth >= 768
  );
}

export function DemoVideo({
  src,
  poster,
  label,
}: {
  src: string;
  poster: string;
  label: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<number>(0);
  const userTouched = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [controls, setControls] = useState(true);

  const showControls = useCallback((sticky = false) => {
    setControls(true);
    window.clearTimeout(hideTimer.current);
    if (sticky) return;
    hideTimer.current = window.setTimeout(() => {
      const node = videoRef.current;
      if (node && !node.paused) setControls(false);
    }, 2200);
  }, []);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  // A cached video can reach loadedmetadata before React attaches its handler, which would leave
  // duration at 0 and the seek bar dead. Read whatever the element already knows on mount.
  useEffect(() => {
    const node = videoRef.current;
    if (node && Number.isFinite(node.duration) && node.duration > 0) setDuration(node.duration);
  }, []);

  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  useEffect(() => {
    const node = videoRef.current;
    const root = rootRef.current;
    if (!node || !root || !canAutoplayWithoutJank()) return;

    let timer = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (userTouched.current) return;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.45) {
          if (timer) return;
          timer = window.setTimeout(() => {
            if (userTouched.current || !videoRef.current) return;
            videoRef.current.muted = true;
            setMuted(true);
            // Scrolling away pauses the video before play() settles, which rejects it with AbortError; that is expected.
            videoRef.current.play().catch(() => undefined);
          }, 2500);
        } else {
          window.clearTimeout(timer);
          timer = 0;
          const video = videoRef.current;
          if (video && !video.paused) video.pause();
        }
      },
      { threshold: [0.45] },
    );
    io.observe(root);
    return () => {
      io.disconnect();
      window.clearTimeout(timer);
    };
  }, []);

  const togglePlay = useCallback(() => {
    const node = videoRef.current;
    if (!node) return;
    userTouched.current = true;
    if (node.ended) node.currentTime = 0;
    if (node.paused) {
      trackEvent("demo_play", { source: "user" });
      node.muted = false;
      setMuted(false);
      node.play().catch((error: unknown) => {
        // A browser that refuses sound without its own gesture rule still plays the video muted.
        if (error instanceof DOMException && error.name === "NotAllowedError") {
          node.muted = true;
          setMuted(true);
          node.play().catch(() => undefined);
        }
      });
    } else {
      node.pause();
    }
  }, []);

  const toggleMute = useCallback(() => {
    const node = videoRef.current;
    if (!node) return;
    userTouched.current = true;
    node.muted = !node.muted;
    setMuted(node.muted);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const root = rootRef.current;
    const node = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!root || !node) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    if (root.requestFullscreen) {
      await root.requestFullscreen();
      return;
    }
    node.webkitEnterFullscreen?.();
  }, []);

  const seekTo = useCallback((value: number) => {
    const node = videoRef.current;
    if (!node) return;
    node.currentTime = value;
    setCurrent(value);
  }, []);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const key = event.key.toLowerCase();
      if (key === " " || key === "k") {
        event.preventDefault();
        togglePlay();
      } else if (key === "m") {
        toggleMute();
      } else if (key === "f") {
        void toggleFullscreen();
      } else if (key === "arrowleft") {
        event.preventDefault();
        seekTo(Math.max(0, (videoRef.current?.currentTime ?? 0) - 5));
      } else if (key === "arrowright") {
        event.preventDefault();
        const node = videoRef.current;
        seekTo(Math.min(node?.duration ?? 0, (node?.currentTime ?? 0) + 5));
      }
    },
    [seekTo, toggleFullscreen, toggleMute, togglePlay],
  );

  const progress = duration > 0 ? current / duration : 0;

  return (
    <div
      ref={rootRef}
      className="demo-player group/player relative bg-black text-white outline-none"
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerMove={() => showControls()}
      onPointerLeave={() => {
        if (playing) setControls(false);
      }}
    >
      <video
        ref={videoRef}
        className="block aspect-video h-auto w-full bg-black"
        poster={poster}
        playsInline
        preload="metadata"
        aria-label={label}
        onClick={togglePlay}
        onPlay={() => {
          setPlaying(true);
          showControls();
        }}
        onPause={() => {
          setPlaying(false);
          setControls(true);
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onDurationChange={(event) => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) setDuration(value);
        }}
        onEnded={() => {
          setPlaying(false);
          setControls(true);
        }}
      >
        <source src={src} type="video/mp4" />
      </video>

      {!playing ? (
        <button
          type="button"
          onClick={togglePlay}
          className="absolute top-1/2 left-1/2 inline-flex size-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-btn text-btn-fg shadow-[0_8px_32px_rgb(10_60_130/0.45)] transition-transform duration-150 ease-out hover:bg-btn-hover active:scale-[0.96] sm:size-[4.5rem]"
          aria-label="Play walkthrough"
        >
          <PlayGlyph className="size-7 sm:size-8" />
        </button>
      ) : null}

      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3 pt-16 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-opacity duration-200 sm:px-4 ${
          controls ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <label className="block">
          <span className="sr-only">Seek</span>
          <input
            type="range"
            className="demo-seek"
            min={0}
            max={duration || 0}
            step={0.05}
            value={current}
            style={{ ["--demo-progress" as string]: `${progress * 100}%` }}
            onChange={(event) => seekTo(Number(event.currentTarget.value))}
            onPointerDown={() => showControls(true)}
            onPointerUp={() => showControls()}
          />
        </label>
        <div className="mt-2 flex items-center gap-1 sm:gap-1.5">
          <button type="button" className="demo-ctrl" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause weight="fill" /> : <PlayGlyph />}
          </button>
          <p className="min-w-[5.75rem] px-1.5 text-[12.5px] font-medium tabular-nums text-white/80">
            {formatTime(current)}
            <span className="text-white/45"> / {formatTime(duration)}</span>
          </p>
          <span className="flex-1" />
          <button type="button" className="demo-ctrl" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? <SpeakerSlash weight="fill" /> : <SpeakerHigh weight="fill" />}
          </button>
          <button
            type="button"
            className="demo-ctrl"
            onClick={() => void toggleFullscreen()}
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {fullscreen ? <CornersIn weight="bold" /> : <CornersOut weight="bold" />}
          </button>
        </div>
      </div>
    </div>
  );
}
