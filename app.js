'use strict';

const $ = (id) => document.getElementById(id);
const money = (value) => new Intl.NumberFormat('es-CL', {
  style: 'currency',
  currency: 'CLP',
  maximumFractionDigits: 0
}).format(Number(value || 0));

const state = {
  token: sessionStorage.getItem('automarket_gestion_token') || '',
  user: null,
  vehicles: [],
  customers: [],
  section: 'vehicles',
  editingVehicleId: null,
  editingCustomerId: null,
  toastTimeout: null
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').style.display = 'block';
  clearTimeout(state.toastTimeout);
  state.toastTimeout = setTimeout(() => {
    $('toast').style.display = 'none';
  }, 4000);
}

function saveToken(token) {
  state.token = token || '';
  if (state.token) {
    sessionStorage.setItem('automarket_gestion_token', state.token);
  } else {
    sessionStorage.removeItem('automarket_gestion_token');
  }
}

async function request(path, options = {}, retry = true) {
  const headers = { ...options.headers };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'same-origin'
  });

  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    try {
      const refreshed = await request('/auth/refresh', { method: 'POST' }, false);
      if (refreshed.user?.rol !== 'ADMIN') {
        throw new Error('La cuenta no tiene permisos administrativos');
      }
      saveToken(refreshed.accessToken);
      return await request(path, options, false);
    } catch {
      showLogin();
      throw new Error('Tu sesión venció. Inicia sesión nuevamente.');
    }
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || error.detail || `Error HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function showLogin(message = '') {
  saveToken('');
  state.user = null;
  $('adminApp').hidden = true;
  $('vehicleOverlay').hidden = true;
  $('customerOverlay').hidden = true;
  $('loginScreen').hidden = false;
  $('loginError').textContent = message;
}

function showAdmin(user) {
  state.user = user;
  $('loginScreen').hidden = true;
  $('adminApp').hidden = false;
  $('adminUser').textContent = user.nombre || user.correo || 'Administrador';
  selectSection('vehicles');
}

async function login(event) {
  event.preventDefault();
  const button = $('loginButton');
  button.disabled = true;
  $('loginError').textContent = '';

  try {
    const credentials = {
      correo: $('loginEmail').value.trim(),
      password: $('loginPassword').value
    };

    const response = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials)
    });

    if (response.user?.rol !== 'ADMIN') {
      await request('/auth/logout', { method: 'POST' }).catch(() => {});
      showLogin('Esta cuenta no tiene el rol ADMIN.');
      return;
    }

    saveToken(response.accessToken);
    $('loginPassword').value = '';
    showAdmin(response.user);
  } catch (error) {
    showLogin(error.message);
  } finally {
    button.disabled = false;
  }
}

async function restoreSession() {
  try {
    const auth = await request('/auth/refresh', { method: 'POST' }, false);
    if (auth.user?.rol !== 'ADMIN') {
      showLogin('Acceso reservado a administradores.');
      return;
    }
    saveToken(auth.accessToken);
    showAdmin(auth.user);
    return;
  } catch {
  }

  if (!state.token) {
    showLogin();
    return;
  }
  try {
    const user = await request('/auth/me', {}, false);
    if (user.rol !== 'ADMIN') {
      showLogin('Se requiere una cuenta de administrador.');
      return;
    }
    showAdmin(user);
  } catch {
    showLogin('Inicia sesión para continuar.');
  }
}

async function logout() {
  await request('/auth/logout', { method: 'POST' }).catch(() => {});
  localStorage.setItem('automarket:logout-event', String(Date.now()));
  showLogin();
}

function selectSection(section) {
  state.section = section;
  const vehicles = section === 'vehicles';

  $('vehiclesTab').classList.toggle('active', vehicles);
  $('customersTab').classList.toggle('active', !vehicles);
  $('vehicleStats').hidden = !vehicles;
  $('customerStats').hidden = vehicles;
  $('vehiclesSection').hidden = !vehicles;
  $('customersSection').hidden = vehicles;
  $('eyebrow').textContent = vehicles
    ? 'PANEL DE GESTIÓN / VEHÍCULOS'
    : 'PANEL DE GESTIÓN / CLIENTES';
  $('pageTitle').textContent = vehicles
    ? 'Inventario de vehículos'
    : 'Gestión de clientes';

  if (vehicles) {
    loadVehicles();
  } else {
    loadCustomers();
  }
}

async function loadVehicles() {
  try {
    state.vehicles = await request('/vehiculos');
    const vehicles = state.vehicles;
    $('total').textContent = vehicles.length;
    $('disponibles').textContent = vehicles.filter(
      (vehicle) => (vehicle.estadoInventario || 'DISPONIBLE') === 'DISPONIBLE'
    ).length;
    $('reservados').textContent = vehicles.filter(
      (vehicle) => vehicle.estadoInventario === 'RESERVADO'
    ).length;
    $('vendidos').textContent = vehicles.filter(
      (vehicle) => vehicle.estadoInventario === 'VENDIDO'
    ).length;

    renderVehicles();
    $('connection').textContent = '● Conectado a Spring Boot';
    $('connection').classList.remove('off');
  } catch (error) {
    $('connection').textContent = '● Error de conexión';
    $('connection').classList.add('off');
    toast(error.message);
  }
}

function renderVehicles() {
  const search = $('vehicleSearch').value.trim().toLowerCase();
  const filter = $('vehicleState').value;
  const visible = state.vehicles.filter((vehicle) => {
    const text = `${vehicle.marca} ${vehicle.modelo} ${vehicle.vin || ''}`.toLowerCase();
    return text.includes(search) && (
      !filter || (vehicle.estadoInventario || 'DISPONIBLE') === filter
    );
  });

  $('vehicleRows').innerHTML = visible.map((vehicle) => {
    const inventoryStatus = vehicle.estadoInventario || 'DISPONIBLE';

    return `
      <tr>
        <td>
          <strong>${escapeHtml(vehicle.marca)} ${escapeHtml(vehicle.modelo)}</strong>
          <small>${escapeHtml(vehicle.anio)} · ${escapeHtml(vehicle.estado)} · ${escapeHtml(vehicle.tipoVehiculo || '—')}</small>
        </td>
        <td>${escapeHtml(vehicle.vin || 'Sin VIN')}</td>
        <td>${escapeHtml(vehicle.idSucursal == null ? '—' : `Sucursal ${vehicle.idSucursal}`)}</td>
        <td><strong>${money(vehicle.precio)}</strong></td>
        <td><span class="pill ${escapeHtml(inventoryStatus)}">${escapeHtml(inventoryStatus)}</span></td>
        <td>
          <button class="edit" type="button" data-action="edit" data-id="${escapeHtml(vehicle.id)}">Editar</button>
          <button class="delete" type="button" data-action="delete" data-id="${escapeHtml(vehicle.id)}">Eliminar</button>
        </td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="6">No se encontraron vehículos.</td></tr>';

  $('vehicleCount').textContent = `Mostrando ${visible.length} de ${state.vehicles.length} vehículo(s)`;
}

function openVehicleForm(vehicle = null) {
  state.editingVehicleId = vehicle?.id || null;
  $('vehicleForm').reset();
  $('vehicleModalTitle').textContent = vehicle ? 'Editar vehículo' : 'Nuevo vehículo';
  $('vehicleFormType').textContent = vehicle ? 'UPDATE' : 'CREATE';
  $('saveVehicle').textContent = vehicle ? 'Guardar cambios' : 'Crear vehículo';

  if (vehicle) {
    for (const field of $('vehicleForm').elements) {
      if (!field.name) continue;
      if (field.type === 'checkbox') {
        field.checked = Boolean(vehicle[field.name]);
      } else if (vehicle[field.name] != null) {
        field.value = vehicle[field.name];
      }
    }
  }

  $('vehicleOverlay').hidden = false;
  $('vehicleForm').elements.namedItem('marca').focus();
}

function closeVehicleForm() {
  $('vehicleOverlay').hidden = true;
}

function vehicleInput() {
  const form = $('vehicleForm');
  const data = Object.fromEntries(new FormData(form).entries());

  return {
    ...data,
    vin: (data.vin || '').trim() || null,
    anio: Number(data.anio),
    km: Number(data.km),
    precio: Number(data.precio),
    idSucursal: data.idSucursal ? Number(data.idSucursal) : null,
    destacado: form.elements.namedItem('destacado').checked,
    estadoInventario: data.estadoInventario || 'DISPONIBLE'
  };
}

async function saveVehicle(event) {
  event.preventDefault();
  const editingId = state.editingVehicleId;
  const path = editingId ? `/vehiculos/${encodeURIComponent(editingId)}` : '/vehiculos';

  try {
    await request(path, {
      method: editingId ? 'PUT' : 'POST',
      body: JSON.stringify(vehicleInput())
    });
    closeVehicleForm();
    toast(editingId ? 'Vehículo actualizado.' : 'Vehículo registrado.');
    await loadVehicles();
  } catch (error) {
    toast(error.message);
  }
}

async function vehicleAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const vehicle = state.vehicles.find((item) => item.id === button.dataset.id);
  if (!vehicle) return;

  if (button.dataset.action === 'edit') {
    openVehicleForm(vehicle);
    return;
  }

  if (!confirm(`¿Eliminar ${vehicle.marca} ${vehicle.modelo}?`)) return;

  try {
    await request(`/vehiculos/${encodeURIComponent(vehicle.id)}`, {
      method: 'DELETE'
    });
    toast('Vehículo eliminado.');
    await loadVehicles();
  } catch (error) {
    toast(error.message);
  }
}

async function loadCustomers() {
  try {
    state.customers = await request('/clientes');
    $('totalCustomers').textContent = state.customers.length;
    renderCustomers();
  } catch (error) {
    toast(error.message);
  }
}

function renderCustomers() {
  const search = $('customerSearch').value.trim().toLowerCase();
  const visible = state.customers.filter((customer) => {
    return `${customer.nombre} ${customer.apellido} ${customer.idCliente} ${customer.correoElectronico}`
      .toLowerCase()
      .includes(search);
  });

  $('customerRows').innerHTML = visible.map((customer) => `
    <tr>
      <td><strong>${escapeHtml(customer.nombre)} ${escapeHtml(customer.apellido)}</strong></td>
      <td>${escapeHtml(customer.idCliente)}</td>
      <td>${escapeHtml(customer.correoElectronico)}</td>
      <td>${escapeHtml(customer.telefono)}</td>
      <td>
        <button class="edit" type="button" data-action="edit" data-id="${escapeHtml(customer.id)}">Editar</button>
        <button class="delete" type="button" data-action="delete" data-id="${escapeHtml(customer.id)}">Eliminar</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="5">No se encontraron clientes.</td></tr>';

  $('customerCount').textContent = `Mostrando ${visible.length} de ${state.customers.length} cliente(s)`;
}

function openCustomerForm(customer = null) {
  state.editingCustomerId = customer?.id || null;
  $('customerForm').reset();
  $('customerModalTitle').textContent = customer ? 'Editar cliente' : 'Nuevo cliente';
  $('customerFormType').textContent = customer ? 'UPDATE' : 'CREATE';
  $('saveCustomer').textContent = customer ? 'Guardar cambios' : 'Registrar cliente';

  if (customer) {
    for (const field of $('customerForm').elements) {
      if (field.name && customer[field.name] != null) {
        field.value = customer[field.name];
      }
    }
  }

  $('customerOverlay').hidden = false;
  $('customerForm').elements.namedItem('nombre').focus();
}

function closeCustomerForm() {
  $('customerOverlay').hidden = true;
}

async function saveCustomer(event) {
  event.preventDefault();
  const editingId = state.editingCustomerId;
  const path = editingId ? `/clientes/${encodeURIComponent(editingId)}` : '/clientes';
  const data = Object.fromEntries(new FormData($('customerForm')).entries());

  try {
    await request(path, {
      method: editingId ? 'PUT' : 'POST',
      body: JSON.stringify(data)
    });
    closeCustomerForm();
    toast(editingId ? 'Cliente actualizado.' : 'Cliente registrado.');
    await loadCustomers();
  } catch (error) {
    toast(error.message);
  }
}

async function customerAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const customer = state.customers.find((item) => item.id === button.dataset.id);
  if (!customer) return;

  if (button.dataset.action === 'edit') {
    openCustomerForm(customer);
    return;
  }

  if (!confirm(`¿Eliminar el registro comercial de ${customer.nombre} ${customer.apellido}?`)) {
    return;
  }

  try {
    await request(`/clientes/${encodeURIComponent(customer.id)}`, {
      method: 'DELETE'
    });
    toast('Cliente eliminado.');
    await loadCustomers();
  } catch (error) {
    toast(error.message);
  }
}

function bindEvents() {
  $('loginForm').addEventListener('submit', login);
  $('logoutButton').addEventListener('click', logout);
  $('vehiclesTab').addEventListener('click', () => selectSection('vehicles'));
  $('customersTab').addEventListener('click', () => selectSection('customers'));
  $('refreshVehicles').addEventListener('click', loadVehicles);
  $('refreshCustomers').addEventListener('click', loadCustomers);
  $('vehicleSearch').addEventListener('input', renderVehicles);
  $('vehicleState').addEventListener('change', renderVehicles);
  $('customerSearch').addEventListener('input', renderCustomers);
  $('newVehicle').addEventListener('click', () => openVehicleForm());
  $('newCustomer').addEventListener('click', () => openCustomerForm());
  $('vehicleRows').addEventListener('click', vehicleAction);
  $('customerRows').addEventListener('click', customerAction);
  $('vehicleForm').addEventListener('submit', saveVehicle);
  $('customerForm').addEventListener('submit', saveCustomer);

  $('closeVehicle').addEventListener('click', closeVehicleForm);
  $('cancelVehicle').addEventListener('click', closeVehicleForm);
  $('closeCustomer').addEventListener('click', closeCustomerForm);
  $('cancelCustomer').addEventListener('click', closeCustomerForm);

  $('vehicleOverlay').addEventListener('click', (event) => {
    if (event.target === $('vehicleOverlay')) closeVehicleForm();
  });
  $('customerOverlay').addEventListener('click', (event) => {
    if (event.target === $('customerOverlay')) closeCustomerForm();
  });
}

bindEvents();
restoreSession();
