import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  BillboardGraphics, BoundingSphere, CallbackPositionProperty, Cartesian2, Cartesian3, Cartographic, Color, ConstantPositionProperty, ConstantProperty,
  DistanceDisplayCondition, Entity, HeadingPitchRange, HeadingPitchRoll, ImageryLayer, Ion, IonGeocoderService, Math as CesiumMath, Matrix4,
  Model, ModelGraphics, NearFarScalar, OpenStreetMapImageryProvider, Rectangle, SceneMode, SceneTransforms, ScreenSpaceEventHandler, ScreenSpaceEventType,
  Terrain, TileMapServiceImageryProvider, Transforms, Viewer, buildModuleUrl,
  createOsmBuildingsAsync, createWorldImageryAsync, createWorldTerrainAsync,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import { altitudeM, cesiumHeadingFromTrackDeg, movePosition, POSITION_UPDATE_INTERVAL_MS } from "../data/flightMath";
import { JFK } from "../data/locations";
import { isLocalDevelopment } from "../data/setup";
import type { Aircraft, AssetStatus, Location, MapKind, Trails } from "../types";

const rawIonToken = import.meta.env.VITE_CESIUM_ION_TOKEN?.trim();
const ionToken = rawIonToken && !rawIonToken.startsWith("your_") ? rawIonToken : null;
const modelUrl = "/models/airspace-generic.glb";
const initialStatus: AssetStatus = { imagery: "loading", terrain: "loading", buildings: "not_requested", model: "loading", message: null };

export interface MapHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  flyTo: (location: Location) => void;
  focusAircraft: (aircraft: Aircraft) => void;
  search: (query: string) => Promise<{ label: string; latitude: number; longitude: number }>;
}
interface Props {
  kind: MapKind;
  location: Location;
  aircraft: Aircraft[];
  trails: Trails;
  selectedId: string | null;
  paths: "all" | "selected" | "off";
  preview?: boolean;
  animatePositions?: boolean;
  motionRate?: number;
  onSelect?: (id: string) => void;
  onStatus?: (status: AssetStatus) => void;
  onBounds?: (bounds: [number, number, number, number]) => void;
  onVisibleIds?: (ids: string[]) => void;
}
function safeIonMessage() {
  const settings = isLocalDevelopment() ? ".env.local" : "Vercel project Environment Variables";
  return `Cesium ion content is unavailable. Check VITE_CESIUM_ION_TOKEN, its assets:read scope, allowed assets, and allowed URLs in ${settings}. A street map or Natural Earth fallback and an ellipsoid are shown instead.`;
}
function planeImage(color: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><path d="M20 3c1.7 0 2 2.2 2 4v8.5l13 8v3l-13-3.5v8l4 3V37l-6-1.7-6 1.7v-2.5l4-3v-8L5 26.5v-3l13-8V7c0-1.8.3-4 2-4Z" fill="${color}" stroke="#071523" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
const markerImage = (color: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="${color}" stroke="#071523" stroke-width="2"/><circle cx="12" cy="12" r="1.5" fill="#071523"/></svg>`)}`;
const images = { live: planeImage("#e8f4f8"), stale: planeImage("#8498a7"), selected: planeImage("#d5ff36"), simulated: planeImage("#b39cff"), unknown: markerImage("#e8f4f8"), unknownSelected: markerImage("#d5ff36") };

interface MotionState {
  latitude: number;
  longitude: number;
  altitudeM: number;
  groundSpeedMs: number;
  trackDeg: number;
  rate: number;
  startedAt: number;
  correctionLatitude: number;
  correctionLongitude: number;
  sourceLatitude: number;
  sourceLongitude: number;
  sourceAltitudeM: number;
  sourceGroundSpeedMs: number;
  sourceTrackDeg: number;
  sourcePositionTime: number | null;
  sourcePositionKind: Aircraft["positionKind"];
}
function longitudeDelta(from: number, to: number) { return ((from - to + 540) % 360) - 180; }
function wrapLongitude(value: number) { return ((value + 540) % 360) - 180; }
function motionPosition(state: MotionState, now: number) {
  const elapsed = Math.max(0, (now - state.startedAt) / 1000);
  const moved = movePosition(state.latitude, state.longitude, state.trackDeg, state.groundSpeedMs * elapsed * state.rate);
  const linearBlend = Math.min(1, elapsed * 1000 / POSITION_UPDATE_INTERVAL_MS);
  const blend = linearBlend * linearBlend * (3 - 2 * linearBlend);
  return {
    latitude: moved.latitude + state.correctionLatitude * (1 - blend),
    longitude: wrapLongitude(moved.longitude + state.correctionLongitude * (1 - blend)),
    altitudeM: state.altitudeM,
  };
}

function aim(viewer: Viewer, kind: MapKind, location: Location, instant = false, preview = false) {
  if (kind === "us") {
    const destination = location.id === JFK.id ? Rectangle.fromDegrees(-125, 24, -66, 50) : Rectangle.fromDegrees(location.lon - 2, location.lat - 1.5, location.lon + 2, location.lat + 1.5);
    if (instant) viewer.camera.setView({ destination });
    else viewer.camera.flyTo({ destination, duration: 1.1 });
  } else {
    const target = Cartesian3.fromDegrees(location.lon, location.lat, 0);
    const offset = new HeadingPitchRange(0, CesiumMath.toRadians(-58), preview ? 64_000 : 36_000);
    if (instant) {
      viewer.camera.lookAt(target, offset);
      viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    } else viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 0), { offset, duration: 1.1 });
  }
}
function addOrUpdateBillboard(entity: Entity, aircraft: Aircraft, kind: MapKind, selected: boolean, modelReady: boolean) {
  const image = aircraft.trackDeg === null
    ? selected ? images.unknownSelected : images.unknown
    : selected ? images.selected : aircraft.kind === "simulated" ? images.simulated : aircraft.positionKind === "estimated" || aircraft.positionKind === "stale" ? images.stale : images.live;
  const billboard = entity.billboard ?? new BillboardGraphics();
  billboard.image = new ConstantProperty(image);
  billboard.rotation = new ConstantProperty(-CesiumMath.toRadians(aircraft.trackDeg ?? 0));
  billboard.width = new ConstantProperty(kind === "us" ? 22 : modelReady ? 12 : 26);
  billboard.height = new ConstantProperty(kind === "us" ? 22 : modelReady ? 12 : 26);
  billboard.scaleByDistance = new ConstantProperty(new NearFarScalar(2000, 1.05, 4_000_000, 0.65));
  billboard.distanceDisplayCondition = kind === "local" && modelReady && (aircraft.geoAltitudeM !== null || aircraft.baroAltitudeM !== null)
    ? new ConstantProperty(new DistanceDisplayCondition(1_000, Number.MAX_VALUE)) : undefined;
  entity.billboard = billboard;
}

export const CesiumMap = forwardRef<MapHandle, Props>(function CesiumMap({ kind, location, aircraft, trails, selectedId, paths, preview = false, animatePositions = true, motionRate = 1, onSelect, onStatus, onBounds, onVisibleIds }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const entitiesRef = useRef<Map<string, Entity>>(new Map());
  const motionRef = useRef<Map<string, MotionState>>(new Map());
  const trailsRef = useRef<Map<string, Entity>>(new Map());
  const [modelReady, setModelReady] = useState(false);
  const selectRef = useRef(onSelect);
  const statusRef = useRef(onStatus);
  const boundsRef = useRef(onBounds);
  const visibleRef = useRef(onVisibleIds);
  const aircraftRef = useRef(aircraft);
  const lastVisibleRef = useRef("");
  selectRef.current = onSelect;
  statusRef.current = onStatus;
  boundsRef.current = onBounds;
  visibleRef.current = onVisibleIds;
  aircraftRef.current = aircraft;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const reportVisible = () => {
    const viewer = viewerRef.current;
    if (!viewer || !visibleRef.current) return;
    const ids: string[] = [];
    const canvas = viewer.scene.canvas;
    for (const item of aircraftRef.current) {
      if (item.latitude === null || item.longitude === null) continue;
      const point = Cartesian3.fromDegrees(item.longitude, item.latitude, altitudeM(item));
      const toPoint = Cartesian3.subtract(point, viewer.camera.positionWC, new Cartesian3());
      if (Cartesian3.dot(viewer.camera.directionWC, toPoint) <= 0) continue;
      const pixel = SceneTransforms.worldToWindowCoordinates(viewer.scene, point);
      if (pixel && pixel.x >= 0 && pixel.y >= 0 && pixel.x <= canvas.clientWidth && pixel.y <= canvas.clientHeight) ids.push(item.id);
    }
    const key = ids.join("|");
    if (key !== lastVisibleRef.current) { lastVisibleRef.current = key; visibleRef.current(ids); }
  };
  const reportVisibleRef = useRef(reportVisible);
  reportVisibleRef.current = reportVisible;

  useImperativeHandle(ref, () => ({
    zoomIn: () => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      const selected = kind === "local" ? aircraftRef.current.find(item => item.id === selectedIdRef.current) : undefined;
      const target = selected && selected.latitude !== null && selected.longitude !== null
        ? Cartesian3.fromDegrees(selected.longitude, selected.latitude, altitudeM(selected)) : undefined;
      const targetRange = target ? Cartesian3.distance(viewer.camera.positionWC, target) : undefined;
      const distance = targetRange ? Math.min(Math.max(targetRange * 0.3, 25), 2_000) : viewer.camera.positionCartographic.height * 0.3;
      viewer.camera.zoomIn(distance);
    },
    zoomOut: () => {
      const viewer = viewerRef.current;
      if (!viewer) return;
      const selected = kind === "local" ? aircraftRef.current.find(item => item.id === selectedIdRef.current) : undefined;
      const target = selected && selected.latitude !== null && selected.longitude !== null
        ? Cartesian3.fromDegrees(selected.longitude, selected.latitude, altitudeM(selected)) : undefined;
      const targetRange = target ? Cartesian3.distance(viewer.camera.positionWC, target) : undefined;
      const distance = targetRange ? Math.min(Math.max(targetRange * 0.3, 25), 2_000) : viewer.camera.positionCartographic.height * 0.4;
      viewer.camera.zoomOut(distance);
    },
    reset: () => { const viewer = viewerRef.current; if (viewer) aim(viewer, kind, kind === "us" ? JFK : location, false, preview); },
    flyTo: target => { const viewer = viewerRef.current; if (viewer) aim(viewer, kind, target, false, preview); },
    focusAircraft: item => {
      const viewer = viewerRef.current;
      if (!viewer || item.latitude === null || item.longitude === null) return;
      if (kind === "us") viewer.camera.flyTo({ destination: Rectangle.fromDegrees(item.longitude - 0.7, item.latitude - 0.5, item.longitude + 0.7, item.latitude + 0.5), duration: 1.1 });
      else {
        const target = Cartesian3.fromDegrees(item.longitude, item.latitude, altitudeM(item));
        viewer.camera.flyToBoundingSphere(new BoundingSphere(target, 0), { offset: new HeadingPitchRange(0, CesiumMath.toRadians(-35), 425), duration: 1.1 });
      }
    },
    search: async query => {
      const viewer = viewerRef.current;
      if (!viewer || !ionToken) throw new Error("Add a Cesium ion token to search beyond the listed airports and cities.");
      const service = new IonGeocoderService({ scene: viewer.scene, accessToken: ionToken });
      const results = await service.geocode(query);
      const result = results[0];
      if (!result) throw new Error("No matching place was found. Try an airport code or city name.");
      const destination = result.destination;
      let latitude: number, longitude: number;
      if (destination instanceof Rectangle) {
        const center = Rectangle.center(destination);
        latitude = CesiumMath.toDegrees(center.latitude);
        longitude = CesiumMath.toDegrees(center.longitude);
      } else {
        const point = Cartographic.fromCartesian(destination);
        latitude = CesiumMath.toDegrees(point.latitude);
        longitude = CesiumMath.toDegrees(point.longitude);
      }
      if (latitude < 24 || latitude > 50 || longitude < -125 || longitude > -66) throw new Error("Live area requests currently cover the contiguous United States.");
      aim(viewer, kind, { id: query, name: result.displayName, city: result.displayName, lat: latitude, lon: longitude }, false, preview);
      return { label: result.displayName, latitude, longitude };
    },
  }), [kind, location, preview]);

  useEffect(() => {
    if (!host.current) return;
    let active = true;
    const status: AssetStatus = { ...initialStatus, buildings: kind === "us" || preview ? "not_requested" : ionToken ? "loading" : "unavailable" };
    const report = (partial: Partial<AssetStatus>) => { Object.assign(status, partial); if (active) statusRef.current?.({ ...status }); };
    const viewer = new Viewer(host.current, {
      animation: false, baseLayerPicker: false, baseLayer: false, fullscreenButton: false,
      geocoder: false, homeButton: false, infoBox: false, navigationHelpButton: false,
      sceneModePicker: false, selectionIndicator: false, timeline: false,
      sceneMode: kind === "us" ? SceneMode.SCENE2D : SceneMode.SCENE3D,
      requestRenderMode: false,
    });
    viewerRef.current = viewer;
    viewer.scene.globe.baseColor = Color.fromCssColorString("#15283a");
    viewer.scene.backgroundColor = Color.fromCssColorString("#081523");
    viewer.scene.screenSpaceCameraController.enableTilt = kind === "local";
    aim(viewer, kind, kind === "us" ? JFK : location, true, preview);
    const reportBounds = () => {
      const rectangle = viewer.camera.computeViewRectangle();
      if (rectangle) boundsRef.current?.([CesiumMath.toDegrees(rectangle.south), CesiumMath.toDegrees(rectangle.west), CesiumMath.toDegrees(rectangle.north), CesiumMath.toDegrees(rectangle.east)]);
      reportVisibleRef.current();
    };
    viewer.camera.moveEnd.addEventListener(reportBounds);
    reportBounds();
    report({ message: ionToken ? null : "Cesium ion token missing. Showing a street map fallback without aerial imagery, terrain, or buildings." });

    const picker = new ScreenSpaceEventHandler(viewer.scene.canvas);
    picker.setInputAction((event: { position: Cartesian2 }) => {
      const picked = viewer.scene.pick(event.position);
      const id = picked?.id?.id;
      if (typeof id === "string" && id.startsWith("aircraft:")) selectRef.current?.(id.slice(9));
    }, ScreenSpaceEventType.LEFT_CLICK);

    void (async () => {
      let fallbackLayer: ImageryLayer | undefined;
      let osmLayer: ImageryLayer | undefined;
      try {
        const fallback = await TileMapServiceImageryProvider.fromUrl(buildModuleUrl("Assets/Textures/NaturalEarthII"));
        if (!active) return;
        fallbackLayer = viewer.imageryLayers.addImageryProvider(fallback);
        report({ imagery: "fallback", terrain: "ellipsoid" });
      } catch {
        report({ imagery: "error", terrain: "ellipsoid", message: "The bundled Natural Earth fallback could not load. Check local Cesium assets." });
      }
      try {
        const osm = new OpenStreetMapImageryProvider({
          url: "https://tile.openstreetmap.org/",
          credit: "© OpenStreetMap contributors",
          maximumLevel: 18,
        });
        if (!active) return;
        osmLayer = viewer.imageryLayers.addImageryProvider(osm);
        osmLayer.brightness = 0.54;
        osmLayer.contrast = 1.16;
        osmLayer.saturation = 0.62;
        let errors = 0;
        osm.errorEvent.addEventListener(() => {
          if (!active || !osmLayer || ++errors < 3) return;
          viewer.imageryLayers.remove(osmLayer);
          osmLayer = undefined;
          report({ imagery: fallbackLayer ? "fallback" : "error", message: "OpenStreetMap tiles could not load. The bundled Natural Earth map is shown instead." });
        });
        report({ imagery: "osm" });
      } catch {
        report({ imagery: fallbackLayer ? "fallback" : "error", message: "OpenStreetMap tiles could not load. The bundled Natural Earth map is shown instead." });
      }
      if (!ionToken) return;
      Ion.defaultAccessToken = ionToken;
      const [imagery, terrain] = await Promise.allSettled([createWorldImageryAsync(), createWorldTerrainAsync()]);
      if (!active) return;
      if (imagery.status === "fulfilled") {
        viewer.imageryLayers.addImageryProvider(imagery.value);
        if (osmLayer) viewer.imageryLayers.remove(osmLayer);
        if (fallbackLayer) viewer.imageryLayers.remove(fallbackLayer);
        report({ imagery: "ion", message: null });
      } else report({ imagery: osmLayer ? "osm" : fallbackLayer ? "fallback" : "error", message: safeIonMessage() });
      if (terrain.status === "fulfilled") {
        viewer.scene.setTerrain(new Terrain(Promise.resolve(terrain.value)));
        report({ terrain: "ion" });
      } else report({ terrain: "ellipsoid", message: safeIonMessage() });
      if (kind === "local" && !preview) {
        try {
          const buildings = await createOsmBuildingsAsync();
          if (!active) return;
          viewer.scene.primitives.add(buildings);
          report({ buildings: "ion" });
        } catch { report({ buildings: "unavailable", message: safeIonMessage() }); }
      }
    })();

    void (async () => {
      try {
        const testModel = await Model.fromGltfAsync({ url: modelUrl, show: false });
        testModel.destroy();
        if (active) { setModelReady(true); report({ model: "ready" }); }
      } catch {
        if (active) { setModelReady(false); report({ model: "fallback", message: "The local 3D aircraft model could not load. Aircraft symbols are shown instead." }); }
      }
    })();

    return () => { active = false; viewer.camera.moveEnd.removeEventListener(reportBounds); picker.destroy(); entitiesRef.current.clear(); trailsRef.current.clear(); motionRef.current.clear(); viewerRef.current = null; viewer.destroy(); };
  // A map is rebuilt only when switching Cesium scene modes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, preview]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer && kind === "local") aim(viewer, kind, location, false, preview);
  }, [kind, location, preview]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const seen = new Set<string>();
    for (const item of aircraft) {
      if (item.latitude === null || item.longitude === null) continue;
      const key = `aircraft:${item.id}`;
      seen.add(key);
      let entity = entitiesRef.current.get(key);
      const altitudeAvailable = item.geoAltitudeM !== null || item.baroAltitudeM !== null;
      const useModel = kind === "local" && modelReady && altitudeAvailable && item.trackDeg !== null;
      const altitude = altitudeM(item);
      const position = Cartesian3.fromDegrees(item.longitude, item.latitude, altitude);
      if (!entity) {
        entity = viewer.entities.add({ id: key });
        entitiesRef.current.set(key, entity);
      }
      const canAnimate = animatePositions && item.groundSpeedMs !== null && item.trackDeg !== null
        && (item.kind === "simulated" || item.positionKind === "estimated");
      if (canAnimate) {
        const now = performance.now();
        const previous = motionRef.current.get(key);
        const rate = Math.max(0, motionRate);
        const changed = !previous || previous.sourceLatitude !== item.latitude || previous.sourceLongitude !== item.longitude
          || previous.sourceAltitudeM !== altitude || previous.sourceGroundSpeedMs !== item.groundSpeedMs
          || previous.sourceTrackDeg !== item.trackDeg || previous.sourcePositionTime !== item.positionTime
          || previous.sourcePositionKind !== item.positionKind || previous.rate !== rate;
        if (changed) {
          const previousPosition = previous ? motionPosition(previous, now) : null;
          const rateChanged = Boolean(previous && previous.rate !== rate);
          const anchorLatitude = rateChanged && previousPosition ? previousPosition.latitude : item.latitude;
          const anchorLongitude = rateChanged && previousPosition ? previousPosition.longitude : item.longitude;
          motionRef.current.set(key, {
            latitude: anchorLatitude, longitude: anchorLongitude, altitudeM: altitude,
            groundSpeedMs: item.groundSpeedMs!, trackDeg: item.trackDeg!, rate, startedAt: now,
            correctionLatitude: !rateChanged && previousPosition ? previousPosition.latitude - item.latitude : 0,
            correctionLongitude: !rateChanged && previousPosition ? longitudeDelta(previousPosition.longitude, item.longitude) : 0,
            sourceLatitude: item.latitude, sourceLongitude: item.longitude, sourceAltitudeM: altitude,
            sourceGroundSpeedMs: item.groundSpeedMs!, sourceTrackDeg: item.trackDeg!,
            sourcePositionTime: item.positionTime, sourcePositionKind: item.positionKind,
          });
        }
        if (!(entity.position instanceof CallbackPositionProperty)) {
          entity.position = new CallbackPositionProperty((_time, result) => {
            const state = motionRef.current.get(key);
            if (!state) return Cartesian3.clone(position, result);
            const point = motionPosition(state, performance.now());
            return Cartesian3.fromDegrees(point.longitude, point.latitude, point.altitudeM, undefined, result);
          }, false);
        }
      } else {
        motionRef.current.delete(key);
        entity.position = new ConstantPositionProperty(position);
      }
      if (useModel && !entity.model) {
        entity.model = new ModelGraphics({ uri: modelUrl, scale: 1 });
      } else if (useModel && entity.model) {
        entity.model.silhouetteSize = new ConstantProperty(0);
      } else if (!useModel && entity.model) entity.model = undefined;
      if (item.trackDeg !== null) {
        entity.orientation = new ConstantProperty(Transforms.headingPitchRollQuaternion(position, new HeadingPitchRoll(cesiumHeadingFromTrackDeg(item.trackDeg), 0, 0)));
      } else {
        entity.orientation = undefined;
      }
      addOrUpdateBillboard(entity, item, kind, selectedId === item.id, modelReady);
      entity.description = undefined;
    }
  for (const [key, entity] of entitiesRef.current) if (!seen.has(key)) { viewer.entities.remove(entity); entitiesRef.current.delete(key); motionRef.current.delete(key); }

    const showTrail = (id: string) => paths === "all" || paths === "selected" && selectedId === id;
    const seenTrails = new Set<string>();
    if (paths !== "off") for (const [id, points] of Object.entries(trails)) {
      if (!showTrail(id) || points.length < 2) continue;
      const key = `trail:${id}`;
      seenTrails.add(key);
      const positions = points.map(p => Cartesian3.fromDegrees(p.longitude, p.latitude, p.altitudeM ?? 0));
      let line = trailsRef.current.get(key);
      if (!line) {
        line = viewer.entities.add({ id: key, polyline: { positions, width: id === selectedId ? 2.5 : 1, material: Color.fromCssColorString(id === selectedId ? "#d5ff36" : aircraft.find(a => a.id === id)?.kind === "simulated" ? "#b39cff88" : "#77bace88") } });
        trailsRef.current.set(key, line);
      } else if (line.polyline) {
        line.polyline.positions = new ConstantProperty(positions);
        line.polyline.width = new ConstantProperty(id === selectedId ? 2.5 : 1);
      }
    }
    for (const [key, line] of trailsRef.current) if (!seenTrails.has(key)) { viewer.entities.remove(line); trailsRef.current.delete(key); }
    reportVisibleRef.current();

  }, [aircraft, trails, selectedId, paths, kind, modelReady, animatePositions, motionRate]);

  return <div className="cesium-map" ref={host} aria-label={`${kind === "us" ? "United States 2D" : "Local 3D"} interactive Cesium map`} />;
});
