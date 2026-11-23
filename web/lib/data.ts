"use client";

import { useQuery } from "@tanstack/react-query";
import type { Catalog, Freshness, GeoFile, Geography, Point, ZipShard } from "./types";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Maps a geo id to its data file stem.
 * @param geoId - e.g. "CBSA:12420"
 * @returns the id with ':' replaced by '_'
 */
export function geoFileName(geoId: string): string {
  return geoId.replace(":", "_");
}

/**
 * Converts exported point tuples to objects.
 * @param raw - [period_start, period_end, value, flags] tuples
 * @returns the same observations as Point objects
 */
export function toPoints(raw: [string, string, number, string[]][]): Point[] {
  return raw.map(([start, end, value, flags]) => ({ start, end, value, flags }));
}

/**
 * Loads catalog.json.
 * @returns the query result
 */
export function useCatalog() {
  return useQuery({ queryKey: ["catalog"], queryFn: () => getJson<Catalog>("/data/catalog.json") });
}

/**
 * Loads geographies.json.
 * @returns the query result
 */
export function useGeographies() {
  return useQuery({
    queryKey: ["geographies"],
    queryFn: () => getJson<Geography[]>("/data/geographies.json"),
  });
}

/**
 * Loads freshness.json.
 * @returns the query result
 */
export function useFreshness() {
  return useQuery({
    queryKey: ["freshness"],
    queryFn: () => getJson<Freshness>("/data/freshness.json"),
  });
}

/**
 * Loads the ZIP benchmark file for a ZIP's first three digits.
 * @param zip - a 5-digit ZIP, or "" before one is entered
 * @returns the query result; a missing file (no data for that area) loads as an empty shard
 */
export function useZipShard(zip: string) {
  const prefix = /^\d{5}$/.test(zip) ? zip.slice(0, 3) : "";
  return useQuery({
    queryKey: ["zip", prefix],
    enabled: prefix !== "",
    queryFn: async () => {
      const res = await fetch(`/data/zip/${prefix}.json`);
      if (res.status === 404) return {} as ZipShard;
      if (!res.ok) throw new Error(`zip/${prefix}.json: HTTP ${res.status}`);
      return (await res.json()) as ZipShard;
    },
  });
}

/**
 * Loads one geography's series file.
 * @param geoId - e.g. "CBSA:12420"
 * @returns the query result
 */
export function useGeoFile(geoId: string) {
  return useQuery({
    queryKey: ["geo", geoId],
    queryFn: () => getJson<GeoFile>(`/data/geo/${geoFileName(geoId)}.json`),
  });
}
