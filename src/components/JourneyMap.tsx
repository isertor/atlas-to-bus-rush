"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { MapBus, MapPath, MapStop } from "@/lib/map";
import { minutesFromNow } from "@/lib/time";

// Live journey map: the stops still ahead, the buses you could board next,
// the route line, and YOU — as the bus you're riding when it has live GPS
// (pulsing accent chip), otherwise as the phone's geolocation dot. Plain
// Leaflet (no react-leaflet) on free CARTO/OSM raster tiles — no API key.
// All markers are CSS-styled divIcons (see globals.css `.m*` rules).
//
// Camera: auto-fits to `focus` (you + the next decision stops) on every data
// update, so the view follows the ride — but backs off for 30s whenever the
// user pans/zooms, so it never fights them. ⌖ resumes following immediately.

export interface UserPos {
  lat: number;
  lng: number;
  accuracy?: number;
}

interface Props {
  stops: MapStop[];
  buses: MapBus[];
  paths?: MapPath[];
  /** The bus being ridden (live GPS) — rendered as "you". */
  me?: { lat: number; lng: number } | null;
  user: UserPos | null;
  now: number;
  /** Service you're riding — labels the "me" chip. */
  myService?: string;
  /** What the camera should keep in view (you + upcoming decision stops). */
  focus?: { lat: number; lng: number }[];
}

const TILES = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';
const FOLLOW_PAUSE_MS = 30_000;

function stopIcon(stop: MapStop): L.DivIcon {
  return L.divIcon({
    className: "mwrap",
    html: `<span class="mstop"><i></i><b>${esc(stop.name)}</b></span>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

function busIcon(bus: MapBus, etaMin: number): L.DivIcon {
  const eta = etaMin <= 0 ? "now" : `${etaMin}m`;
  return L.divIcon({
    className: "mwrap",
    html: `<span class="mbus watch">${esc(bus.service)}<i>${eta}</i></span>`,
    iconSize: [30, 18],
    iconAnchor: [15, 9],
  });
}

function meIcon(service: string): L.DivIcon {
  return L.divIcon({
    className: "mwrap",
    html: `<span class="mbus me">${esc(service)}<i>you</i></span>`,
    iconSize: [36, 20],
    iconAnchor: [18, 10],
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

export default function JourneyMap({ stops, buses, paths, me, user, now, myService, focus }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const interactedAt = useRef(0);
  const fitting = useRef(false);

  useEffect(() => {
    if (!elRef.current || mapRef.current) return;
    const map = L.map(elRef.current, { zoomControl: false, attributionControl: true });
    map.setView([1.3521, 103.8198], 12); // Singapore, until data arrives
    L.tileLayer(TILES, { attribution: ATTR, maxZoom: 19 }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);

    // Pause auto-follow when the USER moves the camera (not our own fits).
    const markInteraction = () => {
      if (!fitting.current) interactedAt.current = Date.now();
    };
    map.on("dragstart", markInteraction);
    map.on("zoomstart", markInteraction);

    const Recenter = L.Control.extend({
      onAdd: () => {
        const btn = L.DomUtil.create("button", "mrecenter");
        btn.type = "button";
        btn.title = "Follow the journey";
        btn.textContent = "⌖";
        L.DomEvent.on(btn, "click", (e) => {
          L.DomEvent.stop(e);
          interactedAt.current = 0; // resume following
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
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    const draw = () => {
      layer.clearLayers();
      for (const path of paths ?? []) {
        L.polyline(path.points, {
          color: "#6b4fd6",
          weight: path.kind === "current" ? 4 : 3,
          opacity: path.kind === "current" ? 0.9 : 0.4,
          dashArray: path.kind === "current" ? undefined : "5 9",
          interactive: false,
        }).addTo(layer);
      }
      for (const stop of stops) {
        L.marker([stop.lat, stop.lng], { icon: stopIcon(stop), interactive: false }).addTo(layer);
      }
      for (const bus of buses) {
        L.marker([bus.lat, bus.lng], {
          icon: busIcon(bus, Math.max(0, minutesFromNow(bus.etaMs, now))),
          interactive: false,
          zIndexOffset: 1000,
        }).addTo(layer);
      }
      if (me) {
        L.marker([me.lat, me.lng], {
          icon: meIcon(myService ?? "•"),
          interactive: false,
          zIndexOffset: 3000,
        }).addTo(layer);
      } else if (user) {
        // No matched bus — the phone's own position is "you".
        L.marker([user.lat, user.lng], { icon: USER_ICON, interactive: false, zIndexOffset: 2000 }).addTo(layer);
      }

      const pts = focus && focus.length > 0 ? focus : stops;
      if (pts.length > 0 && Date.now() - interactedAt.current > FOLLOW_PAUSE_MS) {
        fitting.current = true;
        map.stop(); // cancel any in-flight fit animation, or this one is swallowed
        map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number])), {
          padding: [44, 44],
          maxZoom: 16,
        });
        window.setTimeout(() => {
          fitting.current = false;
        }, 700); // past the fit animation, so it isn't read as user input
      }
    };

    draw();
    map.on("bus-rush:refit", draw);
    return () => {
      map.off("bus-rush:refit", draw);
    };
  }, [stops, buses, paths, me, user, now, myService, focus]);

  return <div ref={elRef} className="map" />;
}
