import { useEffect, useRef } from 'react';
import {
  Circle,
  CircleMarker,
  LayerGroup,
  LayersControl,
  MapContainer,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { dateTime } from '../format.js';
import { useI18n } from '../i18n.jsx';

const KIGALI = [-1.9441, 30.0619];
const MAX_ZOOM = 19; // close enough to see single houses

// Street map. The public OpenStreetMap servers are for light use only; before launch set
// VITE_TILE_URL (and VITE_TILE_ATTRIBUTION) to a paid or self-hosted tile service.
const TILE_URL = import.meta.env.VITE_TILE_URL || 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION =
  import.meta.env.VITE_TILE_ATTRIBUTION ||
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// Satellite photos (Esri World Imagery) with roads and place names on top.
// Free to try with this credit; a launch with many users needs an Esri (ArcGIS) account, or another
// provider set with VITE_SATELLITE_URL and VITE_SATELLITE_ATTRIBUTION.
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const SATELLITE_URL = import.meta.env.VITE_SATELLITE_URL || `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`;
const SATELLITE_ATTRIBUTION =
  import.meta.env.VITE_SATELLITE_ATTRIBUTION || 'Imagery &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community';
const ROADS_URL = `${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`;
const PLACES_URL = `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`;

// Satellite unless the person picked the street map in this browser: houses and roads are easier to recognise.
const LAYER_KEY = 'nexguard.mapLayer';
function savedLayer() {
  try {
    return localStorage.getItem(LAYER_KEY) === 'streets' ? 'streets' : 'satellite';
  } catch {
    return 'satellite';
  }
}

/** Remembers which map the person picked (streets or satellite) in this browser. */
function RememberLayer({ names }) {
  useMapEvents({
    baselayerchange(e) {
      try {
        localStorage.setItem(LAYER_KEY, e.name === names.satellite ? 'satellite' : 'streets');
      } catch {
        // storage blocked: the choice lasts for this visit
      }
    },
  });
  return null;
}

// Moves the map to the selected device, or fits the whole route.
function Focus({ last, route, deviceId }) {
  const map = useMap();
  useEffect(() => {
    if (route.length > 1) {
      map.fitBounds(route.map((p) => [p.lat, p.lng]), { padding: [40, 40], maxZoom: 17 });
    } else if (last) {
      map.setView([last.lat, last.lng], 17);
    }
    // Re-centre only when the selected device changes, its first location arrives, or its route first loads,
    // not on every refresh (so the map does not jump while someone is looking around).
  }, [deviceId, Boolean(last), route.length > 1]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** While finding: shows both the person and the device once, then lets them pan freely. */
function FitBoth({ me, last }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (!me || !last || done.current) return;
    done.current = true;
    map.fitBounds([[me.lat, me.lng], [last.lat, last.lng]], { padding: [60, 60], maxZoom: 18 });
  }, [me, last, map]);
  return null;
}

export default function DeviceMap({ device, route, me }) {
  const { lang, t } = useI18n();
  const last = device?.lastLocation;
  const path = route.map((p) => [p.lat, p.lng]);
  const names = { streets: t('map.streets'), satellite: t('map.satellite') };
  const initial = savedLayer();

  return (
    <MapContainer center={last ? [last.lat, last.lng] : KIGALI} zoom={last ? 17 : 12} maxZoom={MAX_ZOOM} className="map" scrollWheelZoom>
      {/* key={lang}: the layer names follow the chosen language */}
      <LayersControl position="topright" key={lang}>
        <LayersControl.BaseLayer name={names.satellite} checked={initial === 'satellite'}>
          <LayerGroup>
            <TileLayer attribution={SATELLITE_ATTRIBUTION} url={SATELLITE_URL} maxZoom={MAX_ZOOM} maxNativeZoom={19} />
            <TileLayer url={ROADS_URL} maxZoom={MAX_ZOOM} maxNativeZoom={19} />
            <TileLayer url={PLACES_URL} maxZoom={MAX_ZOOM} maxNativeZoom={19} />
          </LayerGroup>
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name={names.streets} checked={initial === 'streets'}>
          <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} maxZoom={MAX_ZOOM} maxNativeZoom={19} />
        </LayersControl.BaseLayer>
      </LayersControl>
      <RememberLayer names={names} />

      {path.length > 1 && <Polyline positions={path} pathOptions={{ color: '#2f6fde', weight: 3, opacity: 0.7 }} />}
      {route.map((p, i) => (
        <CircleMarker key={i} center={[p.lat, p.lng]} radius={3} pathOptions={{ color: '#2f6fde', weight: 1, fillOpacity: 0.6 }}>
          <Tooltip>{dateTime(p.at, lang)}</Tooltip>
        </CircleMarker>
      ))}
      {last && (
        <>
          {last.accuracyM > 0 && (
            <Circle center={[last.lat, last.lng]} radius={last.accuracyM} pathOptions={{ color: '#2f6fde', weight: 2, fillOpacity: 0.12 }} />
          )}
          <CircleMarker center={[last.lat, last.lng]} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#d93025', fillOpacity: 1 }}>
            <Tooltip permanent direction="top" offset={[0, -10]}>
              {device.name}
            </Tooltip>
          </CircleMarker>
        </>
      )}

      {/* Finding: the person's own position (blue) and a dashed line to the device. */}
      {me && (
        <>
          {last && <Polyline positions={[[me.lat, me.lng], [last.lat, last.lng]]} pathOptions={{ color: '#ffd400', weight: 4, dashArray: '8 8' }} />}
          {me.accuracyM > 0 && <Circle center={[me.lat, me.lng]} radius={me.accuracyM} pathOptions={{ color: '#1a73e8', weight: 1, fillOpacity: 0.1 }} />}
          <CircleMarker center={[me.lat, me.lng]} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }}>
            <Tooltip permanent direction="bottom" offset={[0, 10]}>
              {t('find.you')}
            </Tooltip>
          </CircleMarker>
          <FitBoth me={me} last={last} />
        </>
      )}
      <Focus last={last} route={route} deviceId={device?.id} />
    </MapContainer>
  );
}
