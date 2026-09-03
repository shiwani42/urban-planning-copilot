"use client";

import { useEffect, useState } from "react";
import { TileLayer } from "react-leaflet";
import { basemapAttribution, cartoBasemapUrl, type BasemapStyle } from "@/lib/basemap";

type Props = {
  style?: BasemapStyle;
};

export default function BasemapLayer({ style = "voyager" }: Props) {
  const [url, setUrl] = useState(() => cartoBasemapUrl(style));

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/basemap", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { url?: string } | null) => {
        if (cancelled || typeof data?.url !== "string" || !data.url) return;
        setUrl(data.url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [style]);

  return (
    <TileLayer
      url={url}
      attribution={basemapAttribution()}
      maxZoom={20}
      subdomains="abcd"
      crossOrigin="anonymous"
    />
  );
}
