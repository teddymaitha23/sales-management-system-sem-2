/* ================================================================
   OmniPOS — Frontend Application Controller
   Matches the design of pos.zayregadgets.com/admin
   ================================================================ */

const API_URL = 'http://localhost:5000';

// ─── Supabase Authentication ───
let supabaseClient = null;
let currentSession = null;

async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (currentSession?.access_token) {
    headers['Authorization'] = `Bearer ${currentSession.access_token}`;
  }
  return fetch(url, { ...options, headers });
}

// ─── Global Application State ───
let activeView = 'dashboard';
let products = [];
let orders = [];
let cart = [];
let currentCategoryFilter = 'All';
let theme = 'light';
let charts = {};

function getThemeColor(varName, fallback) {
  const color = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  return color || fallback;
}

function getCategoryColors() {
  const primary = getThemeColor('--primary', '#3b82f6');
  if (primary.toLowerCase() === '#c2410c' || primary.toLowerCase() === '#ea580c') {
    // Nordic Rust / Copper Warmth custom dashboard shades
    return ['#ea580c', '#d97706', '#eab308', '#ca8a04', '#b45309', '#f97316', '#78716c'];
  }
  // Default blue theme shades
  return ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6b7280'];
}

// ─── Initialization ───
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
});

async function initAuth() {
  try {
    const res = await fetch(`${API_URL}/api/config`);
    const config = await res.json();
    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
    
    const { data: { session } } = await supabaseClient.auth.getSession();
    handleAuthChange(session);

    supabaseClient.auth.onAuthStateChange((_event, session) => {
      handleAuthChange(session);
    });

    setupAuthUI();
  } catch (err) {
    console.error("Auth init failed", err);
    showToast("Failed to initialize authentication", "error");
  }
}

function handleAuthChange(session) {
  currentSession = session;
  const overlay = document.getElementById('authOverlay');
  const appContainer = document.getElementById('app');
  const headerEmail = document.getElementById('headerUserEmail');
  const profileAvatar = document.querySelector('.profile-avatar');

  if (session) {
    overlay.style.display = 'none';
    appContainer.style.display = 'flex';
    
    // Read Supabase auth user metadata
    const metadata = session.user.user_metadata || {};
    const displayName = metadata.name || session.user.email || 'Admin';
    const storeName = metadata.store_name || 'Main Store';
    const avatarUrl = metadata.avatar_url;

    if (headerEmail) headerEmail.textContent = displayName;
    
    const storeBadge = document.querySelector('.store-badge span');
    if (storeBadge) storeBadge.textContent = storeName;
    
    if (profileAvatar) {
      if (avatarUrl) {
        profileAvatar.innerHTML = `<img src="${avatarUrl}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">`;
        profileAvatar.style.padding = '0';
      } else {
        profileAvatar.textContent = displayName.charAt(0).toUpperCase();
        profileAvatar.innerHTML = displayName.charAt(0).toUpperCase();
        profileAvatar.style.padding = '';
      }
    }
    initApp(); // Boot up the rest of the app!
  } else {
    overlay.style.display = 'flex';
    appContainer.style.display = 'none';
    if (headerEmail) headerEmail.textContent = 'Loading...';
    // Reset state on logout so next user gets a clean session
    appInitialized = false;
    products = [];
    orders = [];
    cart = [];
    Object.values(charts).forEach(c => c.destroy());
    charts = {};
  }
}

function setupAuthUI() {
  let isLogin = true;
  const title = document.getElementById('authTitle');
  const submitBtn = document.getElementById('authSubmitBtn');
  const switchText = document.getElementById('authSwitchText');
  const switchLink = document.getElementById('authSwitchLink');
  
  switchLink.addEventListener('click', (e) => {
    e.preventDefault();
    isLogin = !isLogin;
    title.textContent = isLogin ? 'Sign In' : 'Sign Up';
    submitBtn.textContent = isLogin ? 'Sign In' : 'Sign Up';
    switchText.textContent = isLogin ? "Don't have an account?" : "Already have an account?";
    switchLink.textContent = isLogin ? "Sign Up" : "Sign In";
  });

  submitBtn.addEventListener('click', async () => {
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    
    if (!email || !password) return showToast("Please enter email and password", "error");

    submitBtn.disabled = true;
    submitBtn.textContent = 'Processing...';

    if (isLogin) {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) {
        showToast(error.message, "error");
      }
    } else {
      try {
        const res = await fetch(`${API_URL}/api/auth/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (res.ok) {
          showToast(data.message || "Account created successfully! Please sign in.", "success");
          isLogin = true;
          title.textContent = 'Sign In';
          submitBtn.textContent = 'Sign In';
          switchText.textContent = "Don't have an account?";
          switchLink.textContent = "Sign Up";
        } else {
          showToast(data.error || "Failed to create account.", "error");
        }
      } catch (err) {
        showToast("Connection error during signup.", "error");
      }
    }

    submitBtn.disabled = false;
    submitBtn.textContent = isLogin ? 'Sign In' : 'Sign Up';
  });

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
      await supabaseClient.auth.signOut();
    });
  }
}

let appInitialized = false;
function initApp() {
  if (appInitialized) return;
  appInitialized = true;

  // Sidebar navigation
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const viewName = item.getAttribute('data-view');
      if (viewName) {
        showView(viewName);
        navItems.forEach(n => n.classList.remove('active'));
        item.classList.add('active');
      }
    });
  });

  // Theme toggle
  document.getElementById('themeToggle').addEventListener('click', toggleTheme);

  // Notifications bell
  const bell = document.querySelector('.notification-bell');
  if (bell) bell.addEventListener('click', toggleNotificationsDropdown);
  updateNotificationsUI();

  // Profile settings click
  const profile = document.querySelector('.user-profile');
  if (profile) {
    profile.addEventListener('click', (e) => {
      if (e.target.id === 'logoutBtn' || e.target.closest('#logoutBtn')) return;
      showProfileEditModal();
    });
  }

  // Load products
  fetchProducts();

  // Load dashboard
  showView('dashboard');
}

// ─── Toast Notifications ───
function showToast(message, type = 'success') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let iconClass = 'fa-check-circle';
  if (type === 'error') iconClass = 'fa-times-circle';
  if (type === 'warning') iconClass = 'fa-exclamation-triangle';
  
  toast.innerHTML = `
    <i class="fa-solid ${iconClass}"></i>
    <div class="toast-content">${message}</div>
  `;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// ─── Theme Toggle ───
function toggleTheme() {
  const body = document.body;
  const themeToggle = document.getElementById('themeToggle');
  
  if (theme === 'light') {
    theme = 'dark';
    body.classList.add('dark-theme');
    themeToggle.innerHTML = `<i class="fa-solid fa-sun" style="color:var(--warning);"></i><span>Light Mode</span>`;
  } else {
    theme = 'light';
    body.classList.remove('dark-theme');
    themeToggle.innerHTML = `<i class="fa-solid fa-moon"></i><span>Dark Mode</span>`;
  }
  
  if (activeView === 'dashboard') renderDashboard(document.getElementById('contentArea'));
}

// ─── Fetch Products ───
async function fetchProducts() {
  try {
    const res = await apiFetch(`${API_URL}/api/products`);
    if (res.ok) products = await res.json();
  } catch (err) {
    console.error('Failed to load products:', err);
  }
}

// ─── Fetch Orders ───
async function fetchOrders() {
  try {
    const res = await apiFetch(`${API_URL}/api/orders`);
    if (res.ok) orders = await res.json();
  } catch (err) {
    console.error('Failed to load orders:', err);
  }
}

// ─── JSON Payload Helper ───
function json_payload(data) {
  return JSON.stringify(data);
}

// ─── View Router ───
function showView(viewName) {
  activeView = viewName;
  const contentArea = document.getElementById('contentArea');

  // Destroy previous charts
  Object.values(charts).forEach(c => c.destroy());
  charts = {};

  switch (viewName) {
    case 'dashboard':       renderDashboard(contentArea); break;
    case 'pos':             renderPOSTerminal(contentArea); break;
    case 'orders':          renderOrders(contentArea); break;
    case 'products':        renderProducts(contentArea); break;
    case 'inventory':       renderInventory(contentArea); break;
    case 'reports':         renderReports(contentArea); break;
    case 'customers':       renderCustomers(contentArea); break;
    case 'integrations':    renderIntegrations(contentArea); break;
    case 'product-settings': renderProductSettings(contentArea); break;
    case 'store-settings':  renderStoreSettings(contentArea); break;
    default:
      contentArea.innerHTML = `<div class="empty-state"><i class="fa-solid fa-circle-question"></i><p>View not found.</p></div>`;
  }
}


/* ================================================================
   1. ADMIN DASHBOARD
   ================================================================ */
async function renderDashboard(container) {
  container.innerHTML = `
    <div class="loading-spinner">
      <i class="fa-solid fa-circle-notch fa-spin"></i>
      <p>Fetching dashboard analytics...</p>
    </div>
  `;

  try {
    const [kpiRes, monthlyRes] = await Promise.all([
      apiFetch(`${API_URL}/api/reports/dashboard`),
      apiFetch(`${API_URL}/api/reports/monthly`)
    ]);
    
    if (!kpiRes.ok || !monthlyRes.ok) throw new Error('API fetch failed');
    
    const kpis = await kpiRes.json();
    const monthlyLogs = await monthlyRes.json();

    // Compute some derived stats
    const bestSeller = monthlyLogs.length > 0 && monthlyLogs[0].bestSeller 
      ? monthlyLogs[0].bestSeller 
      : null;

    // Total revenue from monthly logs
    const totalMonthlyRevenue = monthlyLogs.reduce((s, m) => s + m.totalRevenue, 0);

    container.innerHTML = `
      <!-- Page Title -->
      <h1 style="font-size:1.75rem; font-weight:700; margin-bottom:24px; color:var(--text-primary);">Admin Dashboard</h1>

      <!-- Business Overview Section -->
      <div class="dashboard-section">
        <div class="section-title">Business Overview</div>
        
        <!-- Row 1: Core KPIs -->
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-label">Total Revenue</span>
              <span class="stat-icon"><i class="fa-solid fa-dollar-sign"></i></span>
            </div>
            <div class="stat-value">Ksh ${kpis.totalRevenue.toLocaleString()}</div>
            <div class="stat-trend ${kpis.totalRevenue > 0 ? 'down' : 'neutral'}">
              <i class="fa-solid fa-chart-line"></i>
              ${kpis.totalRevenue > 0 ? '-100.0% vs last period' : 'No previous data'}
            </div>
          </div>
          
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-label">Sales Count</span>
              <span class="stat-icon"><i class="fa-solid fa-cart-shopping"></i></span>
            </div>
            <div class="stat-value">${kpis.salesCount}</div>
            <div class="stat-trend neutral">
              <i class="fa-solid fa-shopping-bag"></i>
              Paid orders
            </div>
          </div>
          
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-label">Avg. Sale Value</span>
              <span class="stat-icon"><i class="fa-solid fa-percent"></i></span>
            </div>
            <div class="stat-value">Ksh ${Math.round(kpis.avgSaleValue).toLocaleString()}</div>
            <div class="stat-trend neutral">
              <i class="fa-solid fa-chart-simple"></i>
              Per transaction
            </div>
          </div>
          
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-label">Conversion Rate</span>
              <span class="stat-icon"><i class="fa-solid fa-chart-line"></i></span>
            </div>
            <div class="stat-value">${kpis.conversionRate}%</div>
            <div class="stat-trend neutral">
              <i class="fa-solid fa-arrow-right-arrow-left"></i>
              Checkout success
            </div>
          </div>
        </div>

        <!-- Row 2: Operational KPIs -->
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-label">Pending Orders</span>
              <span class="stat-icon"><i class="fa-solid fa-cart-shopping" style="color:var(--warning);"></i></span>
            </div>
            <div class="stat-value">${kpis.pendingOrders}</div>
            <div class="stat-trend attention">
              <i class="fa-solid fa-chart-line"></i>
              Requires attention
            </div>
          </div>
          
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-label">Fulfilled Orders</span>
              <span class="stat-icon"><i class="fa-solid fa-circle-check" style="color:var(--success);"></i></span>
            </div>
            <div class="stat-value">${kpis.fulfilledOrders}</div>
            <div class="stat-trend up">
              <i class="fa-solid fa-chart-line"></i>
              Completed successfully
            </div>
          </div>
          
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-label">Daily Web Sales</span>
              <span class="stat-icon"><i class="fa-solid fa-desktop" style="color:var(--primary);"></i></span>
            </div>
            <div class="stat-value">Ksh 0</div>
            <div class="stat-trend up">
              <i class="fa-solid fa-chart-line"></i>
              0 orders today
            </div>
          </div>
          
          <div class="stat-card">
            <div class="stat-card-header">
              <span class="stat-label">Best Customer</span>
              <span class="stat-icon"><i class="fa-solid fa-star" style="color:var(--warning);"></i></span>
            </div>
            <div class="stat-value" style="font-size:1.3rem;">${kpis.bestCustomer.name}</div>
            <div class="stat-trend up">
              <i class="fa-solid fa-chart-line"></i>
              Ksh ${kpis.bestCustomer.value.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      <!-- Bottom Row: Order Source + Best Seller -->
      <div class="info-cards-grid">
        <div class="info-card">
          <div class="info-card-title">
            <i class="fa-solid fa-crosshairs"></i>
            Order Source Breakdown
          </div>
          <div class="breakdown-row">
            <span class="label">Direct Checkout</span>
            <span class="value">${kpis.salesCount}</span>
          </div>
          <div class="breakdown-row">
            <span class="label">WhatsApp</span>
            <span class="value">0</span>
          </div>
          <div class="breakdown-row">
            <span class="label">Online Store</span>
            <span class="value">0</span>
          </div>
        </div>
        
        <div class="info-card">
          <div class="info-card-title">
            <i class="fa-regular fa-star"></i>
            Best-Selling Item
          </div>
          ${bestSeller ? `
            <div class="best-seller-name">${bestSeller.name}</div>
            <div class="best-seller-detail">${bestSeller.quantity_sold} units sold</div>
            <div class="best-seller-revenue">
              <i class="fa-solid fa-chart-line"></i>
              Ksh ${bestSeller.revenue.toLocaleString()} Revenue
            </div>
          ` : `
            <div class="empty-state" style="padding:20px;">
              <i class="fa-solid fa-box-open"></i>
              <p>No sales data yet</p>
            </div>
          `}
        </div>
      </div>

      <!-- Revenue Over Time Chart -->
      <div class="chart-card">
        <div class="chart-card-title">Revenue Over Time</div>
        <div class="chart-body">
          <canvas id="salesChart"></canvas>
        </div>
      </div>
    `;

    // ─── Chart.js ───
    const sortedLogs = [...monthlyLogs].reverse();
    const labels = sortedLogs.map(l => l.month);
    const revData = sortedLogs.map(l => l.totalRevenue);

    const ctx = document.getElementById('salesChart').getContext('2d');
    const isDark = theme === 'dark';
    const gridColor = isDark ? '#1f2937' : '#e2e8f0';
    const textColor = isDark ? '#9ca3af' : '#64748b';

    const primaryColor = getThemeColor('--primary', '#3b82f6');

    const gradient = ctx.createLinearGradient(0, 0, 0, 260);
    // Add opacity to primary color hex string
    const gradientStart = primaryColor.startsWith('#') && primaryColor.length === 7 ? primaryColor + '4D' : 'rgba(59, 130, 246, 0.3)';
    const gradientEnd = primaryColor.startsWith('#') && primaryColor.length === 7 ? primaryColor + '00' : 'rgba(59, 130, 246, 0.0)';
    gradient.addColorStop(0, gradientStart);
    gradient.addColorStop(1, gradientEnd);

    charts.salesChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels.length > 0 ? labels : ['No Data'],
        datasets: [{
          label: 'Revenue (Ksh)',
          data: revData.length > 0 ? revData : [0],
          borderColor: primaryColor,
          borderWidth: 2.5,
          backgroundColor: gradient,
          fill: true,
          tension: 0.4,
          pointBackgroundColor: primaryColor,
          pointRadius: 4,
          pointHoverRadius: 7
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'transparent' }, ticks: { color: textColor, font: { family: 'Inter' } } },
          y: { grid: { color: gridColor }, ticks: { color: textColor, font: { family: 'Inter' } } }
        }
      }
    });

  } catch (err) {
    container.innerHTML = `
      <div class="dashboard-section" style="text-align:center; padding:60px;">
        <i class="fa-solid fa-triangle-exclamation" style="font-size:2.5rem; color:var(--danger); margin-bottom:16px;"></i>
        <h3 style="color:var(--text-primary); margin-bottom:8px;">Failed to load dashboard data</h3>
        <p style="color:var(--text-muted);">${err.message}. Please verify the API server is running at ${API_URL}.</p>
      </div>
    `;
  }
}


/* ================================================================
   2. POS TERMINAL
   ================================================================ */
function renderPOSTerminal(container) {
  cart = [];

  // Build category list from actual products
  const categories = ['All', ...new Set(products.map(p => p.category).filter(Boolean))];

  container.innerHTML = `
    <div class="pos-layout">
      <!-- Left: Products -->
      <div class="pos-products-area">
        <div class="pos-top-bar">
          <div class="search-bar">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" id="posSearch" placeholder="Search products by name or SKU...">
          </div>
          <button class="btn btn-danger" onclick="showToast('Register closed','warning')">
            <i class="fa-solid fa-right-from-bracket"></i> Close Register
          </button>
        </div>
        
        <div class="category-pills">
          ${categories.map(cat => `
            <span class="pill ${cat === 'All' ? 'active' : ''}" data-category="${cat}">${cat}</span>
          `).join('')}
        </div>
        
        <div class="products-grid" id="posGrid"></div>
      </div>
      
      <!-- Right: Cart -->
      <div class="cart-panel">
        <div class="cart-header">
          <span class="cart-title">Cart</span>
          <div class="cart-count">
            <i class="fa-solid fa-cart-shopping"></i>
            <span id="cartCountBadge">0</span>
          </div>
        </div>
        
        <div class="cart-customer">
          <div class="cart-customer-info">
            <i class="fa-regular fa-user"></i>
            <span>Walk-in Customer</span>
          </div>
          <button class="btn btn-outline btn-sm" id="posSelectCustomerBtn">Add/Find Customer</button>
        </div>
        
        <div class="cart-items" id="cartItemsContainer">
          <div class="cart-empty">
            <i class="fa-solid fa-cart-shopping"></i>
            <p>Your cart is empty</p>
          </div>
        </div>
        
        <div class="cart-summary">
          <div class="cart-summary-row">
            <span>Subtotal</span>
            <span id="cartSubtotal">Ksh 0</span>
          </div>
          <div class="cart-summary-row">
            <span>Tax (VAT 16%)</span>
            <span id="cartTax">Ksh 0</span>
          </div>
          <div class="cart-summary-row total">
            <span>Total</span>
            <span id="cartTotal">Ksh 0</span>
          </div>
          
          <div class="payment-methods">
            <button class="pay-btn active" data-method="M-Pesa Online">
              <i class="fa-solid fa-mobile-screen"></i>
              <span>M-Pesa</span>
            </button>
            <button class="pay-btn" data-method="Cash">
              <i class="fa-solid fa-money-bill-wave"></i>
              <span>Cash</span>
            </button>
            <button class="pay-btn" data-method="M-Pesa SMS">
              <i class="fa-solid fa-receipt"></i>
              <span>SMS</span>
            </button>
          </div>
          
          <button class="cart-checkout-btn primary" id="posCheckoutBtn">
            Select Customer to Process Sale
          </button>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#posSelectCustomerBtn').addEventListener('click', showCustomerSelectModal);

  // Category pill handlers
  container.querySelectorAll('.pill').forEach(c => {
    c.addEventListener('click', () => {
      container.querySelectorAll('.pill').forEach(x => x.classList.remove('active'));
      c.classList.add('active');
      currentCategoryFilter = c.getAttribute('data-category');
      filterPOSProducts();
    });
  });

  // Search handler
  container.querySelector('#posSearch').addEventListener('input', (e) => {
    filterPOSProducts(e.target.value.toLowerCase());
  });

  // Payment method toggle
  let paymentMethod = 'M-Pesa Online';
  container.querySelectorAll('.pay-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.pay-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      paymentMethod = btn.getAttribute('data-method');
    });
  });

  // Checkout
  container.querySelector('#posCheckoutBtn').addEventListener('click', () => {
    triggerCheckout(paymentMethod);
  });

  filterPOSProducts();
}

function filterPOSProducts(searchQuery = '') {
  const grid = document.getElementById('posGrid');
  if (!grid) return;

  let filtered = products;
  if (currentCategoryFilter !== 'All') {
    filtered = filtered.filter(p => p.category === currentCategoryFilter);
  }
  if (searchQuery) {
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(searchQuery) ||
      (p.category && p.category.toLowerCase().includes(searchQuery))
    );
  }

  grid.innerHTML = filtered.map(p => `
    <div class="product-card" data-id="${p.id}">
      <div class="product-card-image" style="background-image: url('${p.image_url || 'https://images.unsplash.com/photo-1531403009284-440f080d1e12?w=300'}')">
        <span class="stock-badge ${p.stock === 0 ? 'out' : ''}">${p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'}</span>
      </div>
      <div class="product-card-body">
        <div class="product-card-name">${p.name}</div>
        <div class="product-card-price">
          <span>Ksh ${p.price.toLocaleString()}</span>
          <button class="add-to-cart-btn" title="Add to cart"><i class="fa-solid fa-plus"></i></button>
        </div>
      </div>
    </div>
  `).join('');

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state"><i class="fa-solid fa-box-open"></i><p>No products found</p></div>`;
  }

  // Click handlers
  grid.querySelectorAll('.product-card').forEach(card => {
    card.addEventListener('click', () => {
      const pId = card.getAttribute('data-id');
      const product = products.find(p => String(p.id) === String(pId));
      if (product) {
        if (product.stock === 0) {
          showToast('Product is out of stock!', 'error');
          return;
        }
        addToCart(product);
      }
    });
  });
}

function addToCart(product) {
  const existing = cart.find(item => item.id === product.id);
  if (existing) {
    if (existing.quantity >= product.stock) {
      showToast('Cannot exceed available stock!', 'warning');
      return;
    }
    existing.quantity += 1;
  } else {
    cart.push({ ...product, quantity: 1 });
  }
  updatePOSCartUI();
}

function updatePOSCartUI() {
  const container = document.getElementById('cartItemsContainer');
  const countBadge = document.getElementById('cartCountBadge');
  const cartSubtotal = document.getElementById('cartSubtotal');
  const cartTax = document.getElementById('cartTax');
  const cartTotal = document.getElementById('cartTotal');
  const checkoutBtn = document.getElementById('posCheckoutBtn');
  
  if (!container) return;

  const count = cart.reduce((sum, item) => sum + item.quantity, 0);
  countBadge.innerText = count;

  if (cart.length === 0) {
    container.innerHTML = `
      <div class="cart-empty">
        <i class="fa-solid fa-cart-shopping"></i>
        <p>Your cart is empty</p>
      </div>
    `;
    cartSubtotal.innerText = 'Ksh 0';
    cartTax.innerText = 'Ksh 0';
    cartTotal.innerText = 'Ksh 0';
    checkoutBtn.innerText = 'Select Customer to Process Sale';
    return;
  }

  container.innerHTML = cart.map(item => `
    <div class="cart-item">
      <div class="cart-item-info">
        <span class="cart-item-name">${item.name}</span>
        <span class="cart-item-price">Ksh ${item.price.toLocaleString()} each</span>
      </div>
      <div class="qty-controls">
        <button class="qty-btn" data-action="dec" data-id="${item.id}"><i class="fa-solid fa-minus"></i></button>
        <span class="qty-value">${item.quantity}</span>
        <button class="qty-btn" data-action="inc" data-id="${item.id}"><i class="fa-solid fa-plus"></i></button>
      </div>
      <span class="cart-item-total">Ksh ${(item.price * item.quantity).toLocaleString()}</span>
    </div>
  `).join('');

  // Quantity button handlers
  container.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const action = btn.getAttribute('data-action');
      const id = btn.getAttribute('data-id');
      const item = cart.find(x => String(x.id) === String(id));
      const product = products.find(x => String(x.id) === String(id));
      
      if (item && product) {
        if (action === 'inc') {
          if (item.quantity >= product.stock) {
            showToast('Cannot exceed available stock!', 'warning');
            return;
          }
          item.quantity += 1;
        } else {
          item.quantity -= 1;
          if (item.quantity === 0) cart = cart.filter(x => String(x.id) !== String(id));
        }
        updatePOSCartUI();
      }
    });
  });

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const tax = Math.round(subtotal * 0.16);
  const total = subtotal + tax;
  
  cartSubtotal.innerText = `Ksh ${subtotal.toLocaleString()}`;
  cartTax.innerText = `Ksh ${tax.toLocaleString()}`;
  cartTotal.innerText = `Ksh ${total.toLocaleString()}`;
  checkoutBtn.innerText = `Confirm Checkout — Ksh ${total.toLocaleString()}`;
}

async function triggerCheckout(paymentMethod) {
  if (cart.length === 0) {
    showToast('Add products to the cart before checking out.', 'warning');
    return;
  }

  const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const tax = Math.round(subtotal * 0.16);
  const total = subtotal + tax;

  if (paymentMethod === 'M-Pesa Online') {
    showSTKModal(total, async (phone) => {
      try {
        const res = await apiFetch(`${API_URL}/api/mpesa/stk-push`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: json_payload({ phone, amount: total, name: currentPosCustomer || 'POS Customer', items: cart })
        });
        const details = await res.json();
        if (res.ok) {
          if (details.status === 'Pending') {
            showPollingModal(details.orderId, details.checkoutRequestId);
          } else {
            showToast(`Payment simulated successfully! Ref: ${details.mpesaCode}`, 'success');
            addNotification('Order Confirmed', `New M-Pesa payment of KES ${total.toLocaleString()} from ${currentPosCustomer || 'POS Customer'}`, 'reconcile', 'orders');
            cart = [];
            updatePOSCartUI();
            await fetchProducts();
            showView('orders');
          }
        } else {
          showToast(details.error, 'error');
        }
      } catch (err) {
        showToast('Connection error during payment.', 'error');
      }
    });
    return;
  }

  // Cash / SMS checkout
  const customerName = currentPosCustomer || (paymentMethod === 'Cash' ? 'Walk-in Customer' : 'Online Customer');
  const paymentStatus = paymentMethod === 'Cash' ? 'Paid' : 'Pending';
  const orderStatus = paymentMethod === 'Cash' ? 'Fulfilled' : 'Pending';

  try {
    const res = await apiFetch(`${API_URL}/api/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: json_payload({
        customer_name: customerName,
        payment_method: paymentMethod,
        payment_status: paymentStatus,
        order_status: orderStatus,
        items: cart
      })
    });
    
    if (res.ok) {
      showToast(paymentMethod === 'Cash' ? 'Transaction logged successfully.' : 'Order logged. Awaiting SMS confirmation.', paymentMethod === 'Cash' ? 'success' : 'warning');
      addNotification('Order Logged', `New ${paymentMethod} sale of KES ${total.toLocaleString()} completed`, 'reconcile', 'orders');
      cart = [];
      updatePOSCartUI();
      await fetchProducts();
      showView('orders');
    } else {
      const err = await res.json();
      showToast(err.error, 'error');
    }
  } catch (err) {
    showToast('Failed to record order.', 'error');
  }
}

// ─── STK Push Modal ───
function showSTKModal(amount, callback) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-title">M-Pesa STK Push</div>
      <p style="color:var(--text-muted); margin-bottom:20px; font-size:0.9rem;">
        Enter customer phone number to send payment request of <strong>Ksh ${amount.toLocaleString()}</strong>
      </p>
      <div class="form-group">
        <label>Phone Number</label>
        <input type="tel" id="stkPhone" placeholder="254XXXXXXXXX" value="254">
      </div>
      <div class="form-actions">
        <button class="btn btn-outline" id="stkCancel">Cancel</button>
        <button class="btn btn-primary" id="stkConfirm">
          <i class="fa-solid fa-paper-plane"></i> Send STK Push
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#stkCancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#stkConfirm').addEventListener('click', () => {
    const phone = overlay.querySelector('#stkPhone').value;
    if (phone.length < 10) {
      showToast('Enter a valid phone number.', 'error');
      return;
    }
    overlay.remove();
    callback(phone);
  });
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
}

// ─── STK Polling Modal ───
function showPollingModal(orderId, checkoutRequestId) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width: 400px; text-align: center; padding: 30px;">
      <div style="margin-bottom: 20px;">
        <i class="fa-solid fa-circle-notch fa-spin" style="font-size: 3rem; color: var(--primary);"></i>
      </div>
      <div class="modal-title" style="margin-bottom: 10px;">Awaiting M-Pesa Payment</div>
      <p style="color: var(--text-muted); font-size: 0.95rem; margin-bottom: 20px; line-height: 1.5;">
        A payment request has been sent to your phone. <br>
        <strong>Please enter your M-Pesa PIN</strong> to authorize the transaction.
      </p>
      <div id="pollingStatusMessage" style="background: var(--bg-input); padding: 12px; border-radius: var(--radius-sm); font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 20px;">
        Status: Waiting for user PIN...
      </div>
      <button class="btn btn-outline" id="cancelPollingBtn" style="width: 100%;">Close & Keep Pending</button>
    </div>
  `;
  document.body.appendChild(overlay);

  let isCancelled = false;
  overlay.querySelector('#cancelPollingBtn').addEventListener('click', () => {
    isCancelled = true;
    overlay.remove();
    showToast('Payment window closed. Order is pending reconciliation.', 'warning');
    cart = [];
    updatePOSCartUI();
    showView('orders');
  });

  let pollCount = 0;
  const maxPolls = 30; // 60 seconds total (2s interval)
  
  const pollInterval = setInterval(async () => {
    if (isCancelled) {
      clearInterval(pollInterval);
      return;
    }

    pollCount++;
    if (pollCount > maxPolls) {
      clearInterval(pollInterval);
      overlay.remove();
      showToast('Payment verification timed out. If you entered your PIN, the system will update once Safaricom processes it.', 'warning');
      cart = [];
      updatePOSCartUI();
      showView('orders');
      return;
    }

    try {
      const res = await apiFetch(`${API_URL}/api/mpesa/order-status/${orderId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.paymentStatus === 'Paid') {
          clearInterval(pollInterval);
          overlay.remove();
          showToast(`Payment confirmed! Ref: ${data.mpesaCode}`, 'success');
          cart = [];
          updatePOSCartUI();
          await fetchProducts();
          showView('orders');
        } else if (data.paymentStatus === 'Failed') {
          clearInterval(pollInterval);
          overlay.remove();
          showToast('Payment request was cancelled or failed.', 'error');
          cart = [];
          updatePOSCartUI();
          showView('pos');
        }
      }
    } catch (err) {
      console.error('Polling error:', err);
    }
  }, 2000);
}


/* ================================================================
   3. ORDERS
   ================================================================ */
async function renderOrders(container) {
  container.innerHTML = `
    <div class="loading-spinner">
      <i class="fa-solid fa-circle-notch fa-spin"></i>
      <p>Fetching orders...</p>
    </div>
  `;

  try {
    await fetchOrders();
    const kpiRes = await apiFetch(`${API_URL}/api/reports/dashboard`);
    const kpis = kpiRes.ok ? await kpiRes.json() : {};

    const paidOrders = orders.filter(o => o.payment_status === 'Paid');
    const unpaidOrders = orders.filter(o => o.payment_status !== 'Paid');
    const totalRevenue = paidOrders.reduce((s, o) => s + o.total_amount, 0);

    container.innerHTML = `
      <!-- Page Header -->
      <div class="page-header">
        <div class="page-header-info">
          <h1><i class="fa-solid fa-store" style="color:var(--primary);"></i> Orders</h1>
          <p>Manage your orders and payments • <span class="store-link">Main Store</span></p>
        </div>
        <div class="page-header-actions">
          <button class="btn btn-outline" onclick="showView('orders')">
            <i class="fa-solid fa-rotate"></i> Refresh
          </button>
          <button class="btn btn-primary" id="newOrderBtn">
            <i class="fa-solid fa-plus"></i> New Order
          </button>
        </div>
      </div>

      <!-- Summary Cards -->
      <div class="summary-cards">
        <div class="summary-card">
          <div class="summary-card-icon" style="color:var(--primary); font-size:1.4rem;"><i class="fa-solid fa-box"></i></div>
          <div class="summary-card-content">
            <div class="summary-card-label">Total Orders</div>
            <div class="summary-card-value">${orders.length}</div>
          </div>
          <span class="badge badge-success summary-card-badge">+12%</span>
        </div>
        
        <div class="summary-card">
          <div class="summary-card-icon" style="color:var(--warning); font-size:1.4rem;"><i class="fa-solid fa-sack-dollar"></i></div>
          <div class="summary-card-content">
            <div class="summary-card-label">Revenue</div>
            <div class="summary-card-value">KES ${totalRevenue.toLocaleString()}</div>
          </div>
          <span class="badge badge-success summary-card-badge">+8%</span>
        </div>
        
        <div class="summary-card">
          <div class="summary-card-icon" style="color:var(--info); font-size:1.4rem;"><i class="fa-solid fa-chart-pie"></i></div>
          <div class="summary-card-content">
            <div class="summary-card-label">Pending vs Fulfilled</div>
            <div class="summary-card-value">${kpis.pendingOrders || 0} / ${kpis.fulfilledOrders || 0}</div>
          </div>
          <span class="badge badge-success summary-card-badge">All Fulfilled</span>
        </div>
        
        <div class="summary-card">
          <div class="summary-card-icon" style="color:var(--danger); font-size:1.4rem;"><i class="fa-solid fa-file-invoice-dollar"></i></div>
          <div class="summary-card-content">
            <div class="summary-card-label">Paid vs Unpaid</div>
            <div class="summary-card-value">${paidOrders.length} / ${unpaidOrders.length}</div>
          </div>
          ${unpaidOrders.length > 0 
            ? `<span class="badge badge-danger summary-card-badge">${unpaidOrders.length} Unpaid</span>`
            : `<span class="badge badge-success summary-card-badge">All Paid</span>`
          }
        </div>
      </div>

      <!-- Search & Filter -->
      <div class="filter-toolbar">
        <div class="search-bar" style="max-width:500px;">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input type="text" id="orderSearch" placeholder="Search orders, customers, or phone numbers...">
        </div>
        <button class="btn btn-outline btn-sm">
          <i class="fa-solid fa-filter"></i> Filters
        </button>
        <button class="btn btn-outline btn-sm" id="orderExportBtn">
          <i class="fa-solid fa-download"></i> Export
        </button>
      </div>

      <!-- Orders Table -->
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th><input type="checkbox" style="accent-color:var(--primary);"></th>
              <th>Order</th>
              <th>Customer</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Total</th>
              <th>Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="ordersTableBody"></tbody>
        </table>
      </div>
    `;

    populateOrdersTable(orders);

    // Search handler
    container.querySelector('#orderSearch').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = orders.filter(o =>
        (o.customer_name || '').toLowerCase().includes(q) ||
        (o.customer_phone || '').toLowerCase().includes(q) ||
        `#ORD-${String(o.id).padStart(4, '0')}`.toLowerCase().includes(q)
      );
      populateOrdersTable(filtered);
    });

    // New order button → go to POS
    container.querySelector('#newOrderBtn').addEventListener('click', () => {
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      document.querySelector('[data-view="pos"]').classList.add('active');
      showView('pos');
    });

    // Export CSV
    container.querySelector('#orderExportBtn').addEventListener('click', () => {
      if (orders.length === 0) {
        showToast('No orders to export.', 'warning');
        return;
      }
      const headers = ['Order ID', 'Customer', 'Phone', 'Payment Method', 'Payment Status', 'Order Status', 'Total (KES)', 'Date'];
      const rows = orders.map(o => [
        `ORD-${String(o.id).padStart(6, '0')}`,
        o.customer_name || 'N/A',
        o.customer_phone || '',
        o.payment_method || '',
        o.payment_status,
        o.order_status,
        o.total_amount,
        new Date(o.created_at).toLocaleDateString()
      ]);
      const csvContent = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orders_export_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Orders exported successfully.', 'success');
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Error loading orders: ${err.message}</p></div>`;
  }
}

function populateOrdersTable(ordersList) {
  const tbody = document.getElementById('ordersTableBody');
  if (!tbody) return;

  if (ordersList.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center" style="padding:40px; color:var(--text-muted);">No orders found.</td></tr>`;
    return;
  }

  tbody.innerHTML = ordersList.map(o => {
    const orderId = `#ORD-${new Date(o.created_at).getFullYear()}-${String(o.id).padStart(6, '0')}`;
    const itemCount = o.items ? o.items.length : 0;
    const dateStr = new Date(o.created_at).toLocaleDateString('en-US', { year:'numeric', month:'numeric', day:'numeric' });
    const timeAgo = getTimeAgo(o.created_at);

    const statusBadge = o.order_status === 'Fulfilled' || o.order_status === 'Completed'
      ? `<span class="badge badge-success"><i class="fa-solid fa-check"></i> Completed</span>`
      : o.order_status === 'Cancelled'
      ? `<span class="badge badge-danger"><i class="fa-solid fa-xmark"></i> Cancelled</span>`
      : `<span class="badge badge-warning"><i class="fa-solid fa-clock"></i> Pending</span>`;

    const paymentBadge = o.payment_status === 'Paid'
      ? `<span class="badge badge-success">Paid</span><br><span style="font-size:0.72rem; color:var(--text-faint);">${o.payment_method || 'CASH'}</span>`
      : `<span class="badge badge-danger">Unpaid</span>`;

    return `
      <tr>
        <td><input type="checkbox" style="accent-color:var(--primary);"></td>
        <td>
          <div>
            <strong style="color:var(--text-primary);">${orderId}</strong>
            <div style="font-size:0.75rem; color:var(--text-faint);">${itemCount} item${itemCount !== 1 ? 's' : ''}</div>
          </div>
        </td>
        <td>
          <div>
            <strong style="color:var(--text-primary);">${o.customer_name || 'N/A'}</strong>
            <div style="font-size:0.75rem; color:var(--text-faint);">
              ${o.customer_phone ? `<i class="fa-solid fa-phone" style="color:var(--text-faint); font-size:0.7rem;"></i> ${o.customer_phone}` : ''}
            </div>
          </div>
        </td>
        <td>${statusBadge}</td>
        <td>${paymentBadge}</td>
        <td style="font-weight:700;">KES ${o.total_amount.toLocaleString()}</td>
        <td>
          <div>
            <span>${dateStr}</span>
            <div style="font-size:0.72rem; color:var(--text-faint);">${timeAgo}</div>
          </div>
        </td>
        <td>
          <div style="display:flex; gap:6px;">
            <button class="btn-icon" title="View" onclick="viewOrderDetails('${o.id}')"><i class="fa-regular fa-eye"></i></button>
            <select class="status-select" data-id="${o.id}" style="padding:4px 8px; border:1px solid var(--border); border-radius:var(--radius-sm); font-size:0.75rem; background:var(--bg-card); color:var(--text-secondary);">
              <option value="Pending" ${o.order_status === 'Pending' ? 'selected' : ''}>Pending</option>
              <option value="Fulfilled" ${o.order_status === 'Fulfilled' ? 'selected' : ''}>Fulfilled</option>
              <option value="Cancelled" ${o.order_status === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
            </select>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Status change handlers
  tbody.querySelectorAll('.status-select').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      const oId = sel.getAttribute('data-id');
      try {
        const res = await apiFetch(`${API_URL}/api/orders/${oId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: json_payload({ order_status: e.target.value })
        });
        if (res.ok) {
          showToast(`Order #${oId} updated to ${e.target.value}.`, 'success');
          await fetchProducts();
        } else {
          showToast('Failed to update status.', 'error');
        }
      } catch (err) {
        showToast('Connection error.', 'error');
      }
    });
  });
}

function getTimeAgo(dateStr) {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return `about ${diffMonths} month${diffMonths > 1 ? 's' : ''} ago`;
}


/* ================================================================
   4. PRODUCTS
   ================================================================ */
function renderProducts(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-info">
        <h1>Products</h1>
        <p>Manage your product catalog, inventory, and pricing.</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary" id="addProductBtn">
          <i class="fa-solid fa-plus"></i> Add Product
        </button>
      </div>
    </div>

    <div class="filter-toolbar">
      <div class="search-bar" style="max-width:400px;">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" id="productSearch" placeholder="Search by name or SKU...">
      </div>
      <div style="display:flex; align-items:center; gap:6px; margin-left:4px;">
        <input type="checkbox" id="searchAllStores" style="accent-color:var(--primary);">
        <label for="searchAllStores" style="font-size:0.82rem; color:var(--text-muted); cursor:pointer;">
          <i class="fa-solid fa-globe"></i> Search all stores
        </label>
      </div>
      <div style="margin-left:auto; display:flex; gap:6px;">
        <button class="btn btn-outline btn-sm"><i class="fa-solid fa-filter"></i> Filters</button>
        <button class="btn-icon" id="listViewBtn" title="List view"><i class="fa-solid fa-list"></i></button>
        <button class="btn-icon active" id="gridViewBtn" title="Grid view"><i class="fa-solid fa-grip"></i></button>
      </div>
    </div>

    <div id="productsDisplay" class="products-catalog-grid"></div>
  `;

  populateProductsGrid();

  container.querySelector('#productSearch').addEventListener('input', (e) => {
    populateProductsGrid(e.target.value.toLowerCase());
  });

  container.querySelector('#addProductBtn').addEventListener('click', () => {
    showProductFormModal();
  });

  // View toggle (cosmetic)
  container.querySelector('#listViewBtn').addEventListener('click', () => {
    container.querySelector('#listViewBtn').classList.add('active');
    container.querySelector('#gridViewBtn').classList.remove('active');
    showToast('List view coming soon', 'warning');
  });
  container.querySelector('#gridViewBtn').addEventListener('click', () => {
    container.querySelector('#gridViewBtn').classList.add('active');
    container.querySelector('#listViewBtn').classList.remove('active');
  });
}

function populateProductsGrid(searchQuery = '') {
  const display = document.getElementById('productsDisplay');
  if (!display) return;

  let filtered = products;
  if (searchQuery) {
    filtered = filtered.filter(p =>
      p.name.toLowerCase().includes(searchQuery) ||
      (p.category && p.category.toLowerCase().includes(searchQuery))
    );
  }

  if (filtered.length === 0) {
    display.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><i class="fa-solid fa-box-open"></i><p>No products found</p></div>`;
    return;
  }

  display.innerHTML = filtered.map(p => `
    <div class="catalog-card">
      <div class="catalog-card-image" style="background-image: url('${p.image_url || 'https://images.unsplash.com/photo-1531403009284-440f080d1e12?w=400'}')"></div>
      <div class="catalog-card-body">
        <div class="catalog-card-category">${p.category || 'GENERAL'}</div>
        <div class="catalog-card-name">${p.name}</div>
        <div class="catalog-card-price">Ksh ${p.price.toLocaleString()}</div>
        <div class="catalog-card-stock ${p.stock === 0 ? 'out-of-stock' : p.stock <= 5 ? 'low-stock' : 'in-stock'}">
          ${p.stock === 0 ? 'Out of stock' : p.stock <= 5 ? `Low stock: ${p.stock} left` : `${p.stock} in stock`}
        </div>
      </div>
      <div class="catalog-card-actions">
        <button class="btn-icon edit-prod-btn" data-id="${p.id}" title="Edit" style="background:white;"><i class="fa-solid fa-pen"></i></button>
        <button class="btn-icon del-prod-btn" data-id="${p.id}" title="Delete" style="background:white;"><i class="fa-solid fa-trash" style="color:var(--danger);"></i></button>
      </div>
    </div>
  `).join('');

  // Edit handlers
  display.querySelectorAll('.edit-prod-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const product = products.find(p => String(p.id) === String(id));
      if (product) showProductFormModal(product);
    });
  });

  // Delete handlers
  display.querySelectorAll('.del-prod-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (confirm('Delete this product?')) {
        try {
          const res = await apiFetch(`${API_URL}/api/products/${id}`, { method: 'DELETE' });
          if (res.ok) {
            showToast('Product deleted.', 'success');
            await fetchProducts();
            populateProductsGrid();
          }
        } catch (err) {
          showToast('Delete failed.', 'error');
        }
      }
    });
  });
}

// ─── Product Form Modal ───
function showProductFormModal(product = null) {
  const isEdit = !!product;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-title">${isEdit ? 'Edit Product' : 'Add New Product'}</div>
      <div class="form-group">
        <label>Product Name *</label>
        <input type="text" id="prodName" value="${isEdit ? product.name : ''}" placeholder="Product name">
      </div>
      <div class="form-group">
        <label>Description</label>
        <input type="text" id="prodDesc" value="${isEdit ? (product.description || '') : ''}" placeholder="Short description">
      </div>
      <div class="form-group">
        <label>Category</label>
        <input type="text" id="prodCategory" value="${isEdit ? (product.category || '') : ''}" placeholder="e.g., Electronics, Audio">
      </div>
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
        <div class="form-group">
          <label>Price (Ksh) *</label>
          <input type="number" id="prodPrice" value="${isEdit ? product.price : ''}" placeholder="0">
        </div>
        <div class="form-group">
          <label>Stock *</label>
          <input type="number" id="prodStock" value="${isEdit ? product.stock : ''}" placeholder="0">
        </div>
      </div>
      <div class="form-group">
        <label>Product Photo</label>
        <div class="image-upload-wrapper" id="prodImageUploadWrapper">
          <i class="fa-solid fa-cloud-arrow-up"></i>
          <span>Drag and drop an image or <strong>click to browse</strong></span>
          <input type="file" id="prodImageFileInput" accept="image/*" style="display:none;">
        </div>
        <div class="image-preview-container ${isEdit && product.image_url ? 'has-image' : ''}" id="prodImagePreviewContainer">
          <img src="${isEdit ? (product.image_url || '') : ''}" id="prodImagePreview">
          <button class="remove-img-btn" id="prodRemoveImgBtn" type="button"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <input type="hidden" id="prodImage" value="${isEdit ? (product.image_url || '') : ''}">
      </div>
      <div class="form-actions">
        <button class="btn btn-outline" id="prodCancel">Cancel</button>
        <button class="btn btn-primary" id="prodSave">
          <i class="fa-solid fa-check"></i> ${isEdit ? 'Update' : 'Add Product'}
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const uploadWrapper = overlay.querySelector('#prodImageUploadWrapper');
  const fileInput = overlay.querySelector('#prodImageFileInput');
  const previewContainer = overlay.querySelector('#prodImagePreviewContainer');
  const previewImg = overlay.querySelector('#prodImagePreview');
  const removeBtn = overlay.querySelector('#prodRemoveImgBtn');
  const hiddenImageInput = overlay.querySelector('#prodImage');

  uploadWrapper.addEventListener('click', () => fileInput.click());

  uploadWrapper.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadWrapper.classList.add('dragover');
  });

  uploadWrapper.addEventListener('dragleave', () => {
    uploadWrapper.classList.remove('dragover');
  });

  uploadWrapper.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadWrapper.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processProductImage(e.dataTransfer.files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      processProductImage(fileInput.files[0]);
    }
  });

  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    hiddenImageInput.value = '';
    previewImg.src = '';
    previewContainer.classList.remove('has-image');
  });

  function processProductImage(file) {
    compressAndBase64(file, (base64Data) => {
      hiddenImageInput.value = base64Data;
      previewImg.src = base64Data;
      previewContainer.classList.add('has-image');
    });
  }

  overlay.querySelector('#prodCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#prodSave').addEventListener('click', async () => {
    const name = overlay.querySelector('#prodName').value.trim();
    const description = overlay.querySelector('#prodDesc').value.trim();
    const category = overlay.querySelector('#prodCategory').value.trim();
    const price = parseFloat(overlay.querySelector('#prodPrice').value);
    const stock = parseInt(overlay.querySelector('#prodStock').value);
    const image_url = overlay.querySelector('#prodImage').value.trim();

    if (!name || isNaN(price) || isNaN(stock)) {
      showToast('Name, price, and stock are required.', 'error');
      return;
    }

    const data = { name, description, price, stock, category, image_url };

    try {
      const url = isEdit ? `${API_URL}/api/products/${product.id}` : `${API_URL}/api/products`;
      const method = isEdit ? 'PUT' : 'POST';
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: json_payload(data)
      });
      if (res.ok) {
        showToast(`Product ${isEdit ? 'updated' : 'added'} successfully.`, 'success');
        overlay.remove();
        if (stock <= 5) {
          addNotification('Low Stock Alert', `${name} is low on stock (${stock} remaining)`, 'warning', 'inventory');
        }
        await fetchProducts();
        if (activeView === 'products') populateProductsGrid();
        if (activeView === 'inventory') renderInventory(document.getElementById('contentArea'));
      } else {
        const err = await res.json();
        showToast(err.error || 'Save failed.', 'error');
      }
    } catch (err) {
      showToast('Connection error.', 'error');
    }
  });
}


/* ================================================================
   5. INVENTORY
   ================================================================ */
function renderInventory(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-info">
        <h1>Inventory</h1>
        <p>Manage stock levels and performance for your current store.</p>
      </div>
      <div class="page-header-actions">
        <button class="btn btn-primary" id="verifyStockBtn">
          <i class="fa-solid fa-check-double"></i> Verify Stock
        </button>
        <button class="btn btn-outline" id="importProductsBtn">
          <i class="fa-solid fa-upload"></i> Import
        </button>
        <button class="btn btn-outline" id="exportProductsBtn">
          <i class="fa-solid fa-download"></i> Export
        </button>
      </div>
    </div>

    <div class="table-container">
      <div style="padding:16px 20px; display:flex; align-items:center; gap:12px; border-bottom:1px solid var(--border);">
        <div class="search-bar" style="max-width:400px;">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input type="text" id="invSearch" placeholder="Search by product name or SKU...">
        </div>
        <select class="status-select" id="invStatusFilter">
          <option value="all">All Statuses</option>
          <option value="in-stock">In Stock</option>
          <option value="low-stock">Low Stock</option>
          <option value="out-of-stock">Out of Stock</option>
        </select>
      </div>
      <div style="padding:8px 20px; font-size:0.82rem; color:var(--text-muted); border-bottom:1px solid var(--border-light);">
        <span id="invCount">${products.length} item${products.length !== 1 ? 's' : ''} in inventory.</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Image</th>
            <th>Product <i class="fa-solid fa-sort" style="font-size:0.65rem; margin-left:4px;"></i></th>
            <th>Stock Status</th>
            <th>Available</th>
            <th>Sales Velocity</th>
            <th>Store Price</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="invTableBody"></tbody>
      </table>
    </div>
  `;

  populateInventoryTable();

  container.querySelector('#invSearch').addEventListener('input', () => populateInventoryTable());
  container.querySelector('#invStatusFilter').addEventListener('change', () => populateInventoryTable());
  container.querySelector('#verifyStockBtn').addEventListener('click', triggerStockVerification);
  container.querySelector('#importProductsBtn').addEventListener('click', triggerImportModal);
  container.querySelector('#exportProductsBtn').addEventListener('click', exportInventoryToCSV);
}

function populateInventoryTable() {
  const tbody = document.getElementById('invTableBody');
  const searchInput = document.getElementById('invSearch');
  const statusFilter = document.getElementById('invStatusFilter');
  const countEl = document.getElementById('invCount');
  if (!tbody) return;

  let filtered = [...products];
  const q = searchInput ? searchInput.value.toLowerCase() : '';
  const status = statusFilter ? statusFilter.value : 'all';

  if (q) {
    filtered = filtered.filter(p => p.name.toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q));
  }
  if (status === 'in-stock') filtered = filtered.filter(p => p.stock > 5);
  if (status === 'low-stock') filtered = filtered.filter(p => p.stock > 0 && p.stock <= 5);
  if (status === 'out-of-stock') filtered = filtered.filter(p => p.stock === 0);

  if (countEl) countEl.innerText = `${filtered.length} item${filtered.length !== 1 ? 's' : ''} in inventory.`;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center" style="padding:40px; color:var(--text-muted);">No inventory items found.</td></tr>`;
    return;
  }

  // Generate a pseudo SKU from product name
  function generateSKU(p) {
    const prefix = p.name.replace(/[^A-Za-z0-9]/g, '').substring(0, 5).toUpperCase();
    const suffix = String(p.id).padStart(2, '0');
    return `${prefix}-${suffix}`;
  }

  tbody.innerHTML = filtered.map(p => {
    const stockStatus = p.stock === 0 ? 'out-of-stock' : p.stock <= 5 ? 'low-stock' : 'in-stock';
    const stockLabel = p.stock === 0 ? 'Out of Stock' : p.stock <= 5 ? 'Low Stock' : 'In Stock';
    const statusClass = p.stock === 0 ? 'badge-danger' : p.stock <= 5 ? 'badge-warning' : 'badge-success';

    return `
      <tr>
        <td>
          <div style="width:36px; height:36px; border-radius:var(--radius-sm); background:var(--bg-input); display:flex; align-items:center; justify-content:center; color:var(--text-faint);">
            ${p.image_url ? `<img src="${p.image_url}" style="width:36px; height:36px; border-radius:var(--radius-sm); object-fit:cover;">` : '<i class="fa-solid fa-cube"></i>'}
          </div>
        </td>
        <td>
          <div>
            <strong style="color:var(--text-primary);">${p.name}</strong>
            <div style="font-size:0.72rem; color:var(--text-faint);">SKU: ${generateSKU(p)}</div>
          </div>
        </td>
        <td><span class="badge ${statusClass}"><i class="fa-solid fa-${p.stock === 0 ? 'xmark' : 'check'}"></i> ${stockLabel}</span></td>
        <td style="font-weight:600;">${p.stock}</td>
        <td>
          <span style="display:flex; align-items:center; gap:4px; color:var(--text-muted); font-size:0.85rem;">
            <i class="fa-solid fa-chart-line" style="font-size:0.7rem;"></i> 0.0/day
          </span>
        </td>
        <td style="font-weight:600;">Ksh ${p.price.toLocaleString()}</td>
        <td>
          <button class="btn-icon" title="More actions"><i class="fa-solid fa-ellipsis"></i></button>
        </td>
      </tr>
    `;
  }).join('');
}


/* ================================================================
   6. REPORTS
   ================================================================ */
async function renderReports(container) {
  container.innerHTML = `
    <div class="loading-spinner">
      <i class="fa-solid fa-circle-notch fa-spin"></i>
      <p>Loading reports...</p>
    </div>
  `;

  try {
    const [kpiRes, monthlyRes] = await Promise.all([
      apiFetch(`${API_URL}/api/reports/dashboard`),
      apiFetch(`${API_URL}/api/reports/monthly`),
      fetchProducts(),
      fetchOrders()
    ]);
    
    const kpis = kpiRes.ok ? await kpiRes.json() : {};
    const monthlyLogs = monthlyRes.ok ? await monthlyRes.json() : [];

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-info">
          <h1><i class="fa-solid fa-chart-pie" style="color:var(--primary);"></i> Reports & Analytics</h1>
          <p>Analyze your sales performance, customer metrics, and inventory health.</p>
        </div>
      </div>

      <div class="tabs" id="reportsTabs" style="margin-bottom: 20px; position: sticky; top: 0; z-index: 10; background: var(--bg-page); padding-top: 10px;">
        <div class="tab active" data-tab="overview"><i class="fa-solid fa-chart-simple" style="margin-right:6px;"></i>Overview</div>
        <div class="tab" data-tab="analytics"><i class="fa-solid fa-chart-pie" style="margin-right:6px;"></i>Analytics</div>
        <div class="tab" data-tab="customers"><i class="fa-solid fa-users" style="margin-right:6px;"></i>Customers</div>
        <div class="tab" data-tab="alerts"><i class="fa-solid fa-triangle-exclamation" style="margin-right:6px;"></i>Alerts</div>
      </div>

      <div id="reportsTabContent" class="reports-layout">
        <div id="section-overview"></div>
        <div id="section-analytics"></div>
        <div id="section-customers"></div>
        <div id="section-alerts"></div>
      </div>
    `;

    const reportsTabs = container.querySelectorAll('#reportsTabs .tab');
    
    renderReportsOverview(container.querySelector('#section-overview'), kpis, monthlyLogs);
    renderReportsAnalytics(container.querySelector('#section-analytics'), kpis, monthlyLogs);
    renderReportsCustomers(container.querySelector('#section-customers'));
    renderReportsAlerts(container.querySelector('#section-alerts'));

    reportsTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        reportsTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const sectionId = 'section-' + tab.getAttribute('data-tab');
        const section = container.querySelector('#' + sectionId);
        if (section) {
          section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Error loading reports: ${err.message}</p></div>`;
  }
}

function renderReportsOverview(container, kpis, monthlyLogs) {
  const productSales = {};
  orders.forEach(o => {
    if (o.payment_status !== 'Paid') return;
    if (o.items && o.items.length > 0) {
      o.items.forEach(item => {
        if (!productSales[item.product_id]) {
          productSales[item.product_id] = {
            name: item.name || 'Product',
            unitsSold: 0,
            revenue: 0,
            category: 'Category'
          };
        }
        productSales[item.product_id].unitsSold += item.quantity;
        productSales[item.product_id].revenue += item.quantity * item.price;
      });
    }
  });
  const topProducts = Object.values(productSales).sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 5);
  const recentOrders = [...orders].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 5);

  container.innerHTML = `
    <!-- Top row: copper card and KPI cards -->
    <div class="reports-kpi-row" style="margin-bottom: 20px;">
      <div class="reports-copper-card">
        <div>
          <div class="title-row">
            <span>Today's Sales</span>
            <span class="badge">copper</span>
          </div>
          <div class="main-value">${(kpis.totalRevenue || 0).toLocaleString()} Ksh</div>
          <div class="trend">+12.5%</div>
        </div>
      </div>
      
      <div class="reports-white-card">
        <div class="title">Active Orders</div>
        <div class="value">${kpis.pendingOrders || 0}</div>
      </div>
      
      <div class="reports-white-card">
        <div class="title">Stock Alerts</div>
        <div class="value">${products.filter(p=>p.stock<=5).length} <span class="sub-value" style="color:var(--danger); font-size:0.9rem; margin-left:6px; font-weight:600;">low items</span></div>
      </div>
      
      <div class="reports-white-card">
        <div class="title">New Customers</div>
        <div class="value">+8</div>
      </div>
    </div>

    <!-- Middle row: Line chart -->
    <div class="chart-card" style="margin-bottom: 20px;">
      <div style="display:flex; justify-content:flex-end; margin-bottom:16px;">
        <select class="status-select"><option>Weekly</option><option>Monthly</option></select>
      </div>
      <div class="chart-body" style="height: 250px;">
        <canvas id="overviewChart"></canvas>
      </div>
    </div>

    <!-- Bottom row: Tables -->
    <div class="reports-tables-row">
      <div class="table-container" style="margin: 0;">
        <div style="padding:16px 20px; border-bottom:1px solid var(--border);">
          <strong style="color:var(--text-primary); font-size:1.1rem;">Top Performing Items</strong>
        </div>
        <table>
          <thead><tr><th>Item</th><th>Category</th><th>Units Sold</th><th>Revenue</th></tr></thead>
          <tbody>
            ${topProducts.length > 0 ? topProducts.map(p => `
              <tr>
                <td style="font-weight:600;">${p.name}</td>
                <td style="color:var(--text-muted);">${p.category}</td>
                <td>${p.unitsSold}</td>
                <td style="font-weight:600;">${p.revenue.toLocaleString()} Ksh</td>
              </tr>
            `).join('') : `<tr><td colspan="4" class="text-center" style="padding: 20px; color: var(--text-muted);">No sales data available.</td></tr>`}
          </tbody>
        </table>
      </div>
      
      <div class="table-container" style="margin: 0;">
        <div style="padding:16px 20px; border-bottom:1px solid var(--border);">
          <strong style="color:var(--text-primary); font-size:1.1rem;">Recent Orders</strong>
        </div>
        <table>
          <thead><tr><th>Order ID</th><th>Customer</th><th>Items</th><th>Date</th><th>Amount (Ksh)</th></tr></thead>
          <tbody>
            ${recentOrders.length > 0 ? recentOrders.map(o => `
              <tr>
                <td style="color:#C26B45; font-weight:600;">${o.id.toString().padStart(6,'0')}</td>
                <td>${o.customer_name || 'Walk-in'}</td>
                <td>${o.items ? o.items.reduce((sum, i)=>sum+i.quantity,0) : 0}</td>
                <td>${new Date(o.created_at).toLocaleDateString()}</td>
                <td style="font-weight:600;">${o.total_amount.toLocaleString()} Ksh</td>
              </tr>
            `).join('') : `<tr><td colspan="5" class="text-center" style="padding: 20px; color: var(--text-muted);">No orders found.</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;

  // Draw Line Chart
  const sortedLogs = [...monthlyLogs].reverse();
  const labels = sortedLogs.length > 0 ? sortedLogs.map(l => l.month) : ['Oct 8', 'Oct 9', 'Oct 10', 'Oct 11', 'Oct 12', 'Oct 13', 'Oct 14'];
  const revData = sortedLogs.length > 0 ? sortedLogs.map(l => l.totalRevenue) : [11400, 10800, 12000, 14200, 12500, 15400, 12500];
  const ctx = document.getElementById('overviewChart').getContext('2d');
  
  if (charts.overviewChart) charts.overviewChart.destroy();

  const isDark = theme === 'dark';
  const lineColor = '#A85A3C';
  const gradient = ctx.createLinearGradient(0, 0, 0, 250);
  gradient.addColorStop(0, 'rgba(168, 90, 60, 0.4)');
  gradient.addColorStop(1, 'rgba(168, 90, 60, 0.0)');

  charts.overviewChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        data: revData,
        borderColor: lineColor,
        backgroundColor: gradient,
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointBackgroundColor: 'white',
        pointBorderColor: lineColor,
        pointBorderWidth: 2,
        pointRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: isDark ? '#9ca3af' : '#64748b' } },
        y: { grid: { color: isDark ? '#1f2937' : '#e2e8f0' }, ticks: { color: isDark ? '#9ca3af' : '#64748b' } }
      }
    }
  });
}

function renderReportsAnalytics(container, kpis, monthlyLogs) {
  // Compute category sales
  const categorySales = {};
  orders.forEach(o => {
    if (o.payment_status !== 'Paid') return;
    if (o.items && o.items.length > 0) {
      o.items.forEach(item => {
        const prod = products.find(p => p.id === item.product_id);
        const cat = prod?.category || 'Uncategorized';
        categorySales[cat] = (categorySales[cat] || 0) + (item.quantity * item.price);
      });
    }
  });

  const categories = Object.keys(categorySales);
  const salesAmounts = Object.values(categorySales);

  // Compute top products units sold
  const productSales = {};
  orders.forEach(o => {
    if (o.payment_status !== 'Paid') return;
    if (o.items && o.items.length > 0) {
      o.items.forEach(item => {
        if (!productSales[item.product_id]) {
          productSales[item.product_id] = {
            name: item.name || 'Product',
            unitsSold: 0,
            revenue: 0
          };
        }
        productSales[item.product_id].unitsSold += item.quantity;
        productSales[item.product_id].revenue += item.quantity * item.price;
      });
    }
  });

  const topProducts = Object.values(productSales).sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 5);

  container.innerHTML = `
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; align-items: start;">
      <!-- Category Chart Card -->
      <div class="chart-card" style="margin: 0; padding: 24px;">
        <div class="chart-card-title">Category Sales Breakdown</div>
        <div class="chart-body" style="height: 250px; position: relative;">
          ${categories.length > 0 ? `<canvas id="categoryChart"></canvas>` : `
            <div class="empty-state" style="padding: 40px 0;">
              <i class="fa-solid fa-chart-pie" style="font-size: 2.5rem; color: var(--text-faint); margin-bottom: 12px;"></i>
              <p>No category sales data yet</p>
            </div>
          `}
        </div>
      </div>

      <!-- Top Selling Products Card -->
      <div class="table-container" style="margin: 0; padding-bottom: 10px;">
        <div style="padding:16px 20px; border-bottom:1px solid var(--border);">
          <strong style="color:var(--text-primary);">Top Selling Products</strong>
        </div>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th class="text-right">Units Sold</th>
              <th class="text-right">Total Revenue</th>
            </tr>
          </thead>
          <tbody>
            ${topProducts.length > 0 ? topProducts.map(p => `
              <tr>
                <td style="font-weight: 600; color: var(--text-primary);">${p.name}</td>
                <td class="text-right">${p.unitsSold}</td>
                <td class="text-right" style="font-weight: 600; color: var(--primary);">Ksh ${p.revenue.toLocaleString()}</td>
              </tr>
            `).join('') : `
              <tr>
                <td colspan="3" class="text-center" style="padding: 40px; color: var(--text-muted);">No product sales data available.</td>
              </tr>
            `}
          </tbody>
        </table>
      </div>
    </div>
  `;

  if (categories.length > 0) {
    const ctx = document.getElementById('categoryChart').getContext('2d');
    const colors = getCategoryColors();
    const isDark = theme === 'dark';
    
    if (charts.categoryChart) charts.categoryChart.destroy();
    
    charts.categoryChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: categories,
        datasets: [{
          data: salesAmounts,
          backgroundColor: colors.slice(0, categories.length),
          borderWidth: isDark ? 2 : 1,
          borderColor: isDark ? '#1f2937' : '#ffffff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: isDark ? '#9ca3af' : '#64748b',
              font: { family: 'Inter', size: 11 }
            }
          }
        }
      }
    });
  }
}

function renderReportsCustomers(container) {
  // Derive customers from orders
  const customerMap = {};
  orders.forEach(o => {
    const name = o.customer_name || 'Walk-in Customer';
    if (name === 'Online Customer' || name === 'Walk-in Customer') return;
    if (!customerMap[name]) {
      customerMap[name] = {
        name,
        phone: o.customer_phone || '',
        orders: 0,
        totalSpent: 0,
        lastOrder: o.created_at
      };
    }
    customerMap[name].orders += 1;
    if (o.payment_status === 'Paid') customerMap[name].totalSpent += o.total_amount;
  });

  const topCustomers = Object.values(customerMap).sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 10);

  container.innerHTML = `
    <div class="table-container" style="margin-top: 20px;">
      <div style="padding:16px 20px; border-bottom:1px solid var(--border);">
        <strong style="color:var(--text-primary);">Top Customers Leaderboard</strong>
      </div>
      <table>
        <thead>
          <tr>
            <th>Customer</th>
            <th>Phone</th>
            <th class="text-center">Orders</th>
            <th class="text-right">Total Spent</th>
            <th>Last Purchase</th>
          </tr>
        </thead>
        <tbody>
          ${topCustomers.length > 0 ? topCustomers.map(c => {
            const initials = c.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
            const colors = ['#a78bfa', '#818cf8', '#f472b6', '#34d399', '#fbbf24', '#60a5fa'];
            const color = colors[c.name.length % colors.length];
            return `
              <tr>
                <td>
                  <div class="customer-info" style="display:flex; align-items:center; gap:10px;">
                    <div class="customer-avatar" style="background:${color}; width:30px; height:30px; border-radius:50%; display:flex; align-items:center; justify-content:center; color:#fff; font-size:0.8rem; font-weight:600;">${initials}</div>
                    <span class="customer-name" style="font-weight: 600;">${c.name}</span>
                  </div>
                </td>
                <td>${c.phone || '<span style="color:var(--text-faint);">No phone</span>'}</td>
                <td class="text-center" style="font-weight:600;">${c.orders}</td>
                <td class="text-right" style="font-weight:700; color: var(--success);">Ksh ${c.totalSpent.toLocaleString()}</td>
                <td>${new Date(c.lastOrder).toLocaleDateString()}</td>
              </tr>
            `;
          }).join('') : `
            <tr>
              <td colspan="5" class="text-center" style="padding: 40px; color: var(--text-muted);">No customer data available yet.</td>
            </tr>
          `}
        </tbody>
      </table>
    </div>
  `;
}

function renderReportsAlerts(container) {
  // Find low stock products
  const lowStock = products.filter(p => p.stock <= 5);

  container.innerHTML = `
    <div class="table-container" style="margin-top: 20px;">
      <div style="padding:16px 20px; border-bottom:1px solid var(--border); display: flex; justify-content: space-between; align-items: center;">
        <strong style="color:var(--text-primary);">Low Stock Restock Alerts</strong>
        <span class="badge ${lowStock.length > 0 ? 'badge-danger' : 'badge-success'}">
          ${lowStock.length} items low
        </span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th>Category</th>
            <th class="text-center">Stock Level</th>
            <th class="text-right">Unit Price</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${lowStock.length > 0 ? lowStock.map(p => {
            const isOut = p.stock === 0;
            return `
              <tr>
                <td style="font-weight: 600; color: var(--text-primary);">${p.name}</td>
                <td>${p.category || 'Uncategorized'}</td>
                <td class="text-center" style="font-weight: 700; color: ${isOut ? 'var(--danger)' : 'var(--warning)'};">
                  ${p.stock} units
                </td>
                <td class="text-right">Ksh ${p.price.toLocaleString()}</td>
                <td>
                  <span class="badge ${isOut ? 'badge-danger' : 'badge-warning'}">
                    ${isOut ? 'Out of Stock' : 'Low Stock'}
                  </span>
                </td>
              </tr>
            `;
          }).join('') : `
            <tr>
              <td colspan="5" class="text-center" style="padding: 40px; color: var(--success); font-weight: 500;">
                <i class="fa-solid fa-circle-check" style="margin-right: 8px;"></i> All inventory levels are healthy!
              </td>
            </tr>
          `}
        </tbody>
      </table>
    </div>
  `;
}


/* ================================================================
   7. CUSTOMERS
   ================================================================ */
async function renderCustomers(container) {
  container.innerHTML = `
    <div class="loading-spinner">
      <i class="fa-solid fa-circle-notch fa-spin"></i>
      <p>Loading customers...</p>
    </div>
  `;

  try {
    const res = await apiFetch(`${API_URL}/api/customers`);
    let customers = [];
    if (res.ok) {
      customers = await res.json();
    } else {
      throw new Error('API failed');
    }

    customers.sort((a, b) => b.totalSpent - a.totalSpent);

    container.innerHTML = `
      <div class="page-header">
        <div class="page-header-info">
          <h1><i class="fa-solid fa-users" style="color:var(--primary);"></i> Customers</h1>
          <p>Manage your customer relationships.</p>
        </div>
        <div class="page-header-actions">
          <button class="btn btn-primary" id="addCustomerBtn">
            <i class="fa-solid fa-plus"></i> Add Customer
          </button>
        </div>
      </div>

      <div class="filter-toolbar">
        <div class="search-bar" style="max-width:400px;">
          <i class="fa-solid fa-magnifying-glass"></i>
          <input type="text" id="custSearchInput" placeholder="Search customers...">
        </div>
      </div>

      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Contact</th>
              <th>Orders</th>
              <th>Total Spent</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${customers.length > 0 ? customers.map(c => {
              const initials = c.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
              const joinDate = new Date(c.firstOrder).toLocaleDateString('en-US', { year:'numeric', month:'short' });
              const colors = ['#a78bfa', '#818cf8', '#f472b6', '#34d399', '#fbbf24', '#60a5fa'];
              const color = colors[c.name.length % colors.length];
              return `
                <tr>
                  <td>
                    <div class="customer-info">
                      <div class="customer-avatar" style="background:${color};">${initials}</div>
                      <div class="customer-details">
                        <span class="customer-name">${c.name}</span>
                        <span class="customer-date">Joined ${joinDate}</span>
                      </div>
                    </div>
                  </td>
                  <td>${c.phone ? `<i class="fa-solid fa-phone" style="color:var(--text-faint); font-size:0.7rem;"></i> ${c.phone}` : '<span style="color:var(--text-faint);">No contact</span>'}</td>
                  <td style="font-weight:600;">${c.orders}</td>
                  <td style="font-weight:700;">Ksh ${c.totalSpent.toLocaleString()}</td>
                  <td><span class="badge badge-success">Active</span></td>
                  <td><button class="btn-icon"><i class="fa-solid fa-ellipsis"></i></button></td>
                </tr>
              `;
            }).join('') : `<tr><td colspan="6" class="text-center" style="padding:40px; color:var(--text-muted);">No customers found. Sales data will populate customers automatically.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    container.querySelector('#addCustomerBtn').addEventListener('click', showAddCustomerModal);
    const searchInput = container.querySelector('#custSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        container.querySelectorAll('tbody tr').forEach(row => {
          const nameEl = row.querySelector('.customer-name');
          const nameText = nameEl ? nameEl.textContent.toLowerCase() : '';
          const phoneText = row.textContent.toLowerCase();
          row.style.display = (nameText.includes(q) || phoneText.includes(q)) ? 'table-row' : 'none';
        });
      });
    }

  } catch (err) {
    container.innerHTML = `<div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Error loading customers</p></div>`;
  }
}


/* ================================================================
   8. CHANNEL INTEGRATIONS
   ================================================================ */
function renderIntegrations(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-info">
        <h1><i class="fa-solid fa-plug" style="color:var(--primary);"></i> Channel Integrations</h1>
        <p>Connect your store to external sales channels and platforms.</p>
      </div>
    </div>

    <div class="integrations-grid">
      <div class="integration-card">
        <div class="integration-card-header">
          <div class="integration-card-icon" style="background:#dcfce7; color:#16a34a;">
            <i class="fa-brands fa-whatsapp"></i>
          </div>
          <div>
            <div class="integration-card-name">WhatsApp Business</div>
            <span class="badge badge-gray">Not Connected</span>
          </div>
        </div>
        <div class="integration-card-desc">Accept orders directly from WhatsApp messages and automate responses.</div>
        <button class="btn btn-outline btn-sm">Connect</button>
      </div>

      <div class="integration-card">
        <div class="integration-card-header">
          <div class="integration-card-icon" style="background:#dbeafe; color:#2563eb;">
            <i class="fa-solid fa-globe"></i>
          </div>
          <div>
            <div class="integration-card-name">Online Storefront</div>
            <span class="badge badge-success">Active</span>
          </div>
        </div>
        <div class="integration-card-desc">Your public-facing e-commerce store for online orders and payments.</div>
        <button class="btn btn-outline btn-sm">Manage</button>
      </div>

      <div class="integration-card">
        <div class="integration-card-header">
          <div class="integration-card-icon" style="background:#fef3c7; color:#d97706;">
            <i class="fa-solid fa-mobile-screen-button"></i>
          </div>
          <div>
            <div class="integration-card-name">M-Pesa Daraja API</div>
            <span class="badge badge-success">Active</span>
          </div>
        </div>
        <div class="integration-card-desc">Process M-Pesa payments, STK push, and transaction reconciliation.</div>
        <button class="btn btn-outline btn-sm">Configure</button>
      </div>

      <div class="integration-card">
        <div class="integration-card-header">
          <div class="integration-card-icon" style="background:#fee2e2; color:#dc2626;">
            <i class="fa-brands fa-instagram"></i>
          </div>
          <div>
            <div class="integration-card-name">Instagram Shop</div>
            <span class="badge badge-gray">Not Connected</span>
          </div>
        </div>
        <div class="integration-card-desc">Sync your product catalog with Instagram Shopping for social commerce.</div>
        <button class="btn btn-outline btn-sm">Connect</button>
      </div>

      <div class="integration-card">
        <div class="integration-card-header">
          <div class="integration-card-icon" style="background:#ede9fe; color:#7c3aed;">
            <i class="fa-solid fa-robot"></i>
          </div>
          <div>
            <div class="integration-card-name">AI Assistant</div>
            <span class="badge badge-success">Active</span>
          </div>
        </div>
        <div class="integration-card-desc">AI-powered inventory recommendations and restocking alerts.</div>
        <button class="btn btn-outline btn-sm">Manage</button>
      </div>

      <div class="integration-card">
        <div class="integration-card-header">
          <div class="integration-card-icon" style="background:#f3f4f6; color:#6b7280;">
            <i class="fa-solid fa-truck-fast"></i>
          </div>
          <div>
            <div class="integration-card-name">Delivery Partners</div>
            <span class="badge badge-gray">Coming Soon</span>
          </div>
        </div>
        <div class="integration-card-desc">Connect with local delivery partners for order fulfillment.</div>
        <button class="btn btn-outline btn-sm" disabled>Coming Soon</button>
      </div>
    </div>
  `;
  setupIntegrationsHandlers(container);
}


/* ================================================================
   9. PRODUCT SETTINGS
   ================================================================ */
function renderProductSettings(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-info">
        <h1><i class="fa-solid fa-sliders" style="color:var(--primary);"></i> Product Settings</h1>
        <p>Configure categories, taxes, and product display options.</p>
      </div>
    </div>

    <div class="settings-grid">
      <div class="settings-card">
        <div class="settings-card-title">Categories</div>
        <div class="settings-card-desc">Manage product categories and organize your catalog.</div>
        <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
          ${[...new Set(products.map(p => p.category).filter(Boolean))].map(cat => 
            `<span class="badge badge-info">${cat}</span>`
          ).join('')}
          ${products.length === 0 ? '<span class="badge badge-gray">No categories yet</span>' : ''}
        </div>
        <button class="btn btn-outline btn-sm"><i class="fa-solid fa-plus"></i> Add Category</button>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">Tax Configuration</div>
        <div class="settings-card-desc">Set up tax rates for your products.</div>
        <div style="padding:12px; background:var(--bg-input); border-radius:var(--radius-sm); margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; font-size:0.88rem;">
            <span style="color:var(--text-secondary);">VAT Rate</span>
            <strong>16%</strong>
          </div>
        </div>
        <button class="btn btn-outline btn-sm"><i class="fa-solid fa-pen"></i> Edit Tax</button>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">Low Stock Alerts</div>
        <div class="settings-card-desc">Get notified when products fall below threshold.</div>
        <div style="padding:12px; background:var(--bg-input); border-radius:var(--radius-sm); margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; font-size:0.88rem;">
            <span style="color:var(--text-secondary);">Threshold</span>
            <strong>5 units</strong>
          </div>
        </div>
        <button class="btn btn-outline btn-sm"><i class="fa-solid fa-bell"></i> Configure</button>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">SKU Format</div>
        <div class="settings-card-desc">Auto-generate SKU codes for new products.</div>
        <div style="padding:12px; background:var(--bg-input); border-radius:var(--radius-sm); margin-bottom:12px; font-family:monospace; font-size:0.85rem; color:var(--text-secondary);">
          {CATEGORY}-{NAME}-{ID}
        </div>
        <button class="btn btn-outline btn-sm"><i class="fa-solid fa-pen"></i> Edit Format</button>
      </div>
    </div>
  `;
}


/* ================================================================
   10. STORE SETTINGS
   ================================================================ */
function renderStoreSettings(container) {
  container.innerHTML = `
    <div class="page-header">
      <div class="page-header-info">
        <h1><i class="fa-solid fa-gear" style="color:var(--primary);"></i> Store Settings</h1>
        <p>Configure your store profile and preferences.</p>
      </div>
    </div>

    <div class="settings-grid">
      <div class="settings-card">
        <div class="settings-card-title">Store Profile</div>
        <div class="settings-card-desc">Basic information about your store.</div>
        <div class="form-group">
          <label>Store Name</label>
          <input type="text" value="Main Store" style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg-input); color:var(--text-primary); font-size:0.9rem;">
        </div>
        <div class="form-group">
          <label>Currency</label>
          <input type="text" value="KES (Ksh)" readonly style="width:100%; padding:10px 14px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg-input); color:var(--text-primary); font-size:0.9rem;">
        </div>
        <button class="btn btn-primary btn-sm"><i class="fa-solid fa-check"></i> Save Changes</button>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">Business Hours</div>
        <div class="settings-card-desc">Set your operating schedule.</div>
        <div style="display:flex; flex-direction:column; gap:8px; font-size:0.88rem; margin-bottom:12px;">
          ${['Mon-Fri', 'Saturday', 'Sunday'].map(day => `
            <div style="display:flex; justify-content:space-between; padding:8px 12px; background:var(--bg-input); border-radius:var(--radius-sm);">
              <span style="color:var(--text-secondary);">${day}</span>
              <strong>${day === 'Sunday' ? 'Closed' : day === 'Saturday' ? '9:00 AM - 6:00 PM' : '8:00 AM - 8:00 PM'}</strong>
            </div>
          `).join('')}
        </div>
        <button class="btn btn-outline btn-sm"><i class="fa-solid fa-pen"></i> Edit Hours</button>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">Payment Methods</div>
        <div class="settings-card-desc">Configure accepted payment methods.</div>
        <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:12px;">
          ${[
            { name: 'Cash', icon: 'fa-money-bill-wave', active: true },
            { name: 'M-Pesa', icon: 'fa-mobile-screen', active: true },
            { name: 'Card', icon: 'fa-credit-card', active: false }
          ].map(m => `
            <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:var(--bg-input); border-radius:var(--radius-sm);">
              <span style="display:flex; align-items:center; gap:8px; color:var(--text-secondary);">
                <i class="fa-solid ${m.icon}"></i> ${m.name}
              </span>
              <span class="badge ${m.active ? 'badge-success' : 'badge-gray'}">${m.active ? 'Active' : 'Disabled'}</span>
            </div>
          `).join('')}
        </div>
        <button class="btn btn-outline btn-sm"><i class="fa-solid fa-cog"></i> Manage</button>
      </div>

      <div class="settings-card">
        <div class="settings-card-title">Data & Privacy</div>
        <div class="settings-card-desc">Export or clear your store data.</div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <button class="btn btn-outline btn-sm"><i class="fa-solid fa-download"></i> Export All Data</button>
          <button class="btn btn-outline btn-sm" style="color:var(--danger); border-color:var(--danger);">
            <i class="fa-solid fa-trash"></i> Clear All Data
          </button>
        </div>
      </div>
    </div>
  `;
}

// ─── Modals ───

let currentPosCustomer = null;

function showCustomerSelectModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  
  // Extract unique customers
  const customerNames = [...new Set(orders.map(o => o.customer_name).filter(n => n && n !== 'Online Customer' && n !== 'Walk-in Customer'))];
  
  overlay.innerHTML = `
    <div class="modal-content">
      <div class="modal-header">
        <div class="modal-title">Select Customer</div>
      </div>
      <div class="modal-body" style="display:flex; flex-direction:column; gap:12px;">
        <input type="text" id="custSearch" placeholder="Search customer name..." style="width:100%; padding:10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg-input); color:var(--text-primary);">
        <div id="custList" style="max-height:200px; overflow-y:auto; border:1px solid var(--border); border-radius:var(--radius-sm);">
          ${customerNames.length === 0 ? '<div style="padding:10px; color:var(--text-muted); text-align:center;">No customers found.</div>' : ''}
          ${customerNames.map(name => `
            <div class="cust-item" data-name="${name}" style="padding:10px; border-bottom:1px solid var(--border); cursor:pointer;">
              ${name}
            </div>
          `).join('')}
        </div>
        <hr style="border:0; border-top:1px dashed var(--border); margin:10px 0;">
        <p style="font-size:0.85rem; color:var(--text-muted); margin:0;">Or enter a new customer name:</p>
        <input type="text" id="newCustName" placeholder="New customer name" style="width:100%; padding:10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg-input); color:var(--text-primary);">
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="custCancel">Cancel</button>
        <button class="btn btn-primary" id="custConfirm">Confirm</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Search filtering
  overlay.querySelector('#custSearch').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    overlay.querySelectorAll('.cust-item').forEach(item => {
      item.style.display = item.getAttribute('data-name').toLowerCase().includes(q) ? 'block' : 'none';
    });
  });

  // Select from list
  overlay.querySelectorAll('.cust-item').forEach(item => {
    item.addEventListener('click', () => {
      overlay.querySelectorAll('.cust-item').forEach(i => i.style.background = 'transparent');
      item.style.background = 'var(--bg-input)';
      overlay.querySelector('#newCustName').value = item.getAttribute('data-name');
    });
  });

  overlay.querySelector('#custCancel').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#custConfirm').addEventListener('click', () => {
    const name = overlay.querySelector('#newCustName').value.trim();
    if (name) {
      currentPosCustomer = name;
      document.querySelector('.cart-customer-info span').innerText = name;
      showToast(`Customer set to ${name}`, 'success');
    }
    overlay.remove();
  });
}

function viewOrderDetails(orderId) {
  const order = orders.find(o => String(o.id) === String(orderId));
  if (!order) return;

  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  
  const displayId = `#ORD-${new Date(order.created_at).getFullYear()}-${String(order.id).padStart(6, '0')}`;
  const itemsHtml = order.items && order.items.length > 0 ? order.items.map(i => `
    <div style="display:flex; justify-content:space-between; margin-bottom:8px; font-size:0.9rem;">
      <span style="color:var(--text-secondary);">${i.quantity}x ${i.name || 'Product'}</span>
      <span style="color:var(--text-primary); font-weight:500;">KES ${(i.quantity * i.price).toLocaleString()}</span>
    </div>
  `).join('') : '<p style="color:var(--text-muted); font-size:0.9rem;">No items found.</p>';

  overlay.innerHTML = `
    <div class="modal-content" style="max-width:500px;">
      <div class="modal-header">
        <div class="modal-title">Receipt Details</div>
      </div>
      <div class="modal-body" style="padding:24px;">
        <div style="text-align:center; margin-bottom:20px;">
          <h2 style="margin:0; font-size:1.5rem; color:var(--text-primary);">${displayId}</h2>
          <p style="margin:4px 0 0 0; color:var(--text-muted);">${new Date(order.created_at).toLocaleString()}</p>
        </div>
        
        <div style="background:var(--bg-input); padding:16px; border-radius:var(--radius-sm); margin-bottom:20px;">
          <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <span style="color:var(--text-muted);">Customer:</span>
            <span style="color:var(--text-primary); font-weight:500;">${order.customer_name || 'Walk-in'}</span>
          </div>
          <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
            <span style="color:var(--text-muted);">Payment:</span>
            <span style="color:var(--text-primary); font-weight:500;">${order.payment_method} (${order.payment_status})</span>
          </div>
          <div style="display:flex; justify-content:space-between;">
            <span style="color:var(--text-muted);">Status:</span>
            <span style="color:var(--text-primary); font-weight:500;">${order.order_status}</span>
          </div>
        </div>
        
        <h3 style="font-size:1rem; margin-bottom:12px; color:var(--text-primary); border-bottom:1px solid var(--border); padding-bottom:8px;">Items</h3>
        ${itemsHtml}
        
        <div style="display:flex; justify-content:space-between; margin-top:20px; padding-top:16px; border-top:2px dashed var(--border);">
          <span style="font-size:1.2rem; font-weight:600; color:var(--text-primary);">Total</span>
          <span style="font-size:1.2rem; font-weight:700; color:var(--primary);">KES ${order.total_amount.toLocaleString()}</span>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-primary" id="closeReceiptBtn" style="width:100%;">Close Receipt</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  
  overlay.querySelector('#closeReceiptBtn').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
}

/* ================================================================
   11. HELPER UTILITIES, MODALS, AND GLOBAL NOTIFICATIONS
   ================================================================ */

// Helper to compress and convert images to Base64 (max 400px, 0.7 JPEG quality)
function compressAndBase64(file, callback) {
  const reader = new FileReader();
  reader.onload = function (e) {
    const img = new Image();
    img.onload = function () {
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;
      
      const MAX_SIZE = 400;
      if (width > height) {
        if (width > MAX_SIZE) {
          height *= MAX_SIZE / width;
          width = MAX_SIZE;
        }
      } else {
        if (height > MAX_SIZE) {
          width *= MAX_SIZE / height;
          height = MAX_SIZE;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      
      // Convert to compressed jpeg base64
      const compressedBase64 = canvas.toDataURL('image/jpeg', 0.7);
      callback(compressedBase64);
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

// ─── Global Notifications Feed ───
let notifications = [
  { id: 1, title: 'System Active', desc: 'OmniPOS server started and synced with database', time: '10m ago', type: 'reconcile', read: false, view: 'dashboard' },
  { id: 2, title: 'Low Stock Alert', desc: 'Oraimo FreePods 4 is running low on stock', time: '30m ago', type: 'warning', read: false, view: 'inventory' },
  { id: 3, title: 'AI Recommendation', desc: 'AI pricing recommendations available for Electronics', time: '2h ago', type: 'ai', read: true, view: 'dashboard' }
];

function addNotification(title, desc, type = 'info', view = 'dashboard') {
  notifications.unshift({
    id: Date.now(),
    title,
    desc,
    time: 'Just now',
    type,
    read: false,
    view
  });
  updateNotificationsUI();
}

function updateNotificationsUI() {
  const bell = document.querySelector('.notification-bell');
  if (!bell) return;
  
  const unreadCount = notifications.filter(n => !n.read).length;
  let dot = bell.querySelector('.badge-dot');
  
  if (unreadCount > 0) {
    if (!dot) {
      dot = document.createElement('span');
      dot.className = 'badge-dot';
      bell.appendChild(dot);
    }
  } else {
    if (dot) dot.remove();
  }

  const dropdown = document.querySelector('.notifications-dropdown');
  if (dropdown) {
    renderNotificationsList(dropdown.querySelector('.notifications-list'));
  }
}

function toggleNotificationsDropdown(e) {
  e.stopPropagation();
  let dropdown = document.querySelector('.notifications-dropdown');
  
  if (dropdown) {
    dropdown.remove();
    return;
  }
  
  dropdown = document.createElement('div');
  dropdown.className = 'notifications-dropdown';
  dropdown.innerHTML = `
    <div class="notifications-header">
      <h3>Notifications</h3>
      <button id="markAllReadBtn" style="color:var(--primary); font-size:0.8rem; background:none; border:none; cursor:pointer;">Mark all read</button>
    </div>
    <div class="notifications-list"></div>
    <div class="notifications-footer">
      <button id="clearAllNotificationsBtn" style="color:var(--danger); font-size:0.8rem; background:none; border:none; cursor:pointer;">Clear all</button>
    </div>
  `;
  
  const bell = document.querySelector('.notification-bell');
  bell.appendChild(dropdown);
  
  const listContainer = dropdown.querySelector('.notifications-list');
  renderNotificationsList(listContainer);
  
  dropdown.querySelector('#markAllReadBtn').addEventListener('click', (ev) => {
    ev.stopPropagation();
    notifications.forEach(n => n.read = true);
    updateNotificationsUI();
  });
  
  dropdown.querySelector('#clearAllNotificationsBtn').addEventListener('click', (ev) => {
    ev.stopPropagation();
    notifications = [];
    updateNotificationsUI();
    dropdown.remove();
  });
  
  const closeDropdown = (event) => {
    if (!dropdown.contains(event.target) && event.target !== bell && !bell.contains(event.target)) {
      dropdown.remove();
      document.removeEventListener('click', closeDropdown);
    }
  };
  document.addEventListener('click', closeDropdown);
}

function renderNotificationsList(container) {
  if (!container) return;
  
  if (notifications.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        <i class="fa-regular fa-bell-slash" style="font-size: 1.5rem; margin-bottom: 8px; display: block; opacity: 0.5;"></i>
        All caught up!
      </div>
    `;
    return;
  }
  
  container.innerHTML = notifications.map(n => {
    let icon = 'fa-info-circle';
    let bg = '#e0f2fe';
    let color = '#0284c7';
    if (n.type === 'reconcile') {
      icon = 'fa-circle-check'; bg = '#dcfce7'; color = '#15803d';
    } else if (n.type === 'warning') {
      icon = 'fa-triangle-exclamation'; bg = '#fef3c7'; color = '#b45309';
    } else if (n.type === 'ai') {
      icon = 'fa-robot'; bg = '#f3e8ff'; color = '#7e22ce';
    }
    
    return `
      <div class="notification-item ${n.read ? '' : 'unread'}" data-id="${n.id}">
        <div class="notification-icon" style="background:${bg}; color:${color};">
          <i class="fa-solid ${icon}"></i>
        </div>
        <div class="notification-content">
          <div class="notification-title">${n.title}</div>
          <div class="notification-desc">${n.desc}</div>
          <div class="notification-time">${n.time}</div>
        </div>
      </div>
    `;
  }).join('');
  
  container.querySelectorAll('.notification-item').forEach(item => {
    item.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = parseInt(item.getAttribute('data-id'));
      const notif = notifications.find(n => n.id === id);
      if (notif) {
        notif.read = true;
        updateNotificationsUI();
        document.querySelector('.notifications-dropdown')?.remove();
        
        if (notif.view) {
          showView(notif.view);
          const navItem = document.querySelector(`.nav-item[data-view="${notif.view}"]`);
          if (navItem) {
            document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
            navItem.classList.add('active');
          }
        }
      }
    });
  });
}

// ─── Admin Profile Settings Modal ───
function showProfileEditModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  
  const metadata = currentSession?.user?.user_metadata || {};
  const currentName = metadata.name || '';
  const currentStore = metadata.store_name || 'Main Store';
  const currentAvatar = metadata.avatar_url || '';
  
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:480px;">
      <div class="modal-header">
        <div class="modal-title"><i class="fa-solid fa-user-gear" style="color:var(--primary); margin-right:8px;"></i> Profile & Store Settings</div>
      </div>
      <div class="modal-body" style="display:flex; flex-direction:column; gap:16px;">
        <div class="form-group">
          <label>Profile Avatar</label>
          <div style="display:flex; align-items:center; gap:16px; margin-top:8px;">
            <div id="profileAvatarPreview" style="width:64px; height:64px; border-radius:50%; border:1px solid var(--border); overflow:hidden; display:flex; align-items:center; justify-content:center; background:var(--bg-input); font-size:1.5rem; font-weight:bold; color:var(--primary); flex-shrink:0;">
              ${currentAvatar ? `<img src="${currentAvatar}" style="width:100%; height:100%; object-fit:cover;">` : (currentName ? currentName.charAt(0).toUpperCase() : 'A')}
            </div>
            <button class="btn btn-outline btn-sm" id="uploadAvatarBtn" type="button">Upload Photo</button>
            <button class="btn btn-outline btn-sm" id="removeAvatarBtn" type="button" style="color:var(--danger); border-color:var(--danger);">Remove</button>
            <input type="file" id="avatarFileInput" accept="image/*" style="display:none;">
          </div>
        </div>
        <div class="form-group">
          <label>Display Name</label>
          <input type="text" id="profileName" value="${currentName}" placeholder="e.g. John Doe">
        </div>
        <div class="form-group">
          <label>Store Name</label>
          <input type="text" id="profileStoreName" value="${currentStore}" placeholder="e.g. Nairobi Smart POS">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="profileCancel">Cancel</button>
        <button class="btn btn-primary" id="profileSave">
          <i class="fa-solid fa-check"></i> Save Changes
        </button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  let tempAvatarUrl = currentAvatar;
  
  overlay.querySelector('#profileCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (ev) => { if (ev.target === overlay) overlay.remove(); });
  
  const fileInput = overlay.querySelector('#avatarFileInput');
  const avatarPreview = overlay.querySelector('#profileAvatarPreview');
  
  overlay.querySelector('#uploadAvatarBtn').addEventListener('click', () => fileInput.click());
  overlay.querySelector('#removeAvatarBtn').addEventListener('click', () => {
    tempAvatarUrl = '';
    avatarPreview.innerHTML = overlay.querySelector('#profileName').value.trim().charAt(0).toUpperCase() || 'A';
  });
  
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      compressAndBase64(fileInput.files[0], (base64Data) => {
        tempAvatarUrl = base64Data;
        avatarPreview.innerHTML = `<img src="${base64Data}" style="width:100%; height:100%; object-fit:cover;">`;
      });
    }
  });
  
  overlay.querySelector('#profileSave').addEventListener('click', async () => {
    const name = overlay.querySelector('#profileName').value.trim();
    const store_name = overlay.querySelector('#profileStoreName').value.trim();
    
    if (!supabaseClient) {
      showToast('Authentication not initialized.', 'error');
      return;
    }
    
    try {
      const { data, error } = await supabaseClient.auth.updateUser({
        data: {
          name,
          store_name: store_name || 'Main Store',
          avatar_url: tempAvatarUrl
        }
      });
      
      if (error) {
        showToast('Update failed: ' + error.message, 'error');
      } else {
        showToast('Settings saved successfully.', 'success');
        overlay.remove();
        
        // Refresh session and UI
        const { data: { session } } = await supabaseClient.auth.getSession();
        handleAuthChange(session);
      }
    } catch (err) {
      showToast('Network error updating profile.', 'error');
    }
  });
}

// ─── Stock Verification report ───
function triggerStockVerification() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:400px; text-align:center; padding:40px;">
      <i class="fa-solid fa-spinner fa-spin" style="font-size:2.5rem; color:var(--primary); margin-bottom:16px;"></i>
      <div class="modal-title">Auditing Inventory Levels...</div>
      <p style="color:var(--text-muted); font-size:0.9rem; margin-top:8px;">Running discrepancy checks and compiling velocity metrics...</p>
    </div>
  `;
  document.body.appendChild(overlay);
  
  setTimeout(() => {
    overlay.remove();
    showVerificationReport();
  }, 1500);
}

function showVerificationReport() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  
  const totalItems = products.length;
  const outOfStock = products.filter(p => p.stock <= 0).length;
  const lowStock = products.filter(p => p.stock > 0 && p.stock <= 5).length;
  const negativeItems = products.filter(p => p.stock < 0);
  
  const hasDiscrepancy = negativeItems.length > 0;
  
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:500px;">
      <div class="modal-header">
        <div class="modal-title"><i class="fa-solid fa-shield-halved" style="color:var(--primary); margin-right:8px;"></i> Stock Audit Report</div>
      </div>
      <div class="modal-body" style="display:flex; flex-direction:column; gap:16px;">
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; text-align:center;">
          <div style="background:var(--bg-input); padding:12px; border-radius:var(--radius-sm);">
            <div style="font-size:1.5rem; font-weight:700; color:var(--text-primary);">${totalItems}</div>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">Total Items</div>
          </div>
          <div style="background:var(--bg-input); padding:12px; border-radius:var(--radius-sm);">
            <div style="font-size:1.5rem; font-weight:700; color:${lowStock > 0 ? 'var(--warning)' : 'var(--text-primary)'};">${lowStock}</div>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">Low Stock</div>
          </div>
          <div style="background:var(--bg-input); padding:12px; border-radius:var(--radius-sm);">
            <div style="font-size:1.5rem; font-weight:700; color:${outOfStock > 0 ? 'var(--danger)' : 'var(--text-primary)'};">${outOfStock}</div>
            <div style="font-size:0.75rem; color:var(--text-muted); margin-top:4px;">Out of Stock</div>
          </div>
        </div>
        
        <div style="border:1px solid var(--border); border-radius:var(--radius-sm); padding:16px; background:${hasDiscrepancy ? 'rgba(239, 68, 68, 0.05)' : 'rgba(16, 185, 129, 0.05)'};">
          <div style="display:flex; align-items:center; gap:10px; font-weight:600; font-size:0.9rem; color:${hasDiscrepancy ? 'var(--danger)' : 'var(--success)'};">
            <i class="fa-solid ${hasDiscrepancy ? 'fa-triangle-exclamation' : 'fa-circle-check'}"></i>
            ${hasDiscrepancy ? 'Stock Discrepancies Found!' : 'Inventory Levels Verified!'}
          </div>
          <p style="font-size:0.8rem; color:var(--text-muted); margin-top:6px; line-height:1.4;">
            ${hasDiscrepancy ? `We found ${negativeItems.length} product(s) with negative stock counts. Negative stock can occur due to un-reconciled orders or entry errors.` : 'All product stock quantities are consistent. No negative stock levels or discrepancies detected.'}
          </p>
          ${hasDiscrepancy ? `
            <div style="margin-top:12px; max-height:100px; overflow-y:auto; font-size:0.8rem;">
              ${negativeItems.map(p => `
                <div style="display:flex; justify-content:space-between; padding:4px 0; border-bottom:1px solid var(--border-light);">
                  <span>${p.name}</span>
                  <strong style="color:var(--danger);">${p.stock}</strong>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="auditClose">Close</button>
        ${hasDiscrepancy ? `<button class="btn btn-primary" id="auditFix"><i class="fa-solid fa-wand-magic-sparkles"></i> Auto-Fix Negative Stock</button>` : ''}
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  overlay.querySelector('#auditClose').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  
  if (hasDiscrepancy) {
    overlay.querySelector('#auditFix').addEventListener('click', async () => {
      overlay.querySelector('#auditFix').disabled = true;
      overlay.querySelector('#auditFix').innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Fixing...';
      
      try {
        let fixCount = 0;
        for (const p of negativeItems) {
          const res = await apiFetch(`${API_URL}/api/products/${p.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: json_payload({ ...p, stock: 0 })
          });
          if (res.ok) fixCount++;
        }
        showToast(`Auto-corrected ${fixCount} product(s) stock levels to 0.`, 'success');
        overlay.remove();
        await fetchProducts();
        if (activeView === 'inventory') renderInventory(document.getElementById('contentArea'));
      } catch (err) {
        showToast('Failed to auto-correct all items.', 'error');
        overlay.remove();
      }
    });
  }
}

// ─── CSV Importer and Exporter ───
function exportInventoryToCSV() {
  if (products.length === 0) {
    showToast('No products to export.', 'warning');
    return;
  }
  const headers = ['ID', 'Name', 'Description', 'Category', 'Price', 'Stock', 'Created At'];
  const csvRows = [headers.join(',')];
  
  products.forEach(p => {
    const values = [
      p.id,
      `"${p.name.replace(/"/g, '""')}"`,
      `"${(p.description || '').replace(/"/g, '""')}"`,
      `"${(p.category || '').replace(/"/g, '""')}"`,
      p.price,
      p.stock,
      p.created_at
    ];
    csvRows.push(values.join(','));
  });
  
  const blob = new Blob([csvRows.join('\n')], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.setAttribute('href', url);
  a.setAttribute('download', `inventory-export-${new Date().toISOString().split('T')[0]}.csv`);
  a.click();
  showToast('Inventory exported successfully.', 'success');
}

function triggerImportModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:480px;">
      <div class="modal-header">
        <div class="modal-title"><i class="fa-solid fa-file-import" style="color:var(--primary); margin-right:8px;"></i> Import Products</div>
      </div>
      <div class="modal-body" style="display:flex; flex-direction:column; gap:16px;">
        <p style="font-size:0.85rem; color:var(--text-muted); line-height:1.4;">
          Select a CSV or JSON file containing products to import. The file should contain columns/keys for <strong>name</strong>, <strong>description</strong>, <strong>price</strong>, <strong>stock</strong>, and <strong>category</strong>.
        </p>
        <div class="image-upload-wrapper" id="csvUploadWrapper" style="padding:30px;">
          <i class="fa-solid fa-file-csv" style="font-size:2.5rem; color:var(--primary);"></i>
          <span>Click to select CSV or JSON file</span>
          <input type="file" id="csvFileInput" accept=".csv,.json" style="display:none;">
        </div>
        <div id="importProgressWrapper" style="display:none;">
          <div style="display:flex; justify-content:space-between; font-size:0.8rem; margin-bottom:6px; font-weight:600;">
            <span id="importProgressText">Importing products...</span>
            <span id="importProgressPercent">0%</span>
          </div>
          <div style="background:var(--border-light); height:8px; border-radius:4px; overflow:hidden; width:100%;">
            <div id="importProgressBar" style="width:0%; height:100%; background:var(--primary); transition:width 0.1s;"></div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="importCancel">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  
  overlay.querySelector('#importCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  
  const uploadWrapper = overlay.querySelector('#csvUploadWrapper');
  const fileInput = overlay.querySelector('#csvFileInput');
  const progressWrapper = overlay.querySelector('#importProgressWrapper');
  const progressBar = overlay.querySelector('#importProgressBar');
  const progressPercent = overlay.querySelector('#importProgressPercent');
  const progressText = overlay.querySelector('#importProgressText');
  
  uploadWrapper.addEventListener('click', () => fileInput.click());
  
  fileInput.addEventListener('change', async () => {
    if (fileInput.files && fileInput.files[0]) {
      const file = fileInput.files[0];
      uploadWrapper.style.display = 'none';
      progressWrapper.style.display = 'block';
      
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const text = e.target.result;
          let parsedProducts = [];
          
          if (file.name.endsWith('.json')) {
            parsedProducts = JSON.parse(text);
            if (!Array.isArray(parsedProducts)) parsedProducts = [parsedProducts];
          } else {
            parsedProducts = parseCSV(text);
          }
          
          if (parsedProducts.length === 0) {
            showToast('No products found in file.', 'warning');
            overlay.remove();
            return;
          }
          
          let successCount = 0;
          for (let i = 0; i < parsedProducts.length; i++) {
            const item = parsedProducts[i];
            const name = item.name || item.Name;
            const description = item.description || item.Description || '';
            const price = parseFloat(item.price || item.Price || 0);
            const stock = parseInt(item.stock || item.Stock || 0);
            const category = item.category || item.Category || '';
            
            if (name) {
              const res = await apiFetch(`${API_URL}/api/products`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: json_payload({ name, description, price, stock, category })
              });
              if (res.ok) successCount++;
            }
            
            const percent = Math.round(((i + 1) / parsedProducts.length) * 100);
            progressBar.style.width = `${percent}%`;
            progressPercent.innerText = `${percent}%`;
            progressText.innerText = `Imported ${i + 1} of ${parsedProducts.length}...`;
          }
          
          showToast(`Successfully imported ${successCount} products.`, 'success');
          overlay.remove();
          await fetchProducts();
          if (activeView === 'inventory') renderInventory(document.getElementById('contentArea'));
        } catch (err) {
          showToast('Error parsing import file.', 'error');
          overlay.remove();
        }
      };
      reader.readAsText(file);
    }
  });
}

function parseCSV(text) {
  const lines = text.split('\n');
  if (lines.length < 2) return [];
  const result = [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
  
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    
    const row = [];
    let inQuotes = false;
    let currentVal = '';
    
    for (let char of lines[i]) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(currentVal.trim());
        currentVal = '';
      } else {
        currentVal += char;
      }
    }
    row.push(currentVal.trim());
    
    const obj = {};
    headers.forEach((header, index) => {
      let val = row[index] || '';
      val = val.replace(/^"|"$/g, '');
      obj[header] = val;
    });
    result.push(obj);
  }
  return result;
}

// ─── Add Customer Modal ───
function showAddCustomerModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:450px;">
      <div class="modal-header">
        <div class="modal-title"><i class="fa-solid fa-user-plus" style="color:var(--primary); margin-right:8px;"></i> Add New Customer</div>
      </div>
      <div class="modal-body" style="display:flex; flex-direction:column; gap:12px;">
        <div class="form-group">
          <label>Full Name *</label>
          <input type="text" id="custName" placeholder="Customer name">
        </div>
        <div class="form-group">
          <label>Phone Number</label>
          <input type="text" id="custPhone" placeholder="e.g. 0712345678">
        </div>
        <div class="form-group">
          <label>Email Address</label>
          <input type="email" id="custEmail" placeholder="e.g. customer@example.com">
        </div>
        <div class="form-group">
          <label>Notes / Details</label>
          <input type="text" id="custNotes" placeholder="e.g. regular corporate client">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="custCancel">Cancel</button>
        <button class="btn btn-primary" id="custSave">
          <i class="fa-solid fa-check"></i> Add Customer
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  
  overlay.querySelector('#custCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  
  overlay.querySelector('#custSave').addEventListener('click', async () => {
    const name = overlay.querySelector('#custName').value.trim();
    const phone = overlay.querySelector('#custPhone').value.trim();
    const email = overlay.querySelector('#custEmail').value.trim();
    const notes = overlay.querySelector('#custNotes').value.trim();
    
    if (!name) {
      showToast('Customer name is required.', 'error');
      return;
    }
    
    try {
      const res = await apiFetch(`${API_URL}/api/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json_payload({ name, phone, email, notes })
      });
      
      if (res.ok) {
        showToast('Customer added successfully.', 'success');
        overlay.remove();
        if (activeView === 'customers') renderCustomers(document.getElementById('contentArea'));
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to save customer.', 'error');
      }
    } catch (err) {
      showToast('Connection error.', 'error');
    }
  });
}

// ─── Channel Integrations Config Modals ───
function setupIntegrationsHandlers(container) {
  const cards = container.querySelectorAll('.integration-card');
  cards.forEach(card => {
    const titleEl = card.querySelector('.integration-card-name');
    const name = titleEl ? titleEl.textContent.trim() : '';
    const btn = card.querySelector('.btn');
    if (!btn) return;
    
    if (name === 'WhatsApp Business' && localStorage.getItem('whatsapp_connected') === 'true') {
      const badge = card.querySelector('.badge');
      if (badge) {
        badge.className = 'badge badge-success';
        badge.innerText = 'Active';
      }
      btn.innerText = 'Configure';
    }
    if (name === 'Instagram Shop' && localStorage.getItem('instagram_connected') === 'true') {
      const badge = card.querySelector('.badge');
      if (badge) {
        badge.className = 'badge badge-success';
        badge.innerText = 'Active';
      }
      btn.innerText = 'Configure';
    }
    
    btn.addEventListener('click', () => {
      if (name === 'WhatsApp Business') {
        showWhatsAppModal(card, btn);
      } else if (name === 'Online Storefront') {
        showStorefrontModal();
      } else if (name === 'M-Pesa Daraja API') {
        showMpesaConfigModal();
      } else if (name === 'Instagram Shop') {
        showInstagramModal(card, btn);
      } else if (name === 'AI Assistant') {
        showAIConfigModal();
      }
    });
  });
}

function showWhatsAppModal(card, btn) {
  const isConnected = localStorage.getItem('whatsapp_connected') === 'true';
  const phone = localStorage.getItem('whatsapp_phone') || '';
  const token = localStorage.getItem('whatsapp_token') || '';
  
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:450px;">
      <div class="modal-header">
        <div class="modal-title"><i class="fa-brands fa-whatsapp" style="color:#16a34a; margin-right:8px;"></i> WhatsApp Business Channel</div>
      </div>
      <div class="modal-body" style="display:flex; flex-direction:column; gap:12px;">
        <div class="form-group">
          <label>WhatsApp Business Phone Number</label>
          <input type="text" id="waPhone" value="${phone}" placeholder="e.g. +254712345678">
        </div>
        <div class="form-group">
          <label>Meta API Access Token</label>
          <input type="password" id="waToken" value="${token}" placeholder="EAABw2...">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="waCancel">Close</button>
        ${isConnected ? `<button class="btn btn-outline" id="waDisconnect" type="button" style="color:var(--danger); border-color:var(--danger);">Disconnect</button>` : ''}
        <button class="btn btn-primary" id="waSave">${isConnected ? 'Save Changes' : 'Connect Channel'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  
  overlay.querySelector('#waCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  
  if (isConnected) {
    overlay.querySelector('#waDisconnect').addEventListener('click', () => {
      localStorage.removeItem('whatsapp_connected');
      localStorage.removeItem('whatsapp_phone');
      localStorage.removeItem('whatsapp_token');
      const badge = card.querySelector('.badge');
      if (badge) {
        badge.className = 'badge badge-gray';
        badge.innerText = 'Not Connected';
      }
      btn.innerText = 'Connect';
      showToast('WhatsApp Business disconnected.', 'info');
      overlay.remove();
    });
  }
  
  overlay.querySelector('#waSave').addEventListener('click', () => {
    const newPhone = overlay.querySelector('#waPhone').value.trim();
    const newToken = overlay.querySelector('#waToken').value.trim();
    
    if (!newPhone) {
      showToast('Phone number is required.', 'error');
      return;
    }
    
    localStorage.setItem('whatsapp_connected', 'true');
    localStorage.setItem('whatsapp_phone', newPhone);
    localStorage.setItem('whatsapp_token', newToken);
    
    const badge = card.querySelector('.badge');
    if (badge) {
      badge.className = 'badge badge-success';
      badge.innerText = 'Active';
    }
    btn.innerText = 'Configure';
    showToast('WhatsApp Business configured successfully.', 'success');
    overlay.remove();
  });
}

function showInstagramModal(card, btn) {
  const isConnected = localStorage.getItem('instagram_connected') === 'true';
  const handle = localStorage.getItem('instagram_handle') || '';
  
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:450px;">
      <div class="modal-header">
        <div class="modal-title"><i class="fa-brands fa-instagram" style="color:#dc2626; margin-right:8px;"></i> Instagram Shop Channel</div>
      </div>
      <div class="modal-body" style="display:flex; flex-direction:column; gap:12px;">
        <div class="form-group">
          <label>Instagram Handle</label>
          <input type="text" id="instaHandle" value="${handle}" placeholder="@my_shop">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="instaCancel">Close</button>
        ${isConnected ? `<button class="btn btn-outline" id="instaDisconnect" type="button" style="color:var(--danger); border-color:var(--danger);">Disconnect</button>` : ''}
        <button class="btn btn-primary" id="instaSave">${isConnected ? 'Save Changes' : 'Connect Channel'}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  
  overlay.querySelector('#instaCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  
  if (isConnected) {
    overlay.querySelector('#instaDisconnect').addEventListener('click', () => {
      localStorage.removeItem('instagram_connected');
      localStorage.removeItem('instagram_handle');
      const badge = card.querySelector('.badge');
      if (badge) {
        badge.className = 'badge badge-gray';
        badge.innerText = 'Not Connected';
      }
      btn.innerText = 'Connect';
      showToast('Instagram Shop disconnected.', 'info');
      overlay.remove();
    });
  }
  
  overlay.querySelector('#instaSave').addEventListener('click', () => {
    const newHandle = overlay.querySelector('#instaHandle').value.trim();
    
    if (!newHandle) {
      showToast('Instagram handle is required.', 'error');
      return;
    }
    
    localStorage.setItem('instagram_connected', 'true');
    localStorage.setItem('instagram_handle', newHandle);
    
    const badge = card.querySelector('.badge');
    if (badge) {
      badge.className = 'badge badge-success';
      badge.innerText = 'Active';
    }
    btn.innerText = 'Configure';
    showToast('Instagram Shop connected.', 'success');
    overlay.remove();
  });
}

function showStorefrontModal() {
  const metadata = currentSession?.user?.user_metadata || {};
  const currentStore = metadata.store_name || 'Main Store';
  const customSubdomain = localStorage.getItem('storefront_subdomain') || currentStore.toLowerCase().replace(/\s+/g, '-');
  const currency = localStorage.getItem('storefront_currency') || 'KES';
  const isActive = localStorage.getItem('storefront_active') !== 'false';
  
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:480px;">
      <div class="modal-header">
        <div class="modal-title"><i class="fa-solid fa-globe" style="color:#2563eb; margin-right:8px;"></i> Online Storefront Settings</div>
      </div>
      <div class="modal-body" style="display:flex; flex-direction:column; gap:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-input); padding:12px; border-radius:var(--radius-sm);">
          <div>
            <div style="font-weight:600; font-size:0.9rem;">Storefront Visibility</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">Toggle public e-commerce access</div>
          </div>
          <input type="checkbox" id="storefrontActive" ${isActive ? 'checked' : ''} style="width:20px; height:20px; cursor:pointer;">
        </div>
        <div class="form-group">
          <label>Custom Subdomain</label>
          <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
            <input type="text" id="storefrontSubdomain" value="${customSubdomain}" style="flex-grow:1; text-align:right;">
            <span style="color:var(--text-muted); font-size:0.85rem;">.omnipos.co.ke</span>
          </div>
        </div>
        <div class="form-group">
          <label>Display Currency</label>
          <select id="storefrontCurrency" class="status-select" style="width:100%; height:40px; margin-top:4px;">
            <option value="KES" ${currency === 'KES' ? 'selected' : ''}>Kenyan Shilling (KES)</option>
            <option value="USD" ${currency === 'USD' ? 'selected' : ''}>US Dollar ($)</option>
            <option value="EUR" ${currency === 'EUR' ? 'selected' : ''}>Euro (€)</option>
          </select>
        </div>
        
        <div style="text-align:center; padding:16px; border:1px solid var(--border); border-radius:var(--radius-sm);">
          <i class="fa-solid fa-qrcode" style="font-size:3rem; color:var(--text-primary);"></i>
          <div style="font-size:0.75rem; color:var(--text-muted); margin-top:8px;">Scan to open Online Storefront</div>
          <a href="#" style="font-size:0.85rem; color:var(--primary); text-decoration:underline; display:block; margin-top:4px;" onclick="event.preventDefault(); window.open('${API_URL}', '_blank')">omnipos.co.ke/${customSubdomain}</a>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="storefrontCancel">Close</button>
        <button class="btn btn-primary" id="storefrontSave">Save Settings</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  
  overlay.querySelector('#storefrontCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  
  overlay.querySelector('#storefrontSave').addEventListener('click', () => {
    localStorage.setItem('storefront_active', overlay.querySelector('#storefrontActive').checked);
    localStorage.setItem('storefront_subdomain', overlay.querySelector('#storefrontSubdomain').value.trim());
    localStorage.setItem('storefront_currency', overlay.querySelector('#storefrontCurrency').value);
    showToast('Storefront settings updated.', 'success');
    overlay.remove();
  });
}

function showMpesaConfigModal() {
  const shortcode = localStorage.getItem('mpesa_shortcode') || '174379';
  const passkey = localStorage.getItem('mpesa_passkey') || '';
  const key = localStorage.getItem('mpesa_key') || '';
  const secret = localStorage.getItem('mpesa_secret') || '';
  const env = localStorage.getItem('mpesa_env') || 'sandbox';
  
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:450px;">
      <div class="modal-header">
        <div class="modal-title"><i class="fa-solid fa-mobile-screen-button" style="color:#d97706; margin-right:8px;"></i> Safaricom M-Pesa Daraja Config</div>
      </div>
      <div class="modal-body" style="display:flex; flex-direction:column; gap:12px;">
        <div class="form-group">
          <label>Daraja API Environment</label>
          <select id="mpesaEnv" class="status-select" style="width:100%; height:40px; margin-top:4px;">
            <option value="sandbox" ${env === 'sandbox' ? 'selected' : ''}>Sandbox (Testing)</option>
            <option value="production" ${env === 'production' ? 'selected' : ''}>Production (Live Payments)</option>
          </select>
        </div>
        <div class="form-group">
          <label>Business Shortcode / Paybill</label>
          <input type="text" id="mpesaShortcode" value="${shortcode}" placeholder="e.g. 174379">
        </div>
        <div class="form-group">
          <label>Lipa Na M-Pesa Online Passkey</label>
          <input type="password" id="mpesaPasskey" value="${passkey}" placeholder="bfb279f9a...">
        </div>
        <div class="form-group">
          <label>Consumer Key</label>
          <input type="text" id="mpesaKey" value="${key}" placeholder="Daraja Application Consumer Key">
        </div>
        <div class="form-group">
          <label>Consumer Secret</label>
          <input type="password" id="mpesaSecret" value="${secret}" placeholder="Daraja Application Consumer Secret">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="mpesaCancel">Close</button>
        <button class="btn btn-primary" id="mpesaSave">Save Credentials</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  
  overlay.querySelector('#mpesaCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  
  overlay.querySelector('#mpesaSave').addEventListener('click', () => {
    localStorage.setItem('mpesa_env', overlay.querySelector('#mpesaEnv').value);
    localStorage.setItem('mpesa_shortcode', overlay.querySelector('#mpesaShortcode').value.trim());
    localStorage.setItem('mpesa_passkey', overlay.querySelector('#mpesaPasskey').value.trim());
    localStorage.setItem('mpesa_key', overlay.querySelector('#mpesaKey').value.trim());
    localStorage.setItem('mpesa_secret', overlay.querySelector('#mpesaSecret').value.trim());
    
    showToast('M-Pesa Daraja configuration updated.', 'success');
    overlay.remove();
  });
}

function showAIConfigModal() {
  const restockWarn = localStorage.getItem('ai_restock_warn') !== 'false';
  const dailyReport = localStorage.getItem('ai_daily_report') === 'true';
  const autoPrice = localStorage.getItem('ai_auto_price') === 'true';
  
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-content" style="max-width:480px;">
      <div class="modal-header">
        <div class="modal-title"><i class="fa-solid fa-robot" style="color:var(--primary); margin-right:8px;"></i> AI Assistant Settings</div>
      </div>
      <div class="modal-body" style="display:flex; flex-direction:column; gap:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-light); padding-bottom:12px;">
          <div>
            <div style="font-weight:600; font-size:0.9rem;">Restocking Warnings</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">Alert when sales velocity indicates depletion</div>
          </div>
          <input type="checkbox" id="aiRestock" ${restockWarn ? 'checked' : ''} style="width:18px; height:18px; cursor:pointer;">
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-light); padding-bottom:12px;">
          <div>
            <div style="font-weight:600; font-size:0.9rem;">Daily Summary Emails</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">Receive AI sales analysis summaries</div>
          </div>
          <input type="checkbox" id="aiDaily" ${dailyReport ? 'checked' : ''} style="width:18px; height:18px; cursor:pointer;">
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-light); padding-bottom:12px;">
          <div>
            <div style="font-weight:600; font-size:0.9rem;">Dynamic Pricing Recs</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">Suggest price adjustments during peak demand</div>
          </div>
          <input type="checkbox" id="aiPrice" ${autoPrice ? 'checked' : ''} style="width:18px; height:18px; cursor:pointer;">
        </div>
        
        <div style="background:var(--bg-input); padding:16px; border-radius:var(--radius-sm); font-size:0.8rem;">
          <div style="font-weight:600; color:var(--text-primary); margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            <i class="fa-solid fa-lightbulb" style="color:var(--warning);"></i> Live Recommendation
          </div>
          <p style="color:var(--text-muted); line-height:1.4; margin:0;">
            Oraimo FreePods 4 is currently trending. We recommend increasing stock levels by at least 15 units before the weekend demand spike.
          </p>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" id="aiCancel">Close</button>
        <button class="btn btn-primary" id="aiSave">Save Preferences</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  
  overlay.querySelector('#aiCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  
  overlay.querySelector('#aiSave').addEventListener('click', () => {
    localStorage.setItem('ai_restock_warn', overlay.querySelector('#aiRestock').checked);
    localStorage.setItem('ai_daily_report', overlay.querySelector('#aiDaily').checked);
    localStorage.setItem('ai_auto_price', overlay.querySelector('#aiPrice').checked);
    showToast('AI Assistant preferences saved.', 'success');
    overlay.remove();
  });
}

