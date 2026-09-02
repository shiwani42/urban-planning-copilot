"use client";

import { TileLayer } from "react-leaflet";
import { basemapAttribution, cartoBasemapUrl } from "@/lib/basemap";

type Props = {
  style?: "voyager" | "positron";
};

export default function BasemapLayer({ style = "voyager" }: Props) {
  return (
    <TileLayer
      url={cartoBasemapUrl(style)}
      attribution={basemapAttribution()}
      maxZoom={20}
      subdomains="abcd"
      crossOrigin="anonymous"
    />
  );
}
