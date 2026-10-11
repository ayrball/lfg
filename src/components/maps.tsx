import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import { Circle, MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import type { Game, LatLng } from '../lib/types';
import { sportInfo } from '../lib/sports';
import { formatGameTime } from '../lib/format';

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function emojiIcon(emoji: string, highlight = false) {
  return L.divIcon({
    className: 'map-pin',
    html: `<span class="map-pin__bubble${highlight ? ' map-pin__bubble--hl' : ''}"><span class="map-pin__emoji">${emoji}</span></span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 34],
    popupAnchor: [0, -30],
  });
}

const youIcon = L.divIcon({ className: 'map-you', html: '<span></span>', iconSize: [16, 16], iconAnchor: [8, 8] });

function Recenter({ center, zoom }: { center: LatLng; zoom?: number }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], zoom ?? map.getZoom());
  }, [map, center.lat, center.lng, zoom]);
  return null;
}

function ClickToPick({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

/** Tap the map to drop a pin. */
export function MapPicker({
  value,
  fallbackCenter,
  onChange,
  emoji = '📍',
  radiusMeters,
}: {
  value: LatLng | null;
  fallbackCenter: LatLng;
  onChange: (p: LatLng) => void;
  emoji?: string;
  /** Circle drawn around the pin (check-in area, notification radius…). */
  radiusMeters?: number;
}) {
  const center = value ?? fallbackCenter;
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={value ? 15 : 12} className="map map--picker" scrollWheelZoom={false}>
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      <Recenter center={center} />
      <ClickToPick onPick={onChange} />
      {value && (
        <>
          <Marker
            position={[value.lat, value.lng]}
            icon={emojiIcon(emoji, true)}
            draggable
            eventHandlers={{
              dragend: (e) => {
                const ll = (e.target as L.Marker).getLatLng();
                onChange({ lat: ll.lat, lng: ll.lng });
              },
            }}
          />
          {radiusMeters && (
            <Circle
              center={[value.lat, value.lng]}
              radius={radiusMeters}
              pathOptions={{ color: '#16a34a', weight: 1, fillOpacity: 0.08 }}
            />
          )}
        </>
      )}
    </MapContainer>
  );
}

/** Map of games around a point. */
export function GamesMap({ games, center, radiusMiles }: { games: Game[]; center: LatLng; radiusMiles: number }) {
  const zoom = radiusMiles <= 5 ? 12 : radiusMiles <= 10 ? 11 : radiusMiles <= 25 ? 10 : 9;
  return (
    <MapContainer center={[center.lat, center.lng]} zoom={zoom} className="map map--feed">
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      <Recenter center={center} zoom={zoom} />
      <Marker position={[center.lat, center.lng]} icon={youIcon} />
      <Circle
        center={[center.lat, center.lng]}
        radius={radiusMiles * 1609.344}
        pathOptions={{ color: '#16a34a', weight: 1, fillOpacity: 0.04 }}
      />
      {games.map((g) => (
        <Marker key={g.id} position={[g.lat, g.lng]} icon={emojiIcon(sportInfo(g.sport).emoji)}>
          <Popup>
            <strong>{g.title}</strong>
            <br />
            {formatGameTime(g.starts_at)}
            <br />
            {g.venue_name} · {g.going_count}/{g.max_players}
            <br />
            <Link to={`/games/${g.id}`}>View game →</Link>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}

/** Small static map for a single venue. */
export function VenueMap({ point, emoji, checkinRadius }: { point: LatLng; emoji: string; checkinRadius?: number }) {
  return (
    <MapContainer
      center={[point.lat, point.lng]}
      zoom={15}
      className="map map--venue"
      scrollWheelZoom={false}
      dragging={!L.Browser.mobile}
    >
      <TileLayer url={TILE_URL} attribution={ATTRIBUTION} />
      <Recenter center={point} />
      {checkinRadius && (
        <Circle
          center={[point.lat, point.lng]}
          radius={checkinRadius}
          pathOptions={{ color: '#16a34a', weight: 1, dashArray: '4 4', fillOpacity: 0.06 }}
        />
      )}
      <Marker position={[point.lat, point.lng]} icon={emojiIcon(emoji, true)} />
    </MapContainer>
  );
}
