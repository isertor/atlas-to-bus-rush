"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { MapBus, MapStop } from "@/lib/map";
import { minutesFromNow } from "@/lib/time";

// Live journey map: the route's key stops, every relevant bus with GPS, and
// the rider. Plain Leaflet (no react-leaflet) on free CARTO/OSM raster tiles —
// no API key, no vendor account. All markers are CSS-styled divIcons so they
// match the app's design system (see globals.css `.m*` rules).
//
// The map fits the journey's stops once on first data, then leaves the camera
// alone while polling updates markers — panning/zooming isn't fought every
// refresh; the ⌖ control re-fits on demand.

export interface UserPos {
  lat: number;
  lng: number;
  accuracy?: number;
}

interface Props {
  stops: MapStop[];
  buses: MapBus[];
  user: UserPos | null;
  now: number;
  /** Service you're riding — its buses render in ink. */
  myService?: string;
  /** Services you're trying to catch — render in accent purple. */
  watchServices?: string[];
}

const TILES = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

function stopIcon(stop: MapStop): L.DivIcon {
  return L.divIcon({
    className: "mwrap",
    html: `<span class="mstop"><i></i><b>${esc(stop.name)}</b></span>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

function busIcon(bus: MapBus, tone: "mine" | "watch" | "other", etaMin: number): L.DivIcon {
  const eta = etaMin <= 0 ? "now" : `${etaMin}m`;
  return L.divIcon({
    className: "mwrap",
    html: `<span class="mbus ${tone}">${esc(bus.service)}<i>${eta}</i></span>`,
    iconSize: [30, 18],
    iconAnchor: [15, 9],
  });
}

const USER_ICON = L.divIcon({
  className: "mwrap",
  html: '<span class="muser"><i></i></span>',
  iconSize: [14, 14],
  iconAnchor: [7, 7],
});

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export default function JourneyMap({ stops, buses, user, now, myService, watchServices }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { zoomControl: false, attributionControl: true });
    map.setView([1.3521, 103.8198], 12); // Singapore, until stops arrive
    L.tileLayer(TILES, { attribution: ATTR, maxZoom: 19 }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);

    const Recenter = L.Control.extend({
      onAdd: () => {
        const btn = L.DomUtil.create("button", "mrecenter");
        btn.type = "button";
        btn.title = "Fit journey";
        btn.textContent = "⌖";
        L.DomEvent.on(btn, "click", (e) => {
          L.DomEvent.stop(e);
          fittedRef.current = false;
          map.fire("bus-rush:refit");
        });
        return btn;
      },
    });
    new Recenter({ position: "bottomright" }).addTo(map);

    layerRef.current = L.layerGroup().addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      fittedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    const draw = () => {
      layer.clearLayers();
      for (const stop of stops) {
        L.marker([stop.lat, stop.lng], { icon: stopIcon(stop), interactive: false }).addTo(layer);
      }
      const watch = new Set(watchServices ?? []);
      for (const bus of buses) {
        const tone = bus.service === myService ? "mine" : watch.has(bus.service) ? "watch" : "other";
        L.marker([bus.lat, bus.lng], {
          icon: busIcon(bus, tone, Math.max(0, minutesFromNow(bus.etaMs, now))),
          interactive: false,
          zIndexOffset: tone === "other" ? 0 : 1000,
        }).addTo(layer);
      }
      if (user) {
        L.marker([user.lat, user.lng], { icon: USER_ICON, interactive: false, zIndexOffset: 2000 }).addTo(layer);
      }
      if (!fittedRef.current && stops.length > 0) {
        const pts: L.LatLngExpression[] = stops.map((s) => [s.lat, s.lng]);
        if (user) pts.push([user.lat, user.lng]);
        map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 16 });
        fittedRef.current = true;
      }
    };

    draw();
    map.on("bus-rush:refit", draw);
    return () => {
      map.off("bus-rush:refit", draw);
    };
  }, [stops, buses, user, now, myService, watchServices]);

  return <div ref={elRef} className="map" />;
}
