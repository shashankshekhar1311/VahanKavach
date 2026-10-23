"use client";

import { useEffect, useRef, useState } from "react";

interface DemoVideoProps {
  /** Autoplay muted loop — best for acquisition hero embeds. */
  autoPlay?: boolean;
  className?: string;
  showCaption?: boolean;
}

/**
 * 30s VahanKavach acquisition demo (muted, loopable, 16:9).
 * Source: /demo/vahankavach-demo-30s.mp4
 */
export function DemoVideo({
  autoPlay = true,
  className = "",
  showCaption = true,
}: DemoVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !autoPlay) return;
    el.muted = true;
    void el.play().catch(() => {
      /* autoplay blocked — poster remains until user taps */
    });
  }, [autoPlay]);

  return (
    <figure className={`relative overflow-hidden ${className}`}>
      {failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/demo/poster.jpg"
          alt="VahanKavach product demo"
          className="aspect-video w-full object-cover"
        />
      ) : (
        <video
          ref={videoRef}
          className="aspect-video w-full bg-zinc-950 object-cover"
          poster="/demo/poster.jpg"
          playsInline
          muted
          loop
          autoPlay={autoPlay}
          preload="metadata"
          controls
          onError={() => setFailed(true)}
          aria-label="VahanKavach 30 second product demo"
        >
          <source src="/demo/vahankavach-demo-30s.mp4" type="video/mp4" />
        </video>
      )}
      {showCaption ? (
        <figcaption className="mt-2 text-center text-[11px] text-zinc-500">
          30s product demo · Private automotive compliance — not a government
          service
        </figcaption>
      ) : null}
    </figure>
  );
}
