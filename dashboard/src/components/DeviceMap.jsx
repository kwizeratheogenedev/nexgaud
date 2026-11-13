import { useEffect } from 'react';
import { Circle, CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { dateTime } from '../format.js';
import { useI18n } from '../i18n.jsx';

const KIGALI = [-1.9441, 30.0619];

// Map tiles. The public OpenStreetMap servers are for light use only; before launch set
// VITE_TILE_URL (and VITE_TILE_ATTRIBUTION) to a paid or self-hosted tile service.
const TILE_URL = import.meta.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  import.meta.env.VITE_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Moves the map to the selected phone, or fits the whole route.
function Focus({ last, route, deviceId }) {
  const map = useMap();
  useEffect(() => {
    if (route.length > 1) {
      map.fitBounds(route.map((p) => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 17 });
    } else if (last) {
      map.setView([last.lat, last.lng], 16);
    }
    // Re-centre only when the selected phone changes or its route first loads, not on every refresh.
  }, [deviceId, route.length > 1]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export default function DeviceMap({ device, route }) {
  const { lang } = useI18n();
  const last = device?.lastLocation;
  const path = route.map((p) => [p.lat, p.lng]);

  return (
    <MapContainer center={last ? [last.lat, last.lng] : KIGALI} zoom={last ? 16 : 12} className="map" scrollWheelZoom>
      <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
      {path.length > 1 && <Polyline positions={path} pathOptions={{ color: '#2f6fde', weight: 3, opacity: 0.7 }} />}
      {route.map((p, i) => (
        <CircleMarker key={i} center={[p.lat, p.lng]} radius={3} pathOptions={{ color: '#2f6fde', weight: 1, fillOpacity: 0.6 }}>
          <Tooltip>{dateTime(p.at, lang)}</Tooltip>
        </CircleMarker>
      ))}
      {last && (
        <>
          {last.accuracyM > 0 && (
            <Circle center={[last.lat, last.lng]} radius={last.accuracyM} pathOptions={{ color: '#2f6fde', weight: 1, fillOpacity: 0.1 }} />
          )}
          <CircleMarker center={[last.lat, last.lng]} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#d93025', fillOpacity: 1 }}>
            <Tooltip permanent direction="top" offset={[0, -10]}>
              {device.name}
            </Tooltip>
          </CircleMarker>
        </>
      )}
      <Focus last={last} route={route} deviceId={device?.id} />
    </MapContainer>
  );
}
