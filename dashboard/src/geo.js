import { useEffect, useState } from 'react';

const R = 6371000; // Earth's radius in metres
const rad = (d) => (d * Math.PI) / 180;

/** Straight-line distance in metres between two { lat, lng } points. */
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Compass direction from a to b, as one of 8 keys: n, ne, e, se, s, sw, w, nw. */
export function direction(a, b) {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  return ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'][Math.round(deg / 45) % 8];
}

/** 85 → "85 m", 1530 → "1.5 km". */
export const formatDistance = (m) => (m < 1000 ? `${Math.round(m / 5) * 5} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`);

/** Turn-by-turn directions in Google Maps (opens the Maps app on phones). */
export const directionsUrl = (to) => `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}&travelmode=walking`;

/**
 * The person's own position while `active`, from the browser (GPS on phones), updated as they move.
 * Returns { me: { lat, lng, accuracyM } | null, error: 'denied' | 'unavailable' | 'insecure' | null }.
 * Browsers allow this only on https:// pages (and on localhost).
 */
export function useMyPosition(active) {
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!active) {
      setMe(null);
      setError(null);
      return undefined;
    }
    if (!window.isSecureContext) {
      setError('insecure');
      return undefined;
    }
    if (!navigator.geolocation) {
      setError('unavailable');
      return undefined;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setMe({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) });
        setError(null);
      },
      (err) => setError(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);

  return { me, error };
}
