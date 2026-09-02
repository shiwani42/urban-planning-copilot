"use client";

import { TileLayer } from "react-leaflet";
import { basemapAttribution, cartoBasemapUrl } from "@/lib/basemap";

type Props = {
  style?: "voyager" | "positron";
};

export default function BasemapLayer({ style = "voyager" }: Props) {
  const key = process.env.NEXT_PUBLIC_CARTO_API_KEY?.trim();
  return (
    <TileLayer
      url={cartoBasemapUrl(style)}
      attribution={basemapAttribution()}
      maxZoom={key ? 20 : 19}
      subdomains={key ? "abcd" : "abc"}
    />
  );
}
