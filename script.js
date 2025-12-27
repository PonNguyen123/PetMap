/* =========================================================
   PetNourish – Map-First MVP (Full JS)
   Features:
   - GPS permission overlay + demo fallback
   - OpenStreetMap map via Leaflet
   - Destination search via Nominatim
   - Places (Pet stores + Animal hospitals) via Overpass API (with fallbacks)
   - BLUE route (user -> destination)
   - YELLOW fake traffic under BLUE (thicker)
   - RED route (user -> selected suggested stop)
   - Fullscreen map toggle + my-location button
   - Tabs (Map / Food / Care)
   - Dark mode toggle
   - Concept account menu + switch user
   - Food demo grid + simple filters
   - Pet profile modal save + summary
   ========================================================= */

/* -------------------------
   Helpers
-------------------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function toast(msg) {
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function distMeters(a, b) {
  // a,b: {lat,lng}
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function formatMeters(m) {
  if (m >= 1000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m)} m`;
}

/* -------------------------
   State
-------------------------- */
let map = null;
let userLatLng = null;

let userMarker = null;
let destMarker = null;

let placeMarkersLayer = null;

let searchResults = [];
let nearbyPlacesCache = []; // places near user (for quick list)
let routePlacesCache = []; // places along route

// Routing controls & lines
let routeControlBlue = null;
let routeControlRed = null;

let blueLine = null;
let trafficLine = null;

let redLine = null;
let redLineShadow = null;

// Fullscreen state
let isMapExpanded = false;

// Current destination
let currentDestination = null; // {name, lat, lng}

// DOM elements
const els = {
  gpsOverlay: $("#gps-overlay"),
  allowGps: $("#btn-allow-gps"),
  skipGps: $("#btn-skip-gps"),

  themeToggle: $("#theme-toggle"),

  accountBtn: $("#account-btn"),
  accountMenu: $("#account-menu"),
  accountName: $("#account-name"),
  accountMenuName: $("#account-menu-name"),
  switchUserBtn: $("#switch-user-btn"),

  tabMap: $("#tab-map"),
  tabFood: $("#tab-food"),
  tabCare: $("#tab-care"),
  viewMap: $("#view-map"),
  viewFood: $("#view-food"),
  viewCare: $("#view-care"),

  btnMyLocation: $("#btn-my-location"),
  btnFullscreen: $("#btn-fullscreen"),
  btnExitFullscreen: $("#btn-exit-fullscreen"),

  destInput: $("#dest-input"),
  btnDestSearch: $("#btn-dest-search"),
  searchResults: $("#search-results"),
  btnStartRoute: $("#btn-start-route"),
  btnClearRoute: $("#btn-clear-route"),

  stopsList: $("#stops-list"),
  stopsHelper: $("#stops-helper"),

  // Food & profile
  btnOpenProfile: $("#btn-open-profile"),
  profileModal: $("#profile-modal"),
  btnCloseProfile: $("#btn-close-profile"),
  btnCancelProfile: $("#btn-cancel-profile"),
  petForm: $("#pet-form"),
  weightInput: $("#weight"),
  weightError: $("#weight-error"),
  profileSummary: $("#profile-summary"),

  foodGrid: $("#food-grid"),
  foodSearch: $("#food-search"),
  foodSpecies: $("#food-species"),
  foodBudget: $("#food-budget"),

  // Care
  sittersBtn: $("#sitters-search-btn"),
  sittersList: $("#sitters-list"),
  sittersType: $("#sitters-type"),
  sittersLocation: $("#sitters-location"),
};

/* -------------------------
   Theme
: dark mode
-------------------------- */
function loadTheme() {
  const saved = localStorage.getItem("pn_theme") || "light";
  document.body.classList.toggle("theme-dark", saved === "dark");
}
function toggleTheme() {
  const isDark = document.body.classList.toggle("theme-dark");
  localStorage.setItem("pn_theme", isDark ? "dark" : "light");
}
if (els.themeToggle) {
  els.themeToggle.addEventListener("click", toggleTheme);
}
loadTheme();

/* -------------------------
   Account: concept login
-------------------------- */
function loadUser() {
  const saved = localStorage.getItem("pn_user_name") || "Guest";
  if (els.accountName) els.accountName.textContent = saved;
  if (els.accountMenuName) els.accountMenuName.textContent = saved;
}
function showAccountMenu(show) {
  if (!els.accountMenu) return;
  els.accountMenu.classList.toggle("show", !!show);
}
if (els.accountBtn && els.accountMenu) {
  els.accountBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    showAccountMenu(!els.accountMenu.classList.contains("show"));
  });
  document.addEventListener("click", () => showAccountMenu(false));
}
if (els.switchUserBtn) {
  els.switchUserBtn.addEventListener("click", () => {
    localStorage.removeItem("pn_user_name");
    loadUser();
    toast("Switched user (concept). Refresh to re-enter name if you add it later.");
    showAccountMenu(false);
  });
}
loadUser();

/* -------------------------
   Tabs
-------------------------- */
function setActiveTab(tab) {
  // tab: "map" | "food" | "care"
  const isMap = tab === "map";
  const isFood = tab === "food";
  const isCare = tab === "care";

  els.tabMap?.classList.toggle("tab-btn--active", isMap);
  els.tabFood?.classList.toggle("tab-btn--active", isFood);
  els.tabCare?.classList.toggle("tab-btn--active", isCare);

  els.viewMap?.classList.toggle("view--active", isMap);
  els.viewFood?.classList.toggle("view--active", isFood);
  els.viewCare?.classList.toggle("view--active", isCare);

  // Leaflet needs resize when view changes
  if (isMap && map) {
    setTimeout(() => map.invalidateSize(true), 150);
  }
}
els.tabMap?.addEventListener("click", () => setActiveTab("map"));
els.tabFood?.addEventListener("click", () => setActiveTab("food"));
els.tabCare?.addEventListener("click", () => setActiveTab("care"));

/* -------------------------
   Map init
-------------------------- */
function initMap(centerLatLng) {
  if (map) return;

  map = L.map("map", {
    zoomControl: true,
    preferCanvas: true,
  }).setView([centerLatLng.lat, centerLatLng.lng], 14);

  // OSM tiles
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  // Layer for place markers
  placeMarkersLayer = L.layerGroup().addTo(map);

  // Panes to control draw order
  map.createPane("trafficPane");
  map.getPane("trafficPane").style.zIndex = 410; // under route

  map.createPane("routePane");
  map.getPane("routePane").style.zIndex = 420; // blue above yellow

  map.createPane("detourPane");
  map.getPane("detourPane").style.zIndex = 430; // red on top

  // My location button
  els.btnMyLocation?.addEventListener("click", () => {
    if (!userLatLng) return toast("Location not ready yet.");
    map.setView([userLatLng.lat, userLatLng.lng], 16, { animate: true });
  });

  // Fullscreen toggle
  els.btnFullscreen?.addEventListener("click", () => setMapFullscreen(true));
  els.btnExitFullscreen?.addEventListener("click", () => setMapFullscreen(false));

  // Clear route
  els.btnClearRoute?.addEventListener("click", clearAllRoutes);

  // Start route
  els.btnStartRoute?.addEventListener("click", () => {
    if (!currentDestination) return toast("Pick a destination first.");
    startRouteToDestination(currentDestination);
  });

  // Destination search
  els.btnDestSearch?.addEventListener("click", searchDestination);
  els.destInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      searchDestination();
    }
  });

  // Also click on map to close search results quickly
  map.on("click", () => {
    renderSearchResults([]);
  });
}

function setMapFullscreen(on) {
  const mapEl = $("#map");
  if (!mapEl) return;

  isMapExpanded = !!on;

  if (on) {
    document.body.classList.add("map-expanded-lock");
    mapEl.classList.add("map-expanded");
    els.btnExitFullscreen?.classList.add("show");
  } else {
    document.body.classList.remove("map-expanded-lock");
    mapEl.classList.remove("map-expanded");
    els.btnExitFullscreen?.classList.remove("show");
  }

  // Leaflet must recalc size
  if (map) setTimeout(() => map.invalidateSize(true), 200);
}

/* -------------------------
   GPS flow
-------------------------- */
function closeGpsOverlay() {
  if (els.gpsOverlay) els.gpsOverlay.style.display = "none";
}

async function getBrowserGps() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("No geolocation"));
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
      },
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

// Demo fallback: HCMC center-ish
const DEMO_HCMC = { lat: 10.7769, lng: 106.7009 };

async function startWithLocation(loc) {
  userLatLng = { lat: loc.lat, lng: loc.lng };

  initMap(userLatLng);

  // Marker
  if (!userMarker) {
    userMarker = L.marker([userLatLng.lat, userLatLng.lng], {
      title: "You are here",
    }).addTo(map);
  } else {
    userMarker.setLatLng([userLatLng.lat, userLatLng.lng]);
  }

  map.setView([userLatLng.lat, userLatLng.lng], 15, { animate: true });

  // Load nearby places immediately
  await loadNearbyPlaces(userLatLng.lat, userLatLng.lng);

  closeGpsOverlay();
  toast("Map ready. Nearby places loaded.");
}

if (els.allowGps) {
  els.allowGps.addEventListener("click", async () => {
    try {
      els.allowGps.classList.add("is-loading");
      const loc = await getBrowserGps();
      await startWithLocation(loc);
    } catch (e) {
      toast("GPS blocked. Using demo location in HCMC.");
      await startWithLocation(DEMO_HCMC);
    } finally {
      els.allowGps.classList.remove("is-loading");
    }
  });
}

if (els.skipGps) {
  els.skipGps.addEventListener("click", async () => {
    toast("Using demo location in HCMC.");
    await startWithLocation(DEMO_HCMC);
  });
}

/* -------------------------
   Destination Search (Nominatim)
-------------------------- */
async function searchDestination() {
  const q = (els.destInput?.value || "").trim();
  if (!q) return toast("Type a destination first.");

  // Add city bias (HCMC) to help results
  const query = encodeURIComponent(q + " Ho Chi Minh City");

  els.btnDestSearch?.classList.add("is-loading");
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=6&q=${query}`;
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json",
        // Nominatim etiquette: identify app (best effort)
        "User-Agent": "PetNourish-MVP/1.0 (demo)",
        "Referer": location.href
      }
    });
    if (!res.ok) throw new Error("Search failed");
    const data = await res.json();

    searchResults = (data || []).map((d) => ({
      name: d.display_name,
      lat: parseFloat(d.lat),
      lng: parseFloat(d.lon),
      type: d.type || "place",
    }));

    renderSearchResults(searchResults);
    if (!searchResults.length) toast("No results. Try another keyword.");
  } catch (e) {
    toast("Search error. Try again.");
    renderSearchResults([]);
  } finally {
    els.btnDestSearch?.classList.remove("is-loading");
  }
}

function renderSearchResults(list) {
  if (!els.searchResults) return;
  els.searchResults.innerHTML = "";

  if (!list || !list.length) {
    els.searchResults.innerHTML = `<div class="search-empty">No search results yet.</div>`;
    return;
  }

  list.forEach((item, idx) => {
    const btn = document.createElement("button");
    btn.className = "search-item";
    btn.type = "button";
    btn.innerHTML = `
      <div class="search-item__title">${escapeHtml(item.name.split(",")[0] || item.name)}</div>
      <div class="search-item__sub">${escapeHtml(item.name)}</div>
    `;
    btn.addEventListener("click", () => {
      pickDestination(item);
      renderSearchResults([]); // collapse results after picking
    });
    els.searchResults.appendChild(btn);
  });
}

function pickDestination(dest) {
  currentDestination = dest;

  if (!map) return;

  // Dest marker
  if (!destMarker) {
    destMarker = L.marker([dest.lat, dest.lng], { title: "Destination" }).addTo(map);
  } else {
    destMarker.setLatLng([dest.lat, dest.lng]);
  }

  map.setView([dest.lat, dest.lng], 14, { animate: true });
  toast("Destination selected. Press Start Route.");
}

/* -------------------------
   Overpass (Places)
   Pet stores + vets in HCMC region (near user + along route)
-------------------------- */
async function overpassQuery(query) {
  const endpoints = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
  ];

  let lastErr = null;
  for (const endpoint of endpoints) {
    try {
      const url = endpoint + "?data=" + encodeURIComponent(query);
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("Overpass " + res.status);
      return await res.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("All Overpass endpoints failed");
}

function toPlace(el) {
  const tags = el.tags || {};
  const name = tags.name || "Unnamed place";

  // Coordinates can be in el.lat/el.lon (node) or el.center (way/relation)
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  if (typeof lat !== "number" || typeof lng !== "number") return null;

  // classify
  const isVet =
    tags.amenity === "veterinary" ||
    tags.healthcare === "veterinary" ||
    tags.healthcare === "animal_hospital" ||
    tags.amenity === "animal_hospital";

  const isPetShop =
    tags.shop === "pet" ||
    tags.shop === "pet_grooming" ||
    tags.shop === "animal_feed" ||
    tags.shop === "feed" ||
    tags.shop === "pet_supply";

  const kind = isVet ? "vet" : isPetShop ? "shop" : "other";
  const emoji = kind === "vet" ? "🏥" : "🛍️";

  const addrBits = [];
  if (tags["addr:housenumber"]) addrBits.push(tags["addr:housenumber"]);
  if (tags["addr:street"]) addrBits.push(tags["addr:street"]);
  if (tags["addr:district"]) addrBits.push(tags["addr:district"]);
  if (tags["addr:city"]) addrBits.push(tags["addr:city"]);
  const address = addrBits.join(", ");

  return {
    id: `${el.type}/${el.id}`,
    name,
    lat,
    lng,
    kind,
    emoji,
    address: address || tags["addr:full"] || tags["contact:address"] || "",
  };
}

function clearPlaceMarkers() {
  if (!placeMarkersLayer) return;
  placeMarkersLayer.clearLayers();
}

function addPlaceMarker(place) {
  if (!map || !placeMarkersLayer) return;

  const icon = L.divIcon({
    className: "emoji-marker",
    html: `<div class="emoji-pin">${place.emoji}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });

  const marker = L.marker([place.lat, place.lng], { icon }).addTo(placeMarkersLayer);

  const badge = place.kind === "vet" ? "Animal hospital" : "Pet store";
  const addr = place.address ? `<div style="font-size:12px;color:#666;margin-top:4px;">${escapeHtml(place.address)}</div>` : "";
  marker.bindPopup(`
    <div style="min-width:220px;">
      <div style="font-weight:700;">${escapeHtml(place.name)}</div>
      <div style="font-size:12px;margin-top:2px;">${badge}</div>
      ${addr}
      <button class="popup-btn" data-route-stop="${place.id}">Route here (RED)</button>
    </div>
  `);

  marker.on("popupopen", () => {
    // attach click for popup button
    setTimeout(() => {
      const btn = document.querySelector(`[data-route-stop="${CSS.escape(place.id)}"]`);
      if (btn) {
        btn.addEventListener("click", () => {
          routeToStop(place);
          marker.closePopup();
        });
      }
    }, 0);
  });

  return marker;
}

async function loadNearbyPlaces(lat, lng) {
  if (!map) return;

  els.stopsHelper && (els.stopsHelper.textContent = "Loading nearby pet stores & animal hospitals…");

  // radius meters
  const radius = 2500;

  // Overpass query: pet shops + veterinary near point
  const q = `
  [out:json][timeout:25];
  (
    node["shop"="pet"](around:${radius},${lat},${lng});
    way["shop"="pet"](around:${radius},${lat},${lng});
    relation["shop"="pet"](around:${radius},${lat},${lng});

    node["amenity"="veterinary"](around:${radius},${lat},${lng});
    way["amenity"="veterinary"](around:${radius},${lat},${lng});
    relation["amenity"="veterinary"](around:${radius},${lat},${lng});
  );
  out center tags;
  `;

  try {
    const data = await overpassQuery(q);
    const raw = (data?.elements || []).map(toPlace).filter(Boolean);
    const filtered = raw.filter(p => p.kind === "shop" || p.kind === "vet");

    // Sort by distance
    filtered.sort((a, b) => distMeters(userLatLng, a) - distMeters(userLatLng, b));

    // Cache
    nearbyPlacesCache = filtered;

    // Draw markers (nearby)
    clearPlaceMarkers();
    filtered.slice(0, 30).forEach(addPlaceMarker);

    // Render quick list
    renderStopsList(filtered.slice(0, 10), { mode: "nearby" });

    els.stopsHelper && (els.stopsHelper.textContent =
      filtered.length
        ? "Nearby suggestions loaded. Pick a destination for route-based suggestions."
        : "No nearby places found. Try another area or zoom out."
    );

  } catch (e) {
    els.stopsHelper && (els.stopsHelper.textContent =
      "Overpass is busy. Try again or use destination first."
    );
    toast("Couldn’t load places right now (Overpass busy).");
    renderStopsList([], { mode: "nearby" });
  }
}

/* -------------------------
   Route: BLUE + YELLOW (fake traffic)
-------------------------- */
function clearBlueYellow() {
  if (routeControlBlue) {
    map.removeControl(routeControlBlue);
    routeControlBlue = null;
  }
  if (blueLine) { map.removeLayer(blueLine); blueLine = null; }
  if (trafficLine) { map.removeLayer(trafficLine); trafficLine = null; }
}

function clearRed() {
  if (routeControlRed) {
    map.removeControl(routeControlRed);
    routeControlRed = null;
  }
  if (redLine) { map.removeLayer(redLine); redLine = null; }
  if (redLineShadow) { map.removeLayer(redLineShadow); redLineShadow = null; }
}

function clearAllRoutes() {
  clearBlueYellow();
  clearRed();
  if (destMarker) { map.removeLayer(destMarker); destMarker = null; }
  currentDestination = null;
  if (els.destInput) els.destInput.value = "";
  renderSearchResults([]);
  // show nearby again
  renderStopsList(nearbyPlacesCache.slice(0, 10), { mode: "nearby" });
  els.stopsHelper && (els.stopsHelper.textContent =
    "Cleared. Nearby suggestions are shown again."
  );
  toast("Routes cleared.");
}

function startRouteToDestination(dest) {
  if (!map || !userLatLng) return toast("Location not ready.");
  if (!dest) return toast("No destination selected.");

  clearBlueYellow();
  clearRed(); // keep it clean when starting new trip

  // Use Routing Machine to get route coordinates, then draw our own polylines (for control of style/panes)
  routeControlBlue = L.Routing.control({
    waypoints: [
      L.latLng(userLatLng.lat, userLatLng.lng),
      L.latLng(dest.lat, dest.lng)
    ],
    addWaypoints: false,
    draggableWaypoints: false,
    fitSelectedRoutes: false,
    show: false,
    routeWhileDragging: false,
    lineOptions: { styles: [] } // draw ourselves
  }).addTo(map);

  routeControlBlue.on("routesfound", async (e) => {
    const route = e.routes?.[0];
    if (!route) return toast("No route found.");

    const coords = route.coordinates.map(c => ({ lat: c.lat, lng: c.lng }));

    // Fake traffic: make a slightly jittered polyline from the route
    const trafficCoords = coords.map((p, i) => {
      const jitter = (i % 7 === 0) ? 0.00018 : (i % 11 === 0 ? -0.00014 : 0);
      return [p.lat + jitter, p.lng - jitter];
    });

    // Convert route coords for Leaflet polyline
    const lineCoords = coords.map(p => [p.lat, p.lng]);

    // 1) YELLOW underlay (bigger) – pane trafficPane
    trafficLine = L.polyline(trafficCoords, {
      pane: "trafficPane",
      color: "#F3C548",
      weight: 12,             // BIGGER than blue
      opacity: 0.75,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(map);

    // 2) BLUE route on top – pane routePane
    blueLine = L.polyline(lineCoords, {
      pane: "routePane",
      color: "#2E78FF",
      weight: 7,
      opacity: 0.96,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(map);

    // Ensure stacking
    trafficLine.bringToBack();
    blueLine.bringToFront();

    // Fit view
    map.fitBounds(L.latLngBounds(lineCoords).pad(0.18));

    toast("Blue route + yellow traffic highlight created.");

    // Load route-based suggestions (places around the route)
    await loadPlacesAlongRoute(coords);
  });

  routeControlBlue.on("routingerror", () => toast("Routing failed. Try another destination."));
}

/* -------------------------
   Places along route
   Strategy (simple + reliable):
   - sample route points every N steps
   - query Overpass around each point (small radius)
   - merge unique places, sort by distance to route
-------------------------- */
async function loadPlacesAlongRoute(routePoints) {
  if (!userLatLng || !routePoints?.length) return;

  els.stopsHelper && (els.stopsHelper.textContent = "Finding suggestions along your route…");

  // sample points (reduce queries)
  const sampleEvery = Math.max(12, Math.floor(routePoints.length / 10));
  const samples = [];
  for (let i = 0; i < routePoints.length; i += sampleEvery) {
    samples.push(routePoints[i]);
  }
  // always include near end
  samples.push(routePoints[routePoints.length - 1]);

  const radius = 700;

  // build one query with multiple around points (faster than many calls)
  // Use union of circles:
  const parts = samples.map(p => `
    node["shop"="pet"](around:${radius},${p.lat},${p.lng});
    way["shop"="pet"](around:${radius},${p.lat},${p.lng});
    relation["shop"="pet"](around:${radius},${p.lat},${p.lng});
    node["amenity"="veterinary"](around:${radius},${p.lat},${p.lng});
    way["amenity"="veterinary"](around:${radius},${p.lat},${p.lng});
    relation["amenity"="veterinary"](around:${radius},${p.lat},${p.lng});
  `).join("\n");

  const q = `
  [out:json][timeout:25];
  (
    ${parts}
  );
  out center tags;
  `;

  try {
    const data = await overpassQuery(q);
    const raw = (data?.elements || []).map(toPlace).filter(Boolean);
    const filtered = raw.filter(p => p.kind === "shop" || p.kind === "vet");

    // Deduplicate by id
    const seen = new Set();
    const unique = [];
    for (const p of filtered) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      unique.push(p);
    }

    // sort by distance from user (simple MVP)
    unique.sort((a, b) => distMeters(userLatLng, a) - distMeters(userLatLng, b));

    routePlacesCache = unique;

    // show on map (keep markers from nearby; we already cleared markers when loading nearby)
    // We will add extra markers but not clear existing to avoid flicker:
    // (If you want, clear then re-add both caches)
    unique.slice(0, 25).forEach(addPlaceMarker);

    // Render route suggestions list
    renderStopsList(unique.slice(0, 12), { mode: "route" });

    els.stopsHelper && (els.stopsHelper.textContent =
      unique.length
        ? "Tap a suggested place to draw RED route from you."
        : "No route suggestions found. Try zooming out or another destination."
    );

  } catch (e) {
    els.stopsHelper && (els.stopsHelper.textContent =
      "Couldn’t fetch route suggestions (Overpass busy). Showing nearby instead."
    );
    renderStopsList(nearbyPlacesCache.slice(0, 10), { mode: "nearby" });
    toast("Suggestions temporarily unavailable (Overpass busy).");
  }
}

/* -------------------------
   Stops UI + RED route
-------------------------- */
function renderStopsList(stops, opts = {}) {
  const listEl = els.stopsList;
  if (!listEl) return;

  listEl.innerHTML = "";

  if (!stops || !stops.length) {
    listEl.innerHTML = `<div class="stop-empty">No suggestions yet.</div>`;
    return;
  }

  stops.forEach((p) => {
    const d = userLatLng ? distMeters(userLatLng, p) : null;

    const card = document.createElement("div");
    card.className = "stop-card";
    card.tabIndex = 0;
    card.innerHTML = `
      <div class="stop-emoji">${p.emoji}</div>
      <div class="stop-main">
        <div class="stop-name">${escapeHtml(p.name)}</div>
        <div class="stop-sub">${p.kind === "vet" ? "Animal hospital" : "Pet store"} • ${d != null ? formatMeters(d) : ""}</div>
        <div class="stop-addr">${p.address ? escapeHtml(p.address) : ""}</div>
      </div>
      <div class="stop-action">RED</div>
    `;

    card.addEventListener("click", () => routeToStop(p));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        routeToStop(p);
      }
    });

    listEl.appendChild(card);
  });
}

function routeToStop(stop) {
  if (!map || !userLatLng) return toast("Location not ready.");

  clearRed();

  // Routing for stop, then draw our own red polyline for strong visibility
  routeControlRed = L.Routing.control({
    waypoints: [
      L.latLng(userLatLng.lat, userLatLng.lng),
      L.latLng(stop.lat, stop.lng),
    ],
    addWaypoints: false,
    draggableWaypoints: false,
    fitSelectedRoutes: false,
    show: false,
    routeWhileDragging: false,
    lineOptions: { styles: [] }
  }).addTo(map);

  routeControlRed.on("routesfound", (e) => {
    const route = e.routes?.[0];
    if (!route) return;

    const coords = route.coordinates.map(c => [c.lat, c.lng]);

    // shadow under red line
    redLineShadow = L.polyline(coords, {
      pane: "detourPane",
      color: "rgba(0,0,0,0.25)",
      weight: 9,
      opacity: 0.8,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(map);

    // main red line
    redLine = L.polyline(coords, {
      pane: "detourPane",
      color: "#E44B4B",
      weight: 6,
      opacity: 0.98,
      lineCap: "round",
      lineJoin: "round"
    }).addTo(map);

    map.fitBounds(L.latLngBounds(coords).pad(0.15));
    toast("Red route created to selected place.");
  });

  routeControlRed.on("routingerror", () => toast("Couldn’t route to that place."));
}

/* -------------------------
   Food (demo shell)
   You said later we can remake like before.
-------------------------- */
const FOOD_DATA = [
  { id: "f1", name: "Salmon Gentle Bites", species: "cat", budget: "premium", tags: ["sensitive", "skin"], price: 320000 },
  { id: "f2", name: "Chicken Daily Balance", species: "dog", budget: "mid", tags: ["adult"], price: 180000 },
  { id: "f3", name: "Senior Joint Support", species: "dog", budget: "premium", tags: ["senior", "joint"], price: 350000 },
  { id: "f4", name: "Kitten Growth Formula", species: "cat", budget: "mid", tags: ["puppy", "growth"], price: 210000 },
  { id: "f5", name: "Value Beef Crunch", species: "dog", budget: "value", tags: ["value"], price: 120000 },
  { id: "f6", name: "Grain-Free Duck & Pea", species: "cat", budget: "premium", tags: ["allergy"], price: 360000 },
];

function vnd(n) {
  try {
    return new Intl.NumberFormat("vi-VN").format(n) + "₫";
  } catch {
    return n + "₫";
  }
}

function renderFood() {
  if (!els.foodGrid) return;

  const q = (els.foodSearch?.value || "").trim().toLowerCase();
  const sp = els.foodSpecies?.value || "any";
  const budget = els.foodBudget?.value || "any";

  let list = FOOD_DATA.slice();

  if (q) {
    list = list.filter(f =>
      f.name.toLowerCase().includes(q) ||
      f.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  if (sp !== "any") list = list.filter(f => f.species === sp);
  if (budget !== "any") list = list.filter(f => f.budget === budget);

  els.foodGrid.innerHTML = "";

  if (!list.length) {
    els.foodGrid.innerHTML = `<div class="search-empty">No foods match your filters.</div>`;
    return;
  }

  const likes = JSON.parse(localStorage.getItem("pn_food_likes") || "{}");

  list.forEach(f => {
    const liked = likes[f.id] || "none"; // none | like | love
    const card = document.createElement("div");
    card.className = "food-card";
    card.innerHTML = `
      <div class="food-head">
        <div class="food-title">${escapeHtml(f.name)}</div>
        <div class="food-price">${vnd(f.price)}</div>
      </div>
      <div class="food-tags">
        <span class="chip">${f.species === "cat" ? "Best for cats" : "Best for dogs"}</span>
        <span class="chip">${f.budget}</span>
        ${f.tags.slice(0, 2).map(t => `<span class="chip">${escapeHtml(t)}</span>`).join("")}
      </div>
      <div class="food-actions">
        <button class="btn btn-secondary" type="button" data-like="${f.id}">
          ${liked === "like" ? "👍 Liked" : "👍 Like"}
        </button>
        <button class="btn btn-secondary" type="button" data-love="${f.id}">
          ${liked === "love" ? "❤️ Loved" : "❤️ Love"}
        </button>
      </div>
      <p class="helper-text">Concept: We’d alert you when this is on sale near your map route.</p>
    `;

    card.querySelector(`[data-like="${f.id}"]`)?.addEventListener("click", () => {
      likes[f.id] = (likes[f.id] === "like") ? "none" : "like";
      localStorage.setItem("pn_food_likes", JSON.stringify(likes));
      toast("Saved (concept).");
      renderFood();
    });

    card.querySelector(`[data-love="${f.id}"]`)?.addEventListener("click", () => {
      likes[f.id] = (likes[f.id] === "love") ? "none" : "love";
      localStorage.setItem("pn_food_likes", JSON.stringify(likes));
      toast("Saved (concept).");
      renderFood();
    });

    els.foodGrid.appendChild(card);
  });
}

els.foodSearch?.addEventListener("input", renderFood);
els.foodSpecies?.addEventListener("change", renderFood);
els.foodBudget?.addEventListener("change", renderFood);
renderFood();

/* -------------------------
   Pet Profile modal (optional)
-------------------------- */
function openProfileModal() {
  if (!els.profileModal) return;
  els.profileModal.classList.add("show");
  els.profileModal.setAttribute("aria-hidden", "false");
}
function closeProfileModal() {
  if (!els.profileModal) return;
  els.profileModal.classList.remove("show");
  els.profileModal.setAttribute("aria-hidden", "true");
}

els.btnOpenProfile?.addEventListener("click", openProfileModal);
els.btnCloseProfile?.addEventListener("click", closeProfileModal);
els.btnCancelProfile?.addEventListener("click", closeProfileModal);

function loadProfile() {
  const saved = JSON.parse(localStorage.getItem("pn_pet_profile") || "null");
  if (!saved) {
    if (els.profileSummary) els.profileSummary.innerHTML = "";
    return null;
  }

  // Fill form fields if present
  $("#petName") && ($("#petName").value = saved.petName || "");
  $("#species") && ($("#species").value = saved.species || "dog");
  $("#ageCategory") && ($("#ageCategory").value = saved.ageCategory || "adult");
  $("#weight") && ($("#weight").value = saved.weight || "");
  $("#activity") && ($("#activity").value = saved.activity || "normal");
  $("#health") && ($("#health").value = saved.health || "none");
  $("#budget") && ($("#budget").value = saved.budget || "mid");

  // Summary chip
  if (els.profileSummary) {
    const bits = [
      saved.petName ? `🐾 ${saved.petName}` : "🐾 Pet",
      saved.species === "cat" ? "Cat" : "Dog",
      saved.ageCategory || "adult",
      saved.health && saved.health !== "none" ? saved.health : "no special needs",
      saved.budget || "mid"
    ];
    els.profileSummary.innerHTML = `
      <div class="profile-chip">${bits.map(escapeHtml).join(" • ")}</div>
    `;
  }

  return saved;
}

loadProfile();

if (els.petForm) {
  els.petForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const petName = ($("#petName")?.value || "").trim();
    const species = $("#species")?.value || "dog";
    const ageCategory = $("#ageCategory")?.value || "adult";
    const weight = parseFloat($("#weight")?.value || "0");
    const activity = $("#activity")?.value || "normal";
    const health = $("#health")?.value || "none";
    const budget = $("#budget")?.value || "mid";

    // validate weight if provided
    if ($("#weight")?.value.trim() && (!Number.isFinite(weight) || weight <= 0)) {
      $("#weight")?.classList.add("has-error");
      els.weightError && (els.weightError.hidden = false);
      return;
    } else {
      $("#weight")?.classList.remove("has-error");
      els.weightError && (els.weightError.hidden = true);
    }

    const profile = { petName, species, ageCategory, weight: $("#weight")?.value.trim() ? weight : "", activity, health, budget };
    localStorage.setItem("pn_pet_profile", JSON.stringify(profile));
    loadProfile();
    closeProfileModal();
    toast("Pet profile saved (concept).");
  });
}

/* -------------------------
   Care Help (sitters demo)
-------------------------- */
const SITTERS = [
  { name: "Mai", rating: "4.9", tags: ["Great with seniors", "Home visit"], note: "Calm, patient, sends photo updates." },
  { name: "Khanh", rating: "4.7", tags: ["Best for cats", "Boarding"], note: "Quiet space, experienced with shy cats." },
  { name: "Linh", rating: "4.8", tags: ["Dogs", "Active walks"], note: "Can do extra walks and playtime." },
  { name: "Tuan", rating: "4.6", tags: ["Budget friendly", "Home visit"], note: "Simple visits, feeding + cleanup." },
];

function renderSitters() {
  if (!els.sittersList) return;
  const type = els.sittersType?.value || "any";
  const loc = (els.sittersLocation?.value || "").trim();

  // fake filter
  let list = SITTERS.slice();
  if (type === "boarding") list = list.filter(s => s.tags.some(t => t.toLowerCase().includes("boarding")));
  if (type === "home-visit") list = list.filter(s => s.tags.some(t => t.toLowerCase().includes("home")));

  els.sittersList.innerHTML = "";

  // fake loading
  els.sittersBtn?.classList.add("is-loading");
  setTimeout(() => {
    els.sittersBtn?.classList.remove("is-loading");

    const header = document.createElement("p");
    header.className = "helper-text";
    header.textContent = list.length
      ? `Showing concept sitters${loc ? ` near "${loc}"` : ""}.`
      : "No sitters found (concept). Try another filter.";
    els.sittersList.appendChild(header);

    list.forEach(s => {
      const card = document.createElement("div");
      card.className = "stop-card";
      card.innerHTML = `
        <div class="stop-emoji">🧑‍🦯</div>
        <div class="stop-main">
          <div class="stop-name">${escapeHtml(s.name)} <span style="font-weight:600;color:#888;">(${s.rating}★)</span></div>
          <div class="stop-sub">${escapeHtml(s.tags.join(" • "))}</div>
          <div class="stop-addr">${escapeHtml(s.note)}</div>
        </div>
        <div class="stop-action">CHAT</div>
      `;
      card.addEventListener("click", () => toast("Concept: chat/booking coming next."));
      els.sittersList.appendChild(card);
    });
  }, 900);
}
els.sittersBtn?.addEventListener("click", renderSitters);

/* -------------------------
   Escape HTML
-------------------------- */
function escapeHtml(str) {
  return String(str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/* -------------------------
   Boot
-------------------------- */
// Show "no results yet" on load
renderSearchResults([]);

// If overlay is missing for some reason, still start demo map
if (!els.gpsOverlay) {
  startWithLocation(DEMO_HCMC);
}
