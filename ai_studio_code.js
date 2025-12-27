/* =========================================================
   PetNourish – HCMC Database & Logic
   ========================================================= */

/* --- 1. DATABASE (10 ITEMS / 10 STORES / PRICES) --- */
const DATABASE = [
  { 
    id: 1, item: "Royal Canin Medium Adult (3kg)", category: "Dry Food", price: "580,000₫", 
    desc: "Complete feed for medium breed adult dogs.", 
    store: "Pet Mart (Nguyen Thi Minh Khai)", lat: 10.7845, lng: 106.6980 
  },
  { 
    id: 2, item: "Whiskas Tuna Can (400g)", category: "Wet Food", price: "35,000₫", 
    desc: "Tasty tuna loaf wet food for adult cats.", 
    store: "Paddy Pet Shop (Thao Dien)", lat: 10.8062, lng: 106.7321 
  },
  { 
    id: 3, item: "Bentonite Cat Litter (10L)", category: "Litter", price: "120,000₫", 
    desc: "High clumping, lavender scented dust-free litter.", 
    store: "Dog Paradise (Dist 3)", lat: 10.7765, lng: 106.6854 
  },
  { 
    id: 4, item: "Plush Donut Bed (Large)", category: "Bedding", price: "450,000₫", 
    desc: "Anxiety-relief fluffy bed, machine washable.", 
    store: "Pet City (Ly Chinh Thang)", lat: 10.7856, lng: 106.6832 
  },
  { 
    id: 5, item: "Multi-Level Cat Tree (1.2m)", category: "Furniture", price: "1,200,000₫", 
    desc: "Sisal scratching posts with hammock.", 
    store: "Little Dog (Dist 7)", lat: 10.7301, lng: 106.7058 
  },
  { 
    id: 6, item: "Kong Classic Toy (Medium)", category: "Toys", price: "280,000₫", 
    desc: "Durable rubber chew toy for dogs.", 
    store: "Arale Petshop (Go Vap)", lat: 10.8374, lng: 106.6463 
  },
  { 
    id: 7, item: "Plastic Travel Carrier", category: "Transport", price: "350,000₫", 
    desc: "IATA approved air travel crate.", 
    store: "Oh My Pet (Phu Nhuan)", lat: 10.7905, lng: 106.6758 
  },
  { 
    id: 8, item: "SOS Hypoallergenic Shampoo", category: "Grooming", price: "90,000₫", 
    desc: "Specialized formula for sensitive skin.", 
    store: "Pet Saigon (Dist 10)", lat: 10.7789, lng: 106.6805 
  },
  { 
    id: 9, item: "Reflective Nylon Leash", category: "Accessories", price: "150,000₫", 
    desc: "1.5m leash with padded handle.", 
    store: "Happy Pet Care (Dist 1)", lat: 10.7892, lng: 106.6968 
  },
  { 
    id: 10, item: "Calcium Bone Supplements", category: "Supplements", price: "210,000₫", 
    desc: "Daily chewables for teeth and bones.", 
    store: "Hachiko Petshop (Phu Nhuan)", lat: 10.7965, lng: 106.6912 
  }
];

/* --- 2. GLOBAL STATE --- */
let map = null;
const els = {
  tabMap: document.getElementById("tab-map"),
  tabFood: document.getElementById("tab-food"),
  tabCare: document.getElementById("tab-care"),
  viewMap: document.getElementById("view-map"),
  viewFood: document.getElementById("view-food"),
  viewCare: document.getElementById("view-care"),
  foodGrid: document.getElementById("food-grid"),
  foodSearch: document.getElementById("food-search"),
  toast: document.getElementById("toast")
};

/* --- 3. TABS LOGIC --- */
function setActiveTab(tabName) {
  // Hide all views
  document.querySelectorAll('.view').forEach(el => el.classList.remove('view--active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('tab-btn--active'));

  // Show selected
  document.getElementById(`view-${tabName}`).classList.add('view--active');
  document.getElementById(`tab-${tabName}`).classList.add('tab-btn--active');

  // If map tab, resize leaflet
  if (tabName === 'map' && map) {
    setTimeout(() => map.invalidateSize(), 200);
  }
}

els.tabMap.addEventListener("click", () => setActiveTab("map"));
els.tabFood.addEventListener("click", () => setActiveTab("food"));
els.tabCare.addEventListener("click", () => setActiveTab("care"));

/* --- 4. MAP INITIALIZATION --- */
function initMap() {
  // Center on HCMC
  map = L.map('map').setView([10.7769, 106.7009], 13);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(map);

  // Add Markers from Database
  DATABASE.forEach(item => {
    L.marker([item.lat, item.lng])
      .addTo(map)
      .bindPopup(`<b>${item.store}</b><br>${item.item}<br><span style="color:green">${item.price}</span>`);
  });
}

// Call map init
initMap();

/* --- 5. FULLSCREEN LOGIC (Back Button) --- */
const mapWrap = document.querySelector('.map-wrap');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnExitFullscreen = document.getElementById('btn-exit-fullscreen');

function toggleFullscreen(isFull) {
  if (isFull) {
    mapWrap.classList.add('map-expanded');
    // Leaflet needs to know the size changed
    setTimeout(() => map.invalidateSize(), 200);
  } else {
    mapWrap.classList.remove('map-expanded');
    setTimeout(() => map.invalidateSize(), 200);
  }
}

btnFullscreen.addEventListener('click', () => toggleFullscreen(true));
btnExitFullscreen.addEventListener('click', () => toggleFullscreen(false));

/* --- 6. FOOD & PRICE RENDER LOGIC --- */
function renderFood() {
  const query = els.foodSearch.value.toLowerCase();
  
  els.foodGrid.innerHTML = "";

  const filtered = DATABASE.filter(d => 
    d.item.toLowerCase().includes(query) || 
    d.store.toLowerCase().includes(query)
  );

  if(filtered.length === 0) {
    els.foodGrid.innerHTML = "<p>No items found.</p>";
    return;
  }

  filtered.forEach(data => {
    const card = document.createElement("div");
    card.className = "food-card";
    card.innerHTML = `
      <div class="food-head">
        <div class="food-title">${data.item}</div>
        <div class="food-price">${data.price}</div>
      </div>
      <div class="food-store">📍 ${data.store}</div>
      <div class="food-desc">${data.desc}</div>
      <button class="btn-map-link" onclick="viewOnMap(${data.lat}, ${data.lng}, '${data.store.replace(/'/g, "\\'")}')">
        View Store on Map 🗺️
      </button>
    `;
    els.foodGrid.appendChild(card);
  });
}

// Attach filter listener
els.foodSearch.addEventListener("input", renderFood);

// Initial render
renderFood();

/* --- 7. BRIDGE: FOOD TO MAP --- */
// This function is called when clicking "View on Map" in the list
window.viewOnMap = function(lat, lng, storeName) {
  // 1. Switch to Map Tab
  setActiveTab('map');
  
  // 2. Fly to location
  map.flyTo([lat, lng], 16, {
    duration: 1.5
  });

  // 3. Show Toast
  showToast(`Moved to ${storeName}`);
};

function showToast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  setTimeout(() => els.toast.classList.remove("show"), 3000);
}

// Dark Mode Toggle
const themeToggle = document.getElementById('theme-toggle');
themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('theme-dark');
});