(() => {
  const initialAuthLinkType = new URLSearchParams(location.hash.slice(1)).get('type')
    || new URLSearchParams(location.search).get('type');
  let passwordSetupMode = ['invite', 'recovery'].includes(initialAuthLinkType);
  const supabaseConfig = window.PRISMA_SUPABASE_CONFIG;
  const supabaseClient = window.supabase?.createClient && supabaseConfig?.url && supabaseConfig?.publishableKey
    ? window.supabase.createClient(supabaseConfig.url, supabaseConfig.publishableKey)
    : null;
  window.PrismaMotorSupabase = Object.freeze({
    client: supabaseClient,
    configured: Boolean(supabaseClient),
  });
  const authGate = document.getElementById('authGate');
  const loginForm = document.getElementById('loginForm');
  const authFeedback = document.getElementById('authFeedback');
  const authRetry = document.getElementById('authRetry');
  const passwordSetupForm = document.getElementById('passwordSetupForm');
  const authTitle = document.getElementById('authTitle');
  const authIntro = document.querySelector('.auth-intro');
  let currentSession = null;
  let currentProfile = null;
  let intakeSignatureReady = false;
  let signatureContext = null;
  let currentIntakeStep = 1;
  let technicianTimerInterval = null;

  const state = {
    role: 'reception',
    timer: 1 * 3600 + 24 * 60 + 15,
    timerRunning: false,
    quoteDecisionSubmitted: false,
    clientPreviewSection: 'vehicle',
    receptionLoading: false,
    receptionLive: false,
    receptionError: '',
    pendingIntakes: [],
    intakeDamageMarks: [],
    technicianTasks: [],
    technicianLoading: false,
    technicianError: '',
    assignmentOrder: null,
    teamMembers: [],
    teamLoading: false,
    teamError: '',
    teamNotice: '',
    teamInviteOpen: false,
    ownerSection: 'dashboard',
    ownerData: { loading: false, error: '', ratesError: '', orders: [], estimates: [], estimateItems: [], tasks: [], movements: [], payments: [], rates: [] },
    inventoryProducts: [],
    inventoryLoading: false,
    inventoryError: '',
    inventoryNotice: '',
    inventoryMovements: [],
    inventoryMovementError: '',
    inventoryMovementLoading: false,
    inventoryOrders: [],
    quoteItems: [
      { id: 'brakes', title: 'Pastillas de freno', detail: 'Urgente · Repuesto y mano de obra', amount: 180000, tone: 'red', selected: true },
      { id: 'filter', title: 'Filtro de aire', detail: 'Preventivo · Repuesto', amount: 60000, tone: 'amber', selected: true },
    ],
    orders: [
      { plate: 'ABC-123', make: 'BMW X5 2021', customer: 'Laura Méndez', time: '9:30 a. m.', stage: 'En diagnóstico', tone: 'blue' },
      { plate: 'MNO-482', make: 'Mazda 3 2019', customer: 'Andrés Rojas', time: '10:45 a. m.', stage: 'Esperando aprobación', tone: 'amber' },
      { plate: 'JKL-605', make: 'Renault Duster 2022', customer: 'Camila Torres', time: '12:15 p. m.', stage: 'Confirmada', tone: 'green' },
    ],
  };
  const vehicleGroups = {
    workshop: {
      title: 'Vehículos en el taller',
      description: 'Vehículos en diagnóstico, reparación o control de calidad.',
      items: [
        { plate: 'ABC-123', vehicle: 'BMW X5 2021', customer: 'Laura Méndez', status: 'En diagnóstico', tone: 'blue' },
        { plate: 'MNO-482', vehicle: 'Mazda 3 2019', customer: 'Andrés Rojas', status: 'Esperando aprobación', tone: 'amber' },
        { plate: 'JKL-605', vehicle: 'Renault Duster 2022', customer: 'Camila Torres', status: 'En reparación', tone: 'green' },
        { plate: 'HGT-244', vehicle: 'Toyota Corolla 2020', customer: 'Sofía Martínez', status: 'Listo para entrega', tone: 'green' },
        { plate: 'FRT-909', vehicle: 'Kia Sportage 2023', customer: 'Diego Acosta', status: 'En reparación', tone: 'blue' },
        { plate: 'QWE-381', vehicle: 'Chevrolet Tracker 2022', customer: 'Mónica Pérez', status: 'Esperando repuesto', tone: 'amber' },
        { plate: 'ZXC-120', vehicle: 'Volkswagen T-Cross 2021', customer: 'Julián Castro', status: 'Control de calidad', tone: 'blue' },
        { plate: 'PLM-552', vehicle: 'Nissan Kicks 2024', customer: 'Paula Herrera', status: 'En reparación', tone: 'blue' },
      ],
    },
    waiting: {
      title: 'Esperando atención',
      description: 'Vehículos recibidos que todavía no comienzan el diagnóstico.',
      items: [
        { plate: 'CITA · 2:00 P. M.', vehicle: 'Audi Q3 2020', customer: 'Camilo Mejía', status: 'Por recibir', tone: 'amber' },
        { plate: 'CITA · 3:30 P. M.', vehicle: 'Renault Sandero 2021', customer: 'Paula Díaz', status: 'Por recibir', tone: 'amber' },
      ],
    },
    delivery: {
      title: 'Listos para entrega',
      description: 'Vehículos terminados que esperan coordinación de entrega.',
      items: [
        { plate: 'HGT-244', vehicle: 'Toyota Corolla 2020', customer: 'Sofía Martínez', status: 'Listo para entrega', tone: 'green' },
      ],
    },
  };
  const screen = document.getElementById('screen');
  const title = document.getElementById('pageTitle');
  const description = document.getElementById('pageDescription');
  const dialog = document.getElementById('intakeDialog');
  const vehicleListDialog = document.getElementById('vehicleListDialog');
  const roles = {
    reception: ['Recepción', 'Recibe cada vehículo con claridad, evidencia y seguimiento.'],
    technician: ['Mi bahía', 'Consulta tus órdenes y registra el avance del trabajo.'],
    owner: ['Torre de control', 'Una vista clara del trabajo y el movimiento del taller.'],
    customer: ['Mi garaje', 'Sigue el avance de tu vehículo y revisa el presupuesto.'],
  };
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  let intakeQueueDbPromise;
  let syncingPendingIntakes = false;

  function openIntakeQueueDb() {
    if (!window.indexedDB) return Promise.reject(new Error('Este navegador no permite guardar recepciones sin conexión.'));
    if (!intakeQueueDbPromise) intakeQueueDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('prisma-motor-offline', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('pendingIntakes')) db.createObjectStore('pendingIntakes', { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('No se pudo abrir el almacenamiento local.'));
    });
    return intakeQueueDbPromise;
  }

  async function savePendingIntake(record) {
    const db = await openIntakeQueueDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('pendingIntakes', 'readwrite');
      transaction.objectStore('pendingIntakes').put(record);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('No se pudo guardar la recepción en el dispositivo.'));
      transaction.onabort = () => reject(transaction.error || new Error('No se pudo guardar la recepción en el dispositivo.'));
    });
  }

  async function getPendingIntakes(userId) {
    const db = await openIntakeQueueDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('pendingIntakes', 'readonly');
      const request = transaction.objectStore('pendingIntakes').getAll();
      request.onsuccess = () => resolve((request.result || []).filter(row => row.userId === userId));
      request.onerror = () => reject(request.error || new Error('No se pudo consultar la cola local.'));
    });
  }

  async function removePendingIntake(id) {
    const db = await openIntakeQueueDb();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('pendingIntakes', 'readwrite');
      transaction.objectStore('pendingIntakes').delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('No se pudo limpiar el registro local.'));
    });
  }

  function openVehicleList(groupKey) {
    const group = vehicleGroups[groupKey];
    if (!group) return;
    document.getElementById('vehicleListTitle').textContent = group.title;
    document.getElementById('vehicleListDescription').textContent = group.description;
    document.getElementById('vehicleListNote').innerHTML = `<span class="demo-indicator"></span> ${group.items.some(vehicle => vehicle.id) ? 'Órdenes cargadas desde Supabase. Pulsa una para ver el expediente.' : 'Datos de muestra para revisar la interfaz.'}`;
    document.getElementById('vehicleListItems').innerHTML = group.items.length ? group.items.map(vehicle => `<article class="vehicle-list-item${vehicle.id ? ' vehicle-list-item-open' : ''}" ${vehicle.id ? `data-order-detail="${escapeHtml(vehicle.id)}" role="button" tabindex="0"` : ''}>
      <span class="vehicle-list-symbol" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3 14.5 5.5 9a2 2 0 0 1 1.8-1.2h9.4A2 2 0 0 1 18.5 9l2.5 5.5V19h-2v-2H5v2H3z"/><path d="M6 14h12M7.5 11h9"/></svg></span>
      <span class="vehicle-list-copy"><strong>${escapeHtml(vehicle.plate)}</strong><span>${escapeHtml(vehicle.vehicle)} · ${escapeHtml(vehicle.customer)}</span></span>
      <span class="pill pill-${escapeHtml(vehicle.tone)}">${escapeHtml(vehicle.status)}</span>
    </article>`).join('') : '<div class="empty-state">No hay vehículos en esta categoría.</div>';
    vehicleListDialog.showModal();
  }

  const workOrderLabels = {
    received: 'Recibido', diagnosis: 'En diagnóstico', awaiting_approval: 'Esperando aprobación',
    approved: 'Aprobado', partially_approved: 'Aprobación parcial',
    awaiting_parts: 'Esperando repuesto', in_repair: 'En reparación', quality_control: 'Control de calidad',
    ready_for_delivery: 'Listo para entrega', delivered: 'Entregado',
  };
  const statusTone = status => status === 'ready_for_delivery' || status === 'delivered' ? 'green'
    : status === 'approved' ? 'green'
      : status === 'awaiting_approval' || status === 'partially_approved' || status === 'awaiting_parts' || status === 'received' ? 'amber' : 'blue';
  const workshopStatuses = new Set(['diagnosis', 'awaiting_approval', 'approved', 'partially_approved', 'awaiting_parts', 'in_repair', 'quality_control']);
  const nextWorkOrderStatuses = {
    received: ['diagnosis'],
    diagnosis: [],
    awaiting_approval: [],
    approved: ['awaiting_parts', 'in_repair'],
    partially_approved: ['awaiting_parts', 'in_repair'],
    awaiting_parts: ['in_repair'],
    in_repair: ['quality_control'],
    quality_control: ['in_repair', 'ready_for_delivery'],
    ready_for_delivery: ['delivered'],
    delivered: [],
  };

  const estimateStatusLabels = { draft: 'Borrador', sent: 'Enviada al cliente', partially_approved: 'Aprobación parcial', approved: 'Aprobada', rejected: 'Rechazada', expired: 'Vencida' };
  const estimateCategoryLabels = { parts: 'Repuestos', paint_materials: 'Pintura y materiales', labor: 'Mano de obra', other: 'Otros' };
  const formatMoney = (amount, currency = 'COP') => new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amount) || 0);

  function calculateEstimateTotals(items, taxMode, taxRate) {
    const subtotal = items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price), 0);
    const rate = Number(taxRate) || 0;
    const tax = taxMode === 'excluded' ? subtotal * rate / 100 : taxMode === 'included' && rate ? subtotal * rate / (100 + rate) : 0;
    return { subtotal, tax, total: taxMode === 'excluded' ? subtotal + tax : subtotal };
  }

  function quoteEditorRow(item = {}) {
    const products = state.inventoryProducts.filter(product => product.active || product.id === item.inventory_product_id);
    const options = `<option value="">Concepto manual</option>${products.map(product => `<option value="${escapeHtml(product.id)}" ${item.inventory_product_id === product.id ? 'selected' : ''}>${escapeHtml(product.name)} · ${escapeHtml(product.unit)}</option>`).join('')}`;
    const category = item.category || 'parts';
    const manualMaterial = !item.inventory_product_id && ['parts', 'paint_materials'].includes(category);
    const units = Object.entries(inventoryUnits).map(([value, label]) => `<option value="${value}" ${(item.product_unit || item.unit || 'unidad') === value ? 'selected' : ''}>${label}</option>`).join('');
    return `<div class="quote-editor-line"><select name="inventory_product_id" aria-label="Producto del catálogo">${options}</select><select name="category" aria-label="Tipo de concepto"><option value="parts" ${category === 'parts' ? 'selected' : ''}>Repuestos</option><option value="paint_materials" ${category === 'paint_materials' ? 'selected' : ''}>Pintura e insumos</option><option value="labor" ${category === 'labor' ? 'selected' : ''}>Mano de obra</option><option value="other" ${category === 'other' ? 'selected' : ''}>Otros</option></select><input name="description" required maxlength="240" placeholder="Descripción del concepto" value="${escapeHtml(item.description || '')}"><input name="quantity" type="number" min="0.01" step="0.01" required aria-label="Cantidad" value="${escapeHtml(item.quantity ?? 1)}"><input name="unit_price" type="number" min="0" step="1" required aria-label="Precio unitario en pesos" placeholder="Precio para el cliente" value="${escapeHtml(item.unit_price ?? '')}"><button type="button" class="quote-line-remove" data-remove-quote-line aria-label="Quitar concepto">×</button><div class="quote-manual-product-fields" ${manualMaterial ? '' : 'hidden'}><label>Unidad de inventario<select name="product_unit" ${manualMaterial ? 'required' : ''}>${units}</select></label><label>Costo estimado por unidad, interno<input name="estimated_cost" type="number" min="0" step="1" placeholder="Ej. 180000" value="${escapeHtml(item.estimated_cost ?? '')}" ${manualMaterial ? 'required' : ''}></label><small>Se añadirá al catálogo sin aumentar existencias. Registra la compra cuando el repuesto llegue al taller.</small></div></div>`;
  }

  function syncManualProductFields(row) {
    if (!row) return;
    const fields = row.querySelector('.quote-manual-product-fields');
    const isManualMaterial = !row.querySelector('[name="inventory_product_id"]').value
      && ['parts', 'paint_materials'].includes(row.querySelector('[name="category"]').value);
    fields.hidden = !isManualMaterial;
    fields.querySelector('[name="product_unit"]').required = isManualMaterial;
    fields.querySelector('[name="estimated_cost"]').required = isManualMaterial;
  }

  function renderEstimateSection(order, estimates, items, decisions) {
    const latest = estimates[0];
    let content = '';
    if (!latest) {
      content = order.status === 'diagnosis'
        ? '<p class="order-detail-muted">El diagnóstico está listo. Crea una cotización manual para pedir la aprobación del cliente.</p><button class="button button-primary" type="button" data-create-estimate="' + escapeHtml(order.id) + '">＋ Crear cotización</button>'
        : '<p class="order-detail-muted">La cotización se prepara después del diagnóstico. Estado actual: ' + escapeHtml(workOrderLabels[order.status] || order.status) + '.</p>';
    } else if (latest.status === 'draft') {
      const quoteItems = items.filter(item => item.estimate_id === latest.id);
      content = `<p class="order-detail-muted">Versión ${latest.version} · agrega los trabajos diagnosticados y guarda el borrador.</p><div id="estimateLines" data-estimate-id="${escapeHtml(latest.id)}">${(quoteItems.length ? quoteItems : [{}]).map(quoteEditorRow).join('')}</div><button class="subtle-link quote-add-line" type="button" data-add-quote-line>＋ Agregar concepto</button><div class="quote-settings"><label>Vigencia (días)<input id="estimateValidity" type="number" min="1" max="30" value="7"></label><label>Impuestos<select id="estimateTaxMode"><option value="included" ${latest.tax_mode === 'included' ? 'selected' : ''}>Incluidos en los precios</option><option value="excluded" ${latest.tax_mode === 'excluded' ? 'selected' : ''}>Agregar porcentaje</option><option value="none" ${latest.tax_mode === 'none' ? 'selected' : ''}>No aplica</option></select></label><label>Porcentaje<input id="estimateTaxRate" type="number" min="0" max="100" step="0.01" value="${escapeHtml(latest.tax_rate ?? 0)}"></label></div><label class="quote-notes-label">Nota para el cliente<textarea id="estimateNotes" rows="2" maxlength="1200" placeholder="Alcance, condiciones o recomendaciones">${escapeHtml(latest.notes || '')}</textarea></label><div class="quote-editor-actions"><button class="button button-quiet" type="button" data-save-estimate="${escapeHtml(latest.id)}">Guardar borrador</button><button class="button button-primary" type="button" data-send-estimate="${escapeHtml(latest.id)}">Guardar y enviar al cliente</button></div><div class="quote-link-result" id="quoteLinkResult" hidden></div>`;
    } else {
      const quoteItems = items.filter(item => item.estimate_id === latest.id);
      const totals = calculateEstimateTotals(quoteItems, latest.tax_mode, latest.tax_rate);
      content = `<div class="estimate-status-line"><span>Versión ${latest.version} · ${escapeHtml(estimateStatusLabels[latest.status] || latest.status)}</span><span>Vigente hasta ${escapeHtml(latest.valid_until ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(latest.valid_until)) : '—')}</span></div><div class="estimate-saved-lines">${quoteItems.map(item => { const decision = decisions.find(row => row.estimate_item_id === item.id); const decisionDate = decision?.decided_at ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(decision.decided_at)) : ''; return `<div><span><strong>${escapeHtml(item.description)}</strong><small>${escapeHtml(estimateCategoryLabels[item.category] || item.category)} · ${escapeHtml(item.quantity)} × ${formatMoney(item.unit_price)}</small>${decision ? `<small class="estimate-decision-detail">Respuesta de ${escapeHtml(decision.customer_name)} · ${escapeHtml(decisionDate)}</small>` : ''}</span><b>${formatMoney(Number(item.quantity) * Number(item.unit_price))}</b><em class="estimate-decision decision-${escapeHtml(item.decision)}">${escapeHtml(({ pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' })[item.decision] || item.decision)}</em></div>`; }).join('')}</div><div class="estimate-total-box"><span>Subtotal</span><strong>${formatMoney(totals.subtotal)}</strong><span>${latest.tax_mode === 'none' ? 'Impuestos' : `Impuesto ${latest.tax_mode === 'included' ? 'incluido' : 'adicional'} (${Number(latest.tax_rate)}%)`}</span><strong>${formatMoney(totals.tax)}</strong><span class="estimate-grand-total">Total cotizado</span><strong class="estimate-grand-total">${formatMoney(totals.total)}</strong></div>${latest.notes ? `<p class="order-detail-copy"><strong>Nota al cliente:</strong> ${escapeHtml(latest.notes)}</p>` : ''}${latest.status === 'sent' ? `<button class="button button-quiet" type="button" data-renew-quote-link="${escapeHtml(latest.id)}">Copiar o renovar enlace privado</button><div class="quote-link-result" id="quoteLinkResult" hidden></div>` : ''}${order.status === 'diagnosis' ? `<button class="button button-quiet quote-new-version" type="button" data-create-estimate="${escapeHtml(order.id)}">＋ Crear nueva versión</button>` : ''}`;
    }
    return `<section class="order-detail-card quote-workshop-card" data-order-id="${escapeHtml(order.id)}"><div class="quote-section-heading"><div><h3>Cotización para el cliente</h3><p>Se prepara después del diagnóstico y antes de iniciar los trabajos.</p></div></div>${content}<p class="order-status-feedback" id="quoteEditorFeedback" role="status" aria-live="polite"></p></section>`;
  }
  const workTypeLabels = { mechanical: 'Mecánica', bodywork: 'Latonería', paint: 'Pintura', assembly: 'Ensamble', quality_control: 'Control de calidad', other: 'Otro oficio' };
  const teamSpecialtyLabels = { mechanical: 'Mecánica', bodywork: 'Latonería', paint: 'Pintura' };
  function isOperationalTask(task) {
    if (task?.is_operational === false) return false;
    const title = String(task?.title || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
    return title !== 'pintura roja';
  }
  const techniciansForWorkType = (technicians, workType) => ['mechanical', 'bodywork', 'paint'].includes(workType)
    ? technicians.filter(profile => profile.specialty === workType)
    : technicians;

  function inferredTaskWorkType(item, task) {
    const text = `${item.description || ''} ${task?.title || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/pintur|pintor|pintar|barniz|color|pulir pintura/.test(text)) return 'paint';
    if (/latoner|carrocer|aboll|chapa|enderez|golpe/.test(text)) return 'bodywork';
    if (/mecanic|motor|freno|aceite|filtro|suspension|embrague|bateria/.test(text)) return 'mechanical';
    if (task?.work_type) return task.work_type;
    if (item.category === 'paint_materials') return 'paint';
    if (item.category === 'labor') return 'mechanical';
    return 'other';
  }

  function technicianOptions(technicians, workType, selectedId = '') {
    const eligible = techniciansForWorkType(technicians, workType);
    const placeholder = eligible.length ? 'Seleccionar técnico' : `No hay personal de ${teamSpecialtyLabels[workType] || workType} activo`;
    return `<option value="">${escapeHtml(placeholder)}</option>${eligible.map(profile => `<option value="${escapeHtml(profile.id)}" ${selectedId === profile.id ? 'selected' : ''}>${escapeHtml(profile.display_name)}</option>`).join('')}`;
  }

  function renderTaskAssignmentRow({ key, item = null, task = null, technicians, descriptors, taskDependencies, extra = false }) {
    const locked = Boolean(task && task.status !== 'pending');
    const selectedType = item ? inferredTaskWorkType(item, task) : inferredTaskWorkType({ description: task?.title || '', category: 'other' }, task);
    const selectedIsEligible = techniciansForWorkType(technicians, selectedType).some(profile => profile.id === task?.assigned_to);
    const savedPrerequisites = task ? taskDependencies.filter(row => row.task_id === task.id).map(row => row.prerequisite_task_id) : [];
    const selectedPrerequisites = savedPrerequisites.length
      ? savedPrerequisites
      : !task && selectedType === 'paint' ? descriptors.filter(row => row.key !== key && row.workType === 'bodywork').map(row => row.key) : [];
    const candidates = descriptors.filter(row => row.key !== key);
    const prerequisiteMarkup = candidates.length
      ? candidates.map(candidate => `<label class="task-prerequisite-option"><input type="checkbox" name="prerequisite_tasks" value="${escapeHtml(candidate.key)}" ${selectedPrerequisites.includes(candidate.key) ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>${escapeHtml(candidate.title || 'Nueva tarea')} <small>${escapeHtml(workTypeLabels[candidate.workType] || candidate.workType)}</small></span></label>`).join('')
      : '<small class="order-detail-muted">Agrega otra tarea para definir un prerequisito.</small>';
    const title = task?.title || item?.description || 'Actividad nueva';
    const team = escapeHtml(JSON.stringify(technicians.map(({ id, display_name, specialty }) => ({ id, display_name, specialty }))));
    return `<div class="task-assignment-row" data-task-key="${escapeHtml(key)}" data-estimate-item="${escapeHtml(item?.id || '')}" data-task-id="${escapeHtml(task?.id || '')}" data-task-status="${escapeHtml(task?.status || 'pending')}" ${extra ? 'data-extra-task="true"' : ''}><div class="task-assignment-source"><strong>${escapeHtml(title)}</strong><small>Actividad operativa · independiente de la cotización</small><label>Nombre de la actividad<input name="task_title" required maxlength="240" placeholder="Ej. Lijar guardabarros" value="${escapeHtml(task?.title || item?.description || '')}" ${locked ? 'disabled' : ''}></label></div><label>Oficio<select name="work_type" ${locked ? 'disabled' : ''}>${Object.entries(workTypeLabels).map(([value, label]) => `<option value="${value}" ${selectedType === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label><label>Asignar a<select name="assigned_to" data-technicians="${team}" ${locked ? 'disabled' : ''}>${technicianOptions(technicians, selectedType, selectedIsEligible ? task.assigned_to : '')}</select></label><fieldset class="task-prerequisites" ${locked ? 'disabled' : ''}><legend>Debe esperar a que terminen</legend><div class="task-prerequisite-options">${prerequisiteMarkup}</div></fieldset>${task ? `<p class="task-assignment-current">Tarea actual: ${escapeHtml(({ pending: 'Pendiente', in_progress: 'En curso', paused: 'Pausada', blocked: 'Bloqueada', done: 'Terminada' })[task.status] || task.status)}${locked ? ' · tarea bloqueada para cambios porque ya comenzó' : !selectedIsEligible ? ' · cambia el oficio o el técnico para que coincidan' : ''}</p>` : ''}${extra && !task ? '<button class="subtle-link task-remove-extra" type="button" data-remove-extra-task>Quitar actividad</button>' : ''}</div>`;
  }

  function renderTaskAssignments(order, estimates, items, tasks, technicians, taskDependencies) {
    const operationalTasks = tasks.filter(isOperationalTask);
    const taskRows = operationalTasks.map(task => ({
      key: task.id, item: null, task, title: task.title,
      workType: inferredTaskWorkType({ description: task.title, category: 'other' }, task), extra: true,
    }));
    const descriptors = taskRows;
    const taskMarkup = taskRows.length
      ? `<p class="order-detail-muted">Las tareas representan actividades reales; no son conceptos de cobro. La misma persona puede realizar varias actividades.</p><div class="task-assignment-rows" data-extra-task-rows>${taskRows.map(row => renderTaskAssignmentRow({ ...row, technicians, descriptors, taskDependencies })).join('')}</div>`
      : '<p class="order-detail-muted">Aún no hay actividades registradas. Agrega operaciones como latonería, lijado o aplicación de pintura.</p><div class="task-assignment-rows" data-extra-task-rows></div>';
    const team = escapeHtml(JSON.stringify(technicians.map(({ id, display_name, specialty }) => ({ id, display_name, specialty }))));
    const canAdd = order.status !== 'delivered';
    return `<section class="order-detail-card assignment-workshop-card"><div class="quote-section-heading"><div><h3>Actividades del taller</h3><p>La cotización define lo que se cobra; aquí se organiza el trabajo que se ejecutará.</p></div></div>${taskMarkup}<div class="task-assignment-actions">${canAdd ? `<button class="button button-quiet" type="button" data-add-extra-task data-technicians="${team}">＋ Agregar actividad</button>` : ''}<button class="button button-primary" type="button" data-save-task-assignments="${escapeHtml(order.id)}">Guardar actividades y asignaciones</button></div>${technicians.length ? '' : '<p class="order-status-feedback">Aún no hay técnicos activos. Puedes guardar actividades y asignarlas cuando el propietario registre o active al equipo.</p>'}<p class="order-status-feedback" id="assignmentFeedback" role="status" aria-live="polite"></p></section>`;
  }

  async function advanceOrderStatus(orderId) {
    const select = document.getElementById('nextOrderStatus');
    const button = document.getElementById('advanceOrderStatus');
    const feedback = document.getElementById('orderStatusFeedback');
    const nextStatus = select?.value;
    if (!nextStatus) return;
    button.disabled = true;
    feedback.textContent = 'Actualizando estado…';
    const { data: previous, error: fetchError } = await supabaseClient.from('work_orders').select('status').eq('id', orderId).single();
    if (fetchError) {
      feedback.textContent = 'No se pudo consultar el estado actual. Vuelve a intentarlo.';
      button.disabled = false;
      return;
    }
    if (!(nextWorkOrderStatuses[previous.status] || []).includes(nextStatus)) {
      feedback.textContent = 'Ese cambio no corresponde al flujo permitido para este estado.';
      button.disabled = false;
      return;
    }
    if (['approved', 'partially_approved'].includes(previous.status)) {
      const { data: estimate, error: estimateError } = await supabaseClient.from('estimates').select('id, status').eq('work_order_id', orderId).order('version', { ascending: false }).limit(1).maybeSingle();
      if (estimateError || !estimate || estimate.status !== previous.status) {
        feedback.textContent = 'La aprobación de la cotización y el estado de la orden no coinciden. Actualiza el detalle e inténtalo de nuevo.';
        button.disabled = false;
        return;
      }
      const { data: approvedItems, error: itemsError } = await supabaseClient.from('estimate_items').select('id').eq('estimate_id', estimate.id).eq('decision', 'approved');
      if (itemsError || !approvedItems?.length) {
        feedback.textContent = 'No se encontraron conceptos aprobados para preparar el trabajo.';
        button.disabled = false;
        return;
      }
    }
    if (nextStatus === 'in_repair' && ['approved', 'partially_approved', 'awaiting_parts'].includes(previous.status)) {
      const { data: assignedTasks, error: tasksError } = await supabaseClient.from('work_order_tasks').select('id, title, is_operational, assigned_to').eq('work_order_id', orderId).eq('is_operational', true).not('assigned_to', 'is', null);
      if (tasksError || !assignedTasks?.filter(isOperationalTask).length) {
        feedback.textContent = 'Asigna al menos una tarea real del taller antes de iniciar la reparación. Puedes asignar varias tareas a la misma persona.';
        button.disabled = false;
        return;
      }
    }
    if (previous.status === 'in_repair' && nextStatus === 'quality_control') {
      const { data: unfinishedTasks, error: unfinishedError } = await supabaseClient.from('work_order_tasks').select('id, title, is_operational, status').eq('work_order_id', orderId).eq('is_operational', true).neq('status', 'done');
      if (unfinishedError || unfinishedTasks?.filter(isOperationalTask).length) {
        feedback.textContent = 'Todas las tareas asignadas deben terminarse antes del control de calidad.';
        button.disabled = false;
        return;
      }
    }
    const updateFields = { status: nextStatus };
    if (nextStatus === 'delivered') updateFields.delivered_at = new Date().toISOString();
    if (previous.status === 'delivered') updateFields.delivered_at = null;
    const { error: updateError } = await supabaseClient.from('work_orders').update(updateFields).eq('id', orderId);
    if (updateError) {
      feedback.textContent = 'No se pudo actualizar el estado. Revisa tus permisos e inténtalo de nuevo.';
      button.disabled = false;
      return;
    }
    const { error: historyError } = await supabaseClient.from('work_order_status_history').insert({
      work_order_id: orderId,
      previous_status: previous.status,
      new_status: nextStatus,
      note: `Estado cambiado a ${workOrderLabels[nextStatus]}.`,
      changed_by: currentSession.user.id,
    });
    if (historyError) {
      await supabaseClient.from('work_orders').update({ status: previous.status, delivered_at: previous.status === 'delivered' ? new Date().toISOString() : null }).eq('id', orderId);
      feedback.textContent = 'No se pudo guardar el historial; el cambio de estado se revirtió. Inténtalo de nuevo.';
      button.disabled = false;
      return;
    }
    await loadReceptionOrders();
    showToast(`Estado actualizado: ${workOrderLabels[nextStatus]}.`);
    await openOrderDetail(orderId);
  }

  function renderOrderDetail({ order, customer, vehicle, checklist, damages, assets, history, estimates, estimateItems, estimateDecisions, tasks, technicians, taskDependencies = [] }) {
    const target = document.getElementById('orderDetailContent');
    const inspection = checklist?.checklist || {};
    const signature = assets.find(asset => asset.kind === 'signature');
    const photos = assets.filter(asset => asset.kind !== 'signature');
    const dateLabel = value => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(value)) : '—';
    const fuelLabels = ['Vacío', '1/4', '1/2', '3/4', 'Lleno'];
    const statusLabels = { ok: 'Sin novedad', issue: 'Con novedad', not_checked: 'Sin revisar' };
    const yesNo = value => value == null ? 'Sin revisar' : value ? 'Presente' : 'No está';
    const rows = [
      ['Combustible', fuelLabels[checklist?.fuel_level] || 'Sin revisar'],
      ['Tapicería', ({ good: 'Buen estado', fair: 'Uso normal', damaged: 'Con novedad' })[checklist?.upholstery_condition] || 'Sin revisar'],
      ['Llanta de repuesto', yesNo(checklist?.spare_tire_present)], ['Herramientas', yesNo(checklist?.tools_present)],
      ['Radio / pantalla', yesNo(checklist?.radio_present)], ['Luces', statusLabels[inspection.lights] || 'Sin revisar'],
      ['Llantas', statusLabels[inspection.tires] || 'Sin revisar'], ['Vidrios y espejos', statusLabels[inspection.glass_mirrors] || 'Sin revisar'],
    ];
    const viewNames = { front: 'Frente', rear: 'Parte trasera', left: 'Lado izquierdo', right: 'Lado derecho', top: 'Techo' };
    const damageNames = { scratch: 'Rayón', dent: 'Abolladura', broken: 'Pieza rota', other: 'Otro' };
    const nextStatuses = nextWorkOrderStatuses[order.status] || [];
    const displayStatus = order.status;
    const displayHistory = history;
    document.getElementById('orderDetailTitle').textContent = `Orden PM-${order.order_number} · ${vehicle.plate}`;
    target.innerHTML = `<div class="order-detail-hero"><div><p class="eyebrow">INGRESO · ${escapeHtml(dateLabel(order.received_at))}</p><h3>${escapeHtml([vehicle.make, vehicle.model, vehicle.model_year].filter(Boolean).join(' '))}</h3><p>${escapeHtml(customer.full_name)} · ${escapeHtml(vehicle.plate)}</p></div><span class="pill pill-${statusTone(displayStatus)}">${escapeHtml(workOrderLabels[displayStatus] || displayStatus)}</span></div>
      <div class="order-detail-grid"><section class="order-detail-card"><h3>Cliente</h3><dl><div><dt>Nombre</dt><dd>${escapeHtml(customer.full_name)}</dd></div><div><dt>Teléfono</dt><dd>${escapeHtml(customer.phone || '—')}</dd></div><div><dt>Correo</dt><dd>${escapeHtml(customer.email || '—')}</dd></div></dl></section>
      <section class="order-detail-card"><h3>Vehículo</h3><dl><div><dt>Placa</dt><dd>${escapeHtml(vehicle.plate)}</dd></div><div><dt>Marca y modelo</dt><dd>${escapeHtml([vehicle.make, vehicle.model, vehicle.model_year].filter(Boolean).join(' '))}</dd></div><div><dt>Color</dt><dd>${escapeHtml(vehicle.color || '—')}</dd></div><div><dt>Kilometraje</dt><dd>${new Intl.NumberFormat('es-CO').format(order.odometer_km || 0)} km</dd></div></dl></section></div>
      <section class="order-detail-card"><h3>Motivo de ingreso</h3><p class="order-detail-copy">${escapeHtml(order.customer_concern || 'Sin descripción')}</p></section>
      <section class="order-detail-card"><h3>Inspección de recepción</h3><div class="inspection-detail-grid">${rows.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div><p class="order-detail-copy"><strong>Observaciones:</strong> ${escapeHtml(inspection.inspection_notes || 'Sin observaciones')}</p><p class="order-detail-copy"><strong>Daños visibles:</strong> ${inspection.no_visible_damage ? 'No se observaron daños' : damages.length ? `${damages.length} novedad(es) anotada(s)` : 'No se registraron novedades'}</p></section>
      <section class="order-detail-card"><h3>Novedades registradas</h3>${damages.length ? `<div class="detail-damage-list">${damages.map(damage => `<article><strong>${escapeHtml(viewNames[damage.vehicle_view] || damage.vehicle_view)} · ${escapeHtml(damageNames[damage.damage_type] || damage.damage_type)}</strong><p>${escapeHtml(damage.note || 'Sin detalle adicional')}</p></article>`).join('')}</div>` : '<p class="order-detail-muted">No hay novedades registradas.</p>'}</section>
      <section class="order-detail-card"><h3>Fotos del vehículo <span class="detail-count">${photos.length}</span></h3>${photos.length ? `<div class="order-photo-grid">${photos.map(asset => `<figure><a href="${escapeHtml(asset.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(asset.url)}" alt="${escapeHtml(asset.caption || 'Foto del vehículo')}" loading="lazy"></a><figcaption>${escapeHtml(asset.caption || 'Foto de recepción')}</figcaption></figure>`).join('')}</div>` : '<p class="order-detail-muted">Esta orden no tiene fotos adjuntas.</p>'}</section>
      <section class="order-detail-card"><h3>Firma del cliente</h3>${signature ? `<a class="signature-preview-link" href="${escapeHtml(signature.url)}" target="_blank" rel="noopener"><img class="signature-preview" src="${escapeHtml(signature.url)}" alt="Firma del cliente"></a><p class="order-detail-muted">Registrada ${escapeHtml(dateLabel(checklist?.signed_at))}</p>` : '<p class="order-detail-muted">No hay firma asociada a esta orden.</p>'}</section>
      ${renderEstimateSection(order, estimates, estimateItems, estimateDecisions)}
      ${renderTaskAssignments(order, estimates, estimateItems, tasks, technicians, taskDependencies)}
      <section class="order-detail-card"><h3>Seguimiento de estados</h3>${nextStatuses.length ? `<div class="order-status-actions"><label for="nextOrderStatus">Mover a</label><select id="nextOrderStatus">${nextStatuses.map(status => `<option value="${status}">${escapeHtml(workOrderLabels[status])}</option>`).join('')}</select><button class="button button-primary" type="button" id="advanceOrderStatus" data-advance-order="${escapeHtml(order.id)}">Actualizar estado</button></div><p class="order-status-feedback" id="orderStatusFeedback" role="status" aria-live="polite"></p>` : `<p class="order-detail-muted">${order.status === 'diagnosis' ? 'Prepara y envía la cotización. La orden continúa cuando el cliente aprueba al menos un concepto.' : 'La orden está cerrada; no admite más cambios de estado.'}</p>`}${displayHistory.length ? `<ol class="order-status-history">${displayHistory.map(item => `<li><span class="order-history-dot"></span><div><strong>${escapeHtml(workOrderLabels[item.new_status] || item.new_status)}</strong><small>${escapeHtml(dateLabel(item.changed_at))}</small>${item.note ? `<p>${escapeHtml(item.note)}</p>` : ''}</div></li>`).join('')}</ol>` : '<p class="order-detail-muted">Aún no hay cambios registrados.</p>'}</section>
      <section class="order-detail-card"><h3>Registro de la orden</h3><dl><div><dt>Número</dt><dd>PM-${escapeHtml(order.order_number)}</dd></div><div><dt>Última actualización</dt><dd>${escapeHtml(dateLabel(order.updated_at))}</dd></div></dl></section>
      ${currentProfile?.role === 'owner' ? `<section class="order-detail-card order-delete-card"><h3>Eliminar vehículo y orden</h3><p>Se eliminarán los datos de recepción, cotizaciones, tareas, pagos y consumos vinculados. Si el vehículo tiene otras órdenes, se conservará.</p><button class="button button-delete-order" type="button" data-owner-delete-order data-order-id="${escapeHtml(order.id)}" data-order-number="${escapeHtml(order.order_number)}" data-plate="${escapeHtml(vehicle.plate)}">Eliminar vehículo y orden</button></section>` : ''}`;
  }

  async function openOrderDetail(orderId) {
    const detailDialog = document.getElementById('orderDetailDialog');
    const target = document.getElementById('orderDetailContent');
    document.getElementById('orderDetailTitle').textContent = 'Detalle de la orden';
    target.innerHTML = '<div class="empty-state">Cargando detalle desde Supabase…</div>';
    detailDialog.showModal();
    try {
      const { data: order, error: orderError } = await supabaseClient.from('work_orders').select('*').eq('id', orderId).single();
      if (orderError) throw orderError;
      const [customerResult, vehicleResult, checklistResult, damageResult, mediaResult, historyResult, estimatesResult, tasksResult, techniciansResult] = await Promise.all([
        supabaseClient.from('customers').select('*').eq('id', order.customer_id).single(),
        supabaseClient.from('vehicles').select('*').eq('id', order.vehicle_id).single(),
        supabaseClient.from('intake_checklists').select('*').eq('work_order_id', order.id).maybeSingle(),
        supabaseClient.from('damage_marks').select('*').eq('work_order_id', order.id).order('created_at'),
        supabaseClient.from('work_order_media').select('*').eq('work_order_id', order.id).order('captured_at'),
        supabaseClient.from('work_order_status_history').select('*').eq('work_order_id', order.id).order('changed_at'),
        supabaseClient.from('estimates').select('*').eq('work_order_id', order.id).order('version', { ascending: false }),
        supabaseClient.from('work_order_tasks').select('*').eq('work_order_id', order.id).eq('is_operational', true).order('created_at'),
        supabaseClient.from('profiles').select('id, display_name, specialty').eq('role', 'technician').eq('active', true).order('display_name'),
      ]);
      for (const result of [customerResult, vehicleResult, checklistResult, damageResult, mediaResult, historyResult, estimatesResult, tasksResult, techniciansResult]) if (result.error) throw result.error;
      const operationalTasks = (tasksResult.data || []).filter(isOperationalTask);
      const taskIds = operationalTasks.map(task => task.id);
      const taskDependenciesQuery = supabaseClient.from('work_order_task_dependencies').select('task_id, prerequisite_task_id');
      const taskDependenciesResult = taskIds.length
        ? await taskDependenciesQuery.in('task_id', taskIds)
        : await taskDependenciesQuery.limit(0);
      if (taskDependenciesResult.error) throw taskDependenciesResult.error;
      const estimates = estimatesResult.data || [];
      const estimateIds = estimates.map(estimate => estimate.id);
      const estimateItemsResult = estimateIds.length
        ? await supabaseClient.from('estimate_items').select('*').in('estimate_id', estimateIds).order('sort_order')
        : { data: [], error: null };
      if (estimateItemsResult.error) throw estimateItemsResult.error;
      const itemIds = (estimateItemsResult.data || []).map(item => item.id);
      const estimateDecisionsResult = itemIds.length
        ? await supabaseClient.from('estimate_item_decisions').select('estimate_item_id, customer_name, decided_at').in('estimate_item_id', itemIds).order('decided_at', { ascending: false })
        : { data: [], error: null };
      if (estimateDecisionsResult.error) throw estimateDecisionsResult.error;
      const assets = await Promise.all((mediaResult.data || []).map(async asset => {
        const { data, error } = await supabaseClient.storage.from('order-media').createSignedUrl(asset.object_path, 3600);
        if (error) throw error;
        return { kind: asset.media_kind, caption: asset.caption, url: data.signedUrl };
      }));
      renderOrderDetail({ order, customer: customerResult.data, vehicle: vehicleResult.data, checklist: checklistResult.data, damages: damageResult.data || [], assets, history: historyResult.data || [], estimates, estimateItems: estimateItemsResult.data || [], estimateDecisions: estimateDecisionsResult.data || [], tasks: operationalTasks, technicians: techniciansResult.data || [], taskDependencies: taskDependenciesResult.data || [] });
    } catch (error) {
      console.error('Prisma Motor: no se pudo cargar el detalle de la orden.', { code: error?.code, message: error?.message });
      target.innerHTML = '<div class="reception-load-error">No se pudo cargar el detalle desde Supabase. Revisa la conexión o los permisos e inténtalo de nuevo.</div>';
    }
  }

  async function saveTaskAssignments(orderId) {
    const rows = [...document.querySelectorAll('.task-assignment-row')];
    const feedback = document.getElementById('assignmentFeedback');
    const button = document.querySelector('[data-save-task-assignments]');
    if (!feedback || !button) {
      showToast('No encontré el formulario de asignaciones. Cierra el detalle y vuelve a abrirlo.');
      return;
    }
    const newTasks = [];
    const updates = [];
    const taskIdByKey = new Map(rows.map(row => [row.dataset.taskKey, row.dataset.taskId || (row.dataset.taskStatus === 'pending' ? crypto.randomUUID() : null)]));
    const editableTaskIds = [];
    const dependencyRows = [];
    for (const row of rows) {
      if (row.dataset.taskStatus !== 'pending') continue;
      const title = row.querySelector('[name="task_title"]').value.trim();
      const assignee = row.querySelector('[name="assigned_to"]').value;
      const workType = row.querySelector('[name="work_type"]').value;
      if (!title) {
        const missingField = row.querySelector('[name="task_title"]');
        const label = row.querySelector('.task-assignment-source > strong')?.textContent || 'una de las tareas';
        feedback.textContent = `Escribe el nombre de la tarea «${label}».`;
        missingField?.focus();
        feedback.scrollIntoView({ behavior: 'smooth', block: 'center' });
        showToast('Falta el nombre de una tarea.');
        return;
      }
      const taskId = taskIdByKey.get(row.dataset.taskKey);
      if (!taskId) { feedback.textContent = 'No se pudo identificar una tarea para guardar. Cierra y vuelve a abrir el detalle.'; return; }
      const fields = { title, work_type: workType, assigned_to: assignee || null };
      if (row.dataset.taskId) updates.push({ id: row.dataset.taskId, fields });
      else newTasks.push({
        ...fields,
        id: taskId,
        work_order_id: orderId,
        estimate_item_id: row.dataset.estimateItem || null,
        is_operational: true,
        status: 'pending',
        created_by: currentSession.user.id,
      });
      editableTaskIds.push(taskId);
      for (const prerequisite of row.querySelectorAll('[name="prerequisite_tasks"]:checked')) {
        const prerequisiteId = taskIdByKey.get(prerequisite.value);
        if (!prerequisiteId) { feedback.textContent = 'Uno de los prerequisitos ya no está en la lista. Vuelve a abrir el detalle.'; return; }
        dependencyRows.push({ task_id: taskId, prerequisite_task_id: prerequisiteId });
      }
    }
    const dependencyGraph = new Map();
    for (const row of rows) {
      const taskId = taskIdByKey.get(row.dataset.taskKey);
      if (!taskId) continue;
      dependencyGraph.set(taskId, [...row.querySelectorAll('[name="prerequisite_tasks"]:checked')]
        .map(input => taskIdByKey.get(input.value)).filter(Boolean));
    }
    const visiting = new Set();
    const visited = new Set();
    const hasCycle = taskId => {
      if (visiting.has(taskId)) return true;
      if (visited.has(taskId)) return false;
      visiting.add(taskId);
      for (const prerequisiteId of dependencyGraph.get(taskId) || []) if (hasCycle(prerequisiteId)) return true;
      visiting.delete(taskId);
      visited.add(taskId);
      return false;
    };
    if ([...dependencyGraph.keys()].some(hasCycle)) {
      feedback.textContent = 'Hay un ciclo entre prerequisitos. Ajusta las tareas para que ninguna dependa de sí misma directa o indirectamente.';
      showToast('Revisa el orden de prerequisitos antes de guardar.');
      return;
    }
    if (!newTasks.length && !updates.length) { feedback.textContent = 'No hay cambios pendientes en las asignaciones.'; return; }
    button.disabled = true;
    feedback.textContent = 'Guardando las tareas asignadas…';
    try {
      for (const update of updates) {
        const { data, error } = await supabaseClient.from('work_order_tasks').update(update.fields).eq('id', update.id).eq('work_order_id', orderId).select('id');
        if (error) throw error;
        if (!data?.length) throw new Error('Supabase no actualizó la tarea. Revisa que tu usuario tenga rol de propietario o asesor.');
      }
      if (newTasks.length) {
        const { error } = await supabaseClient.from('work_order_tasks').insert(newTasks);
        if (error) throw error;
      }
      if (editableTaskIds.length) {
        const { error } = await supabaseClient.from('work_order_task_dependencies').delete().in('task_id', editableTaskIds);
        if (error) throw error;
      }
      if (dependencyRows.length) {
        const { error } = await supabaseClient.from('work_order_task_dependencies').insert(dependencyRows);
        if (error) throw error;
      }
      const unassignedCount = rows.filter(row => row.dataset.taskStatus === 'pending' && !row.querySelector('[name="assigned_to"]')?.value).length;
      feedback.textContent = unassignedCount
        ? `Tareas guardadas. ${unassignedCount} ${unassignedCount === 1 ? 'queda pendiente de asignar' : 'quedan pendientes de asignar'}. Actualizando…`
        : 'Tareas, asignaciones y prerequisitos guardados. Actualizando el detalle…';
      await loadReceptionOrders();
      await openOrderDetail(orderId);
      showToast(unassignedCount
        ? `Cambios guardados; ${unassignedCount} ${unassignedCount === 1 ? 'tarea queda' : 'tareas quedan'} pendiente${unassignedCount === 1 ? '' : 's'} de asignar.`
        : `${newTasks.length + updates.length} ${newTasks.length + updates.length === 1 ? 'tarea guardada' : 'tareas guardadas'} con sus prerequisitos.`);
    } catch (error) {
      console.error('Prisma Motor: no se pudieron guardar las tareas asignadas.', { code: error?.code, message: error?.message });
      const detail = error?.code === '42501'
        ? 'Supabase rechazó el permiso. Confirma que tu perfil tenga rol Propietario o Asesor.'
        : error?.code === '23503'
          ? 'El técnico seleccionado ya no está activo. Actualiza el detalle y vuelve a elegirlo.'
          : ['42P01', 'PGRST205'].includes(error?.code)
            ? 'Aplica 20261116000100_task_prerequisites.sql en Supabase antes de guardar los prerequisitos.'
            : error?.code === '23514'
              ? error.message
              : error?.message || 'Error de conexión con Supabase.';
      feedback.textContent = `No se guardaron las asignaciones. ${detail}`;
      showToast('No se guardaron las asignaciones. Lee el mensaje junto al botón.');
      button.disabled = false;
    }
  }

  let currentPublicQuoteToken = null;

  function renderPublicQuote(quote) {
    const target = document.getElementById('clientQuoteContent');
    const items = quote.items || [];
    const totals = calculateEstimateTotals(items, quote.tax_mode, quote.tax_rate);
    const approvedItems = items.filter(item => item.decision === 'approved');
    const approvedTotals = calculateEstimateTotals(approvedItems, quote.tax_mode, quote.tax_rate);
    const money = value => formatMoney(value, quote.currency || 'COP');
    const canDecide = quote.status === 'sent';
    const decisionLabels = { sent: 'Esperando tu decisión', approved: 'Aprobada', partially_approved: 'Aprobación parcial', rejected: 'Rechazada', expired: 'Vencida' };
    const customerStatusLabels = { received: 'Vehículo recibido', diagnosis: 'Diagnóstico', awaiting_approval: 'Esperando aprobación', approved: 'Aprobado', partially_approved: 'Aprobación parcial', awaiting_parts: 'Esperando repuestos', in_repair: 'En reparación', quality_control: 'Control de calidad', ready_for_delivery: 'Listo para entrega', delivered: 'Entregado' };
    const history = quote.status_history || [];
    const taskProgress = quote.task_progress || { total: 0, completed: 0 };
    const payments = quote.payments || [];
    const paidAmount = Number(quote.payment_summary?.paid_amount || 0);
    const balance = Math.max((approvedItems.length ? approvedTotals.total : 0) - paidAmount, 0);
    const trackingStatus = quote.order_status;
    const timeline = history.length ? [...history] : [{ status: quote.order_status, changed_at: quote.received_at }];
    if (timeline[timeline.length - 1].status !== trackingStatus) timeline.push({ status: trackingStatus, changed_at: null });
    const dateText = value => value ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value)) : 'Por confirmar';
    const progressMarkup = `<section class="client-progress-card"><header><div><p class="eyebrow">SEGUIMIENTO</p><h2>Historial del servicio</h2></div></header><div class="client-progress-meta"><span>Ingreso · <strong>${escapeHtml(dateText(quote.received_at))}</strong></span><span>Entrega estimada · <strong>${escapeHtml(dateText(quote.target_delivery_at))}</strong></span></div>${Number(taskProgress.total) > 0 ? `<div class="client-task-progress"><div><span>Actividades completadas</span><strong>${escapeHtml(taskProgress.completed)} de ${escapeHtml(taskProgress.total)}</strong></div><progress max="${escapeHtml(taskProgress.total)}" value="${escapeHtml(taskProgress.completed)}"></progress></div>` : ''}<ol class="client-status-timeline">${timeline.map(event => `<li><span></span><div><strong>${escapeHtml(customerStatusLabels[event.status] || event.status)}</strong><small>${event.changed_at ? escapeHtml(new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(event.changed_at))) : 'Estado actual'}</small></div></li>`).join('')}</ol><p class="client-tracking-privacy">El seguimiento muestra solo las etapas compartidas por el taller.</p></section>`;
    const categoryGroups = [
      { key: 'labor', title: 'Actividades y mano de obra' },
      { key: 'parts', title: 'Repuestos' },
      { key: 'paint_materials', title: 'Insumos y materiales' },
      { key: 'other', title: 'Otros conceptos' },
    ].map(group => ({ ...group, items: items.filter(item => item.category === group.key) })).filter(group => group.items.length);
    const quoteLinesMarkup = categoryGroups.map(group => `<div class="client-quote-group"><h3>${escapeHtml(group.title)}</h3>${group.items.map(item => `<article class="client-quote-line"><div><strong>${escapeHtml(item.description)}</strong><small>${escapeHtml(item.quantity)} × ${money(item.unit_price)}</small></div><b>${money(Number(item.quantity) * Number(item.unit_price))}</b>${canDecide ? `<label class="client-decision-select"><span>Tu decisión</span><select data-public-decision="${escapeHtml(item.id)}" required><option value="">Seleccionar</option><option value="approved">Apruebo este concepto</option><option value="rejected">No lo apruebo</option></select></label>` : `<span class="estimate-decision decision-${escapeHtml(item.decision)}">${escapeHtml(({ pending: 'Pendiente', approved: 'Aprobado', rejected: 'Rechazado' })[item.decision] || item.decision)}</span>`}</article>`).join('')}</div>`).join('');
    const quoteTotal = canDecide ? totals : approvedItems.length ? approvedTotals : totals;
    const quoteSection = `<section class="client-quote-section"><div class="client-quote-section-heading"><div><p class="eyebrow">PROPUESTA PRISMA MOTOR · VERSIÓN ${escapeHtml(quote.version)}</p><h2>${canDecide ? 'Revisa y decide' : 'Detalle de la cotización'}</h2></div>${quote.valid_until ? `<span class="client-secure-label">Vigente hasta ${escapeHtml(dateText(quote.valid_until))}</span>` : ''}</div>${canDecide ? '<form id="clientQuoteDecisionForm">' : ''}<div class="client-quote-lines">${quoteLinesMarkup}</div><div class="client-quote-totals"><div><span>Subtotal ${canDecide ? 'cotizado' : 'aprobado'}</span><b>${money(quoteTotal.subtotal)}</b></div><div><span>${quote.tax_mode === 'none' ? 'Impuestos' : `Impuesto ${quote.tax_mode === 'included' ? 'incluido' : 'adicional'} (${Number(quote.tax_rate)}%)`}</span><b>${money(quoteTotal.tax)}</b></div><div class="client-quote-grand-total"><span>Total ${canDecide ? 'propuesto' : 'aprobado'}</span><b>${money(quoteTotal.total)}</b></div></div>${quote.notes ? `<section class="client-quote-notes"><strong>Nota para ti</strong><p>${escapeHtml(quote.notes)}</p></section>` : ''}${canDecide ? `<label class="client-decision-name">Nombre de quien decide<input name="customer_name" form="clientQuoteDecisionForm" required minlength="2" placeholder="Escribe tu nombre"></label><p class="client-quote-smallprint">Elige una respuesta para cada concepto. El taller recibirá tu decisión.</p><p class="client-quote-feedback" id="clientQuoteFeedback" role="status" aria-live="polite"></p><button class="button button-primary full-width" id="submitClientQuote" form="clientQuoteDecisionForm" type="submit">Enviar mi decisión</button></form>` : `<div class="client-quote-result">${quote.status === 'rejected' ? 'El taller recibió tu respuesta y podrá preparar una nueva propuesta si hace falta.' : quote.status === 'expired' ? 'Esta cotización venció. Comunícate con el taller para solicitar una propuesta actualizada.' : 'Tu decisión fue registrada. El taller continuará con los conceptos aprobados.'}</div>`}</section>`;
    const quotePanel = canDecide ? quoteSection : `<details class="client-approved-quote"><summary><span>Ver detalle de la cotización</span><strong>${money(quoteTotal.total)}</strong></summary>${quoteSection}</details>`;
    const paymentMarkup = quote.payment_summary && ['approved', 'partially_approved'].includes(quote.status) ? `<section class="client-payment-card"><div><p class="eyebrow">PAGOS DEL SERVICIO</p><h3>Saldo y abonos</h3></div><div class="client-payment-totals"><span>Total aprobado<strong>${money(approvedTotals.total)}</strong></span><span>Abonado<strong>${money(paidAmount)}</strong></span><span>Saldo pendiente<strong>${money(balance)}</strong></span></div>${payments.length ? `<ul>${payments.map(payment => `<li><span>${escapeHtml(dateText(payment.paid_at))} · ${escapeHtml(({ cash: 'Efectivo', transfer: 'Transferencia', card: 'Tarjeta', other: 'Otro medio' })[payment.payment_method] || 'Pago')}</span><b>${money(payment.amount)}</b></li>`).join('')}</ul>` : '<p class="client-no-payments">Aún no hay pagos registrados para esta orden.</p>'}</section>` : '';
    const contactMessage = encodeURIComponent(`Hola, Prisma Motor. Tengo una consulta sobre la orden PM-${quote.order_number} de mi vehículo ${quote.plate}.`);
    const contactMarkup = `<section class="client-contact-card"><div><p class="eyebrow">¿NECESITAS AYUDA?</p><strong>Estamos aquí para acompañarte.</strong><small>Abre WhatsApp y selecciona el contacto de Prisma Motor.</small></div><a class="client-contact-link" href="https://wa.me/?text=${contactMessage}" target="_blank" rel="noopener">Abrir WhatsApp <span aria-hidden="true">↗</span></a></section>`;
    const statusLabel = customerStatusLabels[trackingStatus] || trackingStatus;
    const decisionLabel = decisionLabels[quote.status] || quote.status;
    const trackingFirst = !canDecide;
    target.innerHTML = `<section class="client-vehicle-hero"><div class="client-vehicle-welcome"><p class="eyebrow">ORDEN PM-${escapeHtml(quote.order_number)} · ${escapeHtml(decisionLabel)}</p><h1>Hola, ${escapeHtml(quote.customer_name)}</h1><p>Este es el estado de tu vehículo y el detalle de su servicio.</p></div><div class="client-vehicle-summary"><span class="client-car-icon" aria-hidden="true">✦</span><div><small>VEHÍCULO</small><strong>${escapeHtml(quote.vehicle)}</strong><span>Placa · ${escapeHtml(quote.plate)}</span></div></div><div class="client-current-status"><small>ESTADO ACTUAL</small><strong>${escapeHtml(statusLabel)}</strong></div></section><div class="client-portal-grid ${trackingFirst ? 'is-tracking-first' : 'is-decision-pending'}">${trackingFirst ? progressMarkup + paymentMarkup + quotePanel : quotePanel + progressMarkup}</div>${contactMarkup}<p class="client-quote-footer">PRISMA MOTOR · Tu vehículo, en buenas manos.</p>`;
    if (canDecide) document.getElementById('clientQuoteDecisionForm').addEventListener('submit', submitClientQuoteDecision);
  }

  async function loadClientQuotePortal(token) {
    currentPublicQuoteToken = token;
    document.body.classList.add('client-quote-mode');
    document.getElementById('authGate').hidden = true;
    document.getElementById('clientQuotePortal').hidden = false;
    try {
      if (!supabaseClient) throw new Error('No se pudo conectar con el taller.');
      const { data, error } = await supabaseClient.rpc('get_client_quote', { p_token: token });
      if (error) throw error;
      renderPublicQuote(data);
    } catch (error) {
      console.error('Prisma Motor: no se pudo abrir el enlace de cotización.', { code: error?.code, message: error?.message });
      document.getElementById('clientQuoteContent').innerHTML = '<h1>Este enlace no está disponible</h1><p class="client-quote-intro">Puede haber vencido o ya no estar activo. Comunícate con Prisma Motor para solicitar un nuevo enlace.</p>';
    }
  }

  async function submitClientQuoteDecision(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const feedback = document.getElementById('clientQuoteFeedback');
    const button = document.getElementById('submitClientQuote');
    const decisions = [...form.querySelectorAll('[data-public-decision]')].map(select => ({ item_id: select.dataset.publicDecision, decision: select.value }));
    if (decisions.some(item => !item.decision)) { feedback.textContent = 'Elige aprobar o rechazar cada concepto.'; return; }
    button.disabled = true;
    feedback.textContent = 'Registrando tu respuesta…';
    const { error } = await supabaseClient.rpc('submit_client_quote_decisions', {
      p_token: currentPublicQuoteToken,
      p_decisions: decisions,
      p_customer_name: new FormData(form).get('customer_name'),
    });
    if (error) {
      feedback.textContent = error.message || 'No se pudo registrar la decisión. Vuelve a cargar el enlace e inténtalo de nuevo.';
      button.disabled = false;
      return;
    }
    const { data, error: reloadError } = await supabaseClient.rpc('get_client_quote', { p_token: currentPublicQuoteToken });
    if (reloadError) { feedback.textContent = 'Tu respuesta se registró. Puedes cerrar esta página.'; return; }
    renderPublicQuote(data);
  }

  async function createEstimateDraft(orderId) {
    const { data: existing, error: readError } = await supabaseClient.from('estimates').select('version').eq('work_order_id', orderId).order('version', { ascending: false }).limit(1);
    if (readError) { showToast('No se pudo consultar las versiones de cotización.'); return; }
    const version = (existing?.[0]?.version || 0) + 1;
    const { error } = await supabaseClient.from('estimates').insert({ work_order_id: orderId, version, status: 'draft', currency: 'COP', created_by: currentSession.user.id });
    if (error) {
      console.error('Prisma Motor: no se pudo crear el borrador de cotización.', { code: error.code, message: error.message });
      showToast(error.code === '42703' ? 'Primero aplica la migración de cotizaciones en Supabase.' : 'No se pudo crear el borrador.');
      return;
    }
    await openOrderDetail(orderId);
  }

  function showQuoteLink(token) {
    const result = document.getElementById('quoteLinkResult');
    if (!result) return;
    const shareUrl = new URL(location.href);
    shareUrl.search = '';
    shareUrl.hash = `quote=${encodeURIComponent(token)}`;
    const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname) || location.hostname.endsWith('.local');
    const isPublicHttps = location.protocol === 'https:' && !isLocalHost;
    const whatsappMessage = `Hola, Prisma Motor te comparte la cotización de tu vehículo. Revísala y registra tu decisión aquí: ${shareUrl.href}`;
    const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(whatsappMessage)}`;
    result.hidden = false;
    result.innerHTML = `<p>Enlace privado de aprobación para el cliente.</p><div><input id="quoteShareLink" type="url" readonly value="${escapeHtml(shareUrl.href)}" aria-label="Enlace privado de la cotización"><button class="button button-primary" type="button" data-copy-quote-link>Copiar enlace</button>${isPublicHttps ? `<a class="button button-quiet" href="${escapeHtml(whatsappUrl)}" target="_blank" rel="noopener">Compartir por WhatsApp</a>` : ''}</div>${isPublicHttps ? '<small>El enlace vence al terminar la vigencia configurada y solo permite consultar esta cotización.</small>' : '<small class="quote-link-local-warning">Prisma Motor está en modo local. Este enlace solo funciona en este equipo; el cliente no podrá abrirlo desde WhatsApp. Publícalo en una dirección HTTPS pública y genera un enlace nuevo.</small>'}`;
  }

  async function generateQuoteLink(estimateId, validityDays = 7) {
    const { data: token, error } = await supabaseClient.rpc('send_client_quote', { p_estimate_id: estimateId, p_validity_days: validityDays });
    if (error) {
      console.error('Prisma Motor: no se pudo generar el enlace de aprobación.', { code: error.code, message: error.message });
      const feedback = document.getElementById('quoteEditorFeedback');
      if (feedback) feedback.textContent = error.code === 'PGRST202' ? 'Falta aplicar la migración de cotizaciones en Supabase.' : (error.message || 'No se pudo generar el enlace.');
      return null;
    }
    showQuoteLink(token);
    return token;
  }

  async function saveEstimateDraft(estimateId, sendToCustomer) {
    const editor = document.getElementById('estimateLines');
    const feedback = document.getElementById('quoteEditorFeedback');
    const button = document.querySelector(`[data-${sendToCustomer ? 'send' : 'save'}-estimate="${estimateId}"]`);
    const validity = Number(document.getElementById('estimateValidity').value);
    const taxMode = document.getElementById('estimateTaxMode').value;
    const taxRate = Number(document.getElementById('estimateTaxRate').value);
    if (!Number.isInteger(validity) || validity < 1 || validity > 30 || !Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      feedback.textContent = 'Revisa la vigencia (1 a 30 días) y el porcentaje de impuestos (0 a 100).';
      return;
    }
    const lines = [...editor.querySelectorAll('.quote-editor-line')].map(row => ({
      row,
      inventory_product_id: row.querySelector('[name="inventory_product_id"]').value || null,
      category: row.querySelector('[name="category"]').value,
      description: row.querySelector('[name="description"]').value.trim(),
      quantity: row.querySelector('[name="quantity"]').value.trim() === '' ? NaN : Number(row.querySelector('[name="quantity"]').value),
      unit_price: row.querySelector('[name="unit_price"]').value.trim() === '' ? NaN : Number(row.querySelector('[name="unit_price"]').value),
      product_unit: row.querySelector('[name="product_unit"]').value,
      estimated_cost: row.querySelector('[name="estimated_cost"]').value.trim() === '' ? NaN : Number(row.querySelector('[name="estimated_cost"]').value),
    }));
    const invalid = lines.find(line => !line.description || !Number.isFinite(line.quantity) || line.quantity <= 0 || !Number.isFinite(line.unit_price) || line.unit_price < 0);
    if (invalid) { feedback.textContent = 'Completa descripción, cantidad y precio de cada concepto.'; return; }
    const missingCost = lines.find(line => !line.inventory_product_id && ['parts', 'paint_materials'].includes(line.category) && (!Number.isFinite(line.estimated_cost) || line.estimated_cost < 0 || !line.product_unit));
    if (missingCost) { feedback.textContent = `Agrega el costo estimado interno y la unidad de «${missingCost.description}» para crear el producto en el catálogo.`; return; }
    const duplicateManualProduct = lines.find(line => !line.inventory_product_id && ['parts', 'paint_materials'].includes(line.category)
      && state.inventoryProducts.some(product => product.category === line.category && product.name.trim().toLocaleLowerCase('es-CO') === line.description.trim().toLocaleLowerCase('es-CO')));
    if (duplicateManualProduct) { feedback.textContent = `«${duplicateManualProduct.description}» ya está en el catálogo. Selecciónalo en “Producto del catálogo” para reutilizar su costo.`; return; }

    button.disabled = true;
    feedback.textContent = 'Guardando conceptos…';
    const { error: updateError } = await supabaseClient.from('estimates').update({
      notes: document.getElementById('estimateNotes').value.trim() || null,
      tax_mode: taxMode,
      tax_rate: taxMode === 'none' ? 0 : taxRate,
      valid_until: new Date(Date.now() + validity * 86400000).toISOString(),
    }).eq('id', estimateId).eq('status', 'draft');
    if (updateError) {
      feedback.textContent = updateError.code === '42703' ? 'Aplica primero la migración de cotizaciones en Supabase.' : 'No se pudo guardar la cotización.';
      button.disabled = false;
      return;
    }
    for (const line of lines) {
      if (line.inventory_product_id || !['parts', 'paint_materials'].includes(line.category)) continue;
      feedback.textContent = `Agregando «${line.description}» al catálogo…`;
      const { data: product, error: productError } = await supabaseClient.from('inventory_products').insert({
        name: line.description,
        category: line.category,
        unit: line.product_unit,
        cost_price: line.estimated_cost,
        sale_price: line.unit_price,
        active: true,
        created_by: currentSession.user.id,
      }).select('*').single();
      if (productError) {
        console.error('Prisma Motor: no se pudo crear el producto manual de la cotización.', { code: productError.code, message: productError.message });
        feedback.textContent = ['42P01', '42703', 'PGRST205'].includes(productError.code)
          ? 'No se pudo crear el producto. Revisa que las migraciones de inventario estén aplicadas.'
          : 'No se pudo crear el producto en el catálogo. Revisa el nombre y los permisos de inventario.';
        button.disabled = false;
        return;
      }
      line.inventory_product_id = product.id;
      state.inventoryProducts.push(product);
      state.inventoryProducts.sort((a, b) => a.name.localeCompare(b.name, 'es-CO'));
      const productSelect = line.row.querySelector('[name="inventory_product_id"]');
      productSelect.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} · ${escapeHtml(inventoryUnits[product.unit] || product.unit)}</option>`);
      productSelect.value = product.id;
      syncManualProductFields(line.row);
    }
    const { error: deleteError } = await supabaseClient.from('estimate_items').delete().eq('estimate_id', estimateId);
    if (deleteError) { feedback.textContent = 'No se pudieron actualizar los conceptos.'; button.disabled = false; return; }
    const { error: insertError } = await supabaseClient.from('estimate_items').insert(lines.map(({ row, product_unit, estimated_cost, ...line }, index) => ({ ...line, estimate_id: estimateId, sort_order: index })));
    if (insertError) { feedback.textContent = 'No se pudieron guardar los conceptos. Revisa sus datos.'; button.disabled = false; return; }
    let token = null;
    if (sendToCustomer) {
      feedback.textContent = 'Generando enlace privado y enviando la cotización…';
      token = await generateQuoteLink(estimateId, validity);
      if (!token) { button.disabled = false; return; }
    }
    await openOrderDetail(editor.closest('.quote-workshop-card').dataset.orderId);
    if (token) showQuoteLink(token);
    else showToast('Borrador de cotización guardado.');
  }

  async function loadReceptionOrders() {
    if (!supabaseClient || !currentProfile || !['owner', 'advisor'].includes(currentProfile.role)) return;
    state.receptionLoading = true;
    state.receptionError = '';
    try {
      const { data: rows, error: orderError } = await supabaseClient
        .from('work_orders')
        .select('id, order_number, customer_id, vehicle_id, status, received_at, target_delivery_at')
        .neq('status', 'delivered')
        .order('received_at', { ascending: false })
        .limit(200);
      if (orderError) throw orderError;

      const customerIds = [...new Set((rows || []).map(row => row.customer_id))];
      const vehicleIds = [...new Set((rows || []).map(row => row.vehicle_id))];
      let customerRows = [];
      let vehicleRows = [];
      if (customerIds.length && vehicleIds.length) {
        const [customersResult, vehiclesResult] = await Promise.all([
          supabaseClient.from('customers').select('id, full_name, phone').in('id', customerIds),
          supabaseClient.from('vehicles').select('id, plate, make, model, model_year').in('id', vehicleIds),
        ]);
        if (customersResult.error) throw customersResult.error;
        if (vehiclesResult.error) throw vehiclesResult.error;
        customerRows = customersResult.data || [];
        vehicleRows = vehiclesResult.data || [];
      }
      let operationalTasks = [];
      if ((rows || []).length) {
        const { data: taskRows, error: taskError } = await supabaseClient.from('work_order_tasks')
          .select('work_order_id, status').eq('is_operational', true).in('work_order_id', rows.map(row => row.id));
        if (taskError) throw taskError;
        operationalTasks = taskRows || [];
      }
      const tasksByOrder = new Map();
      operationalTasks.forEach(task => {
        const progress = tasksByOrder.get(task.work_order_id) || { total: 0, done: 0 };
        progress.total += 1;
        if (task.status === 'done') progress.done += 1;
        tasksByOrder.set(task.work_order_id, progress);
      });
      const customersById = new Map(customerRows.map(row => [row.id, row]));
      const vehiclesById = new Map(vehicleRows.map(row => [row.id, row]));
      const normalized = (rows || []).map(row => {
        const customer = customersById.get(row.customer_id);
        const vehicle = vehiclesById.get(row.vehicle_id);
        if (!customer || !vehicle) return null;
        const vehicleName = [vehicle.make, vehicle.model, vehicle.model_year].filter(Boolean).join(' ');
        const displayStatus = row.status;
        const status = workOrderLabels[displayStatus] || displayStatus;
        return {
          id: row.id,
          orderNumber: row.order_number,
          rawStatus: row.status,
          displayStatus,
          plate: vehicle.plate,
          make: vehicleName,
          vehicle: vehicleName,
          customer: customer.full_name,
          phone: customer.phone,
          time: new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' }).format(new Date(row.received_at)),
          receivedAt: row.received_at,
          targetDeliveryAt: row.target_delivery_at,
          completedTasks: tasksByOrder.get(row.id)?.done || 0,
          totalTasks: tasksByOrder.get(row.id)?.total || 0,
          stage: status,
          status,
          tone: statusTone(displayStatus),
        };
      }).filter(Boolean);

      state.orders = normalized;
      vehicleGroups.workshop.items = normalized.filter(row => workshopStatuses.has(row.rawStatus)).map(({ id, plate, vehicle, customer, status, tone }) => ({ id, plate, vehicle, customer, status, tone }));
      vehicleGroups.waiting.items = normalized.filter(row => row.rawStatus === 'received').map(({ id, plate, vehicle, customer, status, tone }) => ({ id, plate, vehicle, customer, status, tone }));
      vehicleGroups.delivery.items = normalized.filter(row => row.rawStatus === 'ready_for_delivery').map(({ id, plate, vehicle, customer, status, tone }) => ({ id, plate, vehicle, customer, status, tone }));
      state.receptionLive = true;
    } catch (error) {
      state.orders = [];
      vehicleGroups.workshop.items = [];
      vehicleGroups.waiting.items = [];
      vehicleGroups.delivery.items = [];
      state.receptionError = 'No se pudieron cargar las órdenes. Revisa la conexión y vuelve a intentar.';
      console.error('Prisma Motor: falló la carga de órdenes de recepción.', error);
    } finally {
      state.receptionLoading = false;
      if (state.role === 'reception') render();
    }
  }

  async function loadTechnicianTasks() {
    if (!supabaseClient || !currentSession || !currentProfile) return;
    state.technicianLoading = true;
    state.technicianError = '';
    if (state.role === 'technician') render();
    try {
      const { data: fetchedTaskRows, error: taskError } = await supabaseClient.from('work_order_tasks').select('*').eq('is_operational', true).eq('assigned_to', currentSession.user.id).order('created_at', { ascending: false }).limit(200);
      if (taskError) throw taskError;
      const taskRows = (fetchedTaskRows || []).filter(isOperationalTask);
      const assignedTaskIds = taskRows.map(task => task.id);
      const prerequisiteResult = assignedTaskIds.length
        ? await supabaseClient.rpc('app_task_prerequisite_status', { p_task_ids: assignedTaskIds })
        : { data: [], error: null };
      if (prerequisiteResult.error) throw prerequisiteResult.error;
      const prerequisitesByTask = new Map();
      for (const prerequisite of prerequisiteResult.data || []) {
        const entries = prerequisitesByTask.get(prerequisite.task_id) || [];
        entries.push({ id: prerequisite.prerequisite_task_id, title: prerequisite.prerequisite_title, status: prerequisite.prerequisite_status });
        prerequisitesByTask.set(prerequisite.task_id, entries);
      }
      const orderIds = [...new Set(taskRows.map(task => task.work_order_id))];
      let orderRows = [];
      let vehicleRows = [];
      let checklistRows = [];
      let damageRows = [];
      let mediaRows = [];
      if (orderIds.length) {
        const { data, error } = await supabaseClient.from('work_orders').select('id, order_number, status, vehicle_id, customer_concern, received_at, target_delivery_at, odometer_km').in('id', orderIds);
        if (error) throw error;
        orderRows = data || [];
        const vehicleIds = [...new Set(orderRows.map(order => order.vehicle_id))];
        const [vehicleResult, checklistResult, damageResult, mediaResult] = await Promise.all([
          vehicleIds.length
            ? supabaseClient.from('vehicles').select('id, plate, make, model, model_year, color').in('id', vehicleIds)
            : Promise.resolve({ data: [], error: null }),
          supabaseClient.from('intake_checklists').select('*').in('work_order_id', orderIds),
          supabaseClient.from('damage_marks').select('id, work_order_id, vehicle_view, damage_type, note').in('work_order_id', orderIds).order('created_at'),
          supabaseClient.from('work_order_media').select('id, work_order_id, media_kind, object_path, caption, captured_at').in('work_order_id', orderIds).order('created_at'),
        ]);
        for (const result of [vehicleResult, checklistResult, damageResult, mediaResult]) if (result.error) throw result.error;
        vehicleRows = vehicleResult.data || [];
        checklistRows = checklistResult.data || [];
        damageRows = damageResult.data || [];
        mediaRows = mediaResult.data || [];
      }
      const ordersById = new Map(orderRows.map(order => [order.id, order]));
      const vehiclesById = new Map(vehicleRows.map(vehicle => [vehicle.id, vehicle]));
      const checklistsByOrder = new Map(checklistRows.map(row => [row.work_order_id, row]));
      const damagesByOrder = new Map();
      for (const damage of damageRows) {
        const entries = damagesByOrder.get(damage.work_order_id) || [];
        entries.push(damage);
        damagesByOrder.set(damage.work_order_id, entries);
      }
      const mediaByOrder = new Map();
      for (const asset of mediaRows.filter(row => !['signature', 'delivery'].includes(row.media_kind))) {
        const entries = mediaByOrder.get(asset.work_order_id) || [];
        entries.push(asset);
        mediaByOrder.set(asset.work_order_id, entries);
      }
      const signedMediaByOrder = new Map();
      for (const [orderId, assets] of mediaByOrder) {
        const signedAssets = await Promise.all(assets.map(async asset => {
          const { data, error } = await supabaseClient.storage.from('order-media').createSignedUrl(asset.object_path, 3600);
          if (error) throw error;
          return { ...asset, url: data.signedUrl };
        }));
        signedMediaByOrder.set(orderId, signedAssets);
      }
      state.technicianTasks = taskRows.map(task => {
        const order = ordersById.get(task.work_order_id);
        const vehicle = order && vehiclesById.get(order.vehicle_id);
        return order && vehicle ? {
          ...task,
          prerequisites: prerequisitesByTask.get(task.id) || [],
          order_number: order.order_number,
          order_status: order.status,
          plate: vehicle.plate,
          vehicle: [vehicle.make, vehicle.model, vehicle.model_year].filter(Boolean).join(' '),
          vehicle_color: vehicle.color,
          customer_concern: order.customer_concern,
          received_at: order.received_at,
          target_delivery_at: order.target_delivery_at,
          odometer_km: order.odometer_km,
          intake_checklist: checklistsByOrder.get(order.id) || null,
          damages: damagesByOrder.get(order.id) || [],
          media: signedMediaByOrder.get(order.id) || [],
        } : null;
      }).filter(Boolean);
    } catch (error) {
      state.technicianError = 'No se pudieron cargar tus tareas. Revisa la conexión y vuelve a intentar.';
      console.error('Prisma Motor: falló la carga de tareas asignadas.', { code: error?.code, message: error?.message });
    } finally {
      state.technicianLoading = false;
      if (state.role === 'technician') render();
    }
  }

  function formatTaskTime(task) {
    let seconds = Number(task.total_seconds) || 0;
    if (task.active_started_at) seconds += Math.max(0, Math.floor((Date.now() - new Date(task.active_started_at).getTime()) / 1000));
    const hours = String(Math.floor(seconds / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
    const remainder = String(seconds % 60).padStart(2, '0');
    return `${hours}:${minutes}:${remainder}`;
  }

  function refreshTaskTimers() {
    document.querySelectorAll('[data-task-timer]').forEach(element => {
      const task = state.technicianTasks.find(row => row.id === element.dataset.taskTimer);
      if (task) element.textContent = formatTaskTime(task);
    });
  }

  function technicianOrderDetailsMarkup(task) {
    const checklist = task.intake_checklist;
    const inspection = checklist?.checklist || {};
    const statusLabels = { ok: 'Sin novedad', issue: 'Con novedad', not_checked: 'Sin revisar' };
    const fuelLabels = ['Vacío', '1/4', '1/2', '3/4', 'Lleno'];
    const yesNo = value => value == null ? 'Sin revisar' : value ? 'Presente' : 'No está';
    const damageLabels = { scratch: 'Rayón', dent: 'Abolladura', broken: 'Pieza rota', other: 'Otro' };
    const viewLabels = { front: 'Frente', rear: 'Parte trasera', left: 'Lado izquierdo', right: 'Lado derecho', top: 'Techo' };
    const checklistRows = [
      ['Combustible', fuelLabels[checklist?.fuel_level] || 'Sin revisar'],
      ['Tapicería', ({ good: 'Buen estado', fair: 'Uso normal', damaged: 'Con novedad' })[checklist?.upholstery_condition] || 'Sin revisar'],
      ['Llanta de repuesto', yesNo(checklist?.spare_tire_present)],
      ['Herramientas', yesNo(checklist?.tools_present)],
      ['Radio / pantalla', yesNo(checklist?.radio_present)],
      ['Luces', statusLabels[inspection.lights] || 'Sin revisar'],
      ['Llantas', statusLabels[inspection.tires] || 'Sin revisar'],
      ['Vidrios y espejos', statusLabels[inspection.glass_mirrors] || 'Sin revisar'],
    ];
    const photos = task.media || [];
    const progressPhotos = photos.filter(asset => asset.media_kind === 'progress');
    const receptionPhotos = photos.filter(asset => asset.media_kind !== 'progress');
    const receivedAt = task.received_at ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(task.received_at)) : '—';
    const deliveryAt = task.target_delivery_at ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(task.target_delivery_at)) : 'Por confirmar';
    return `<details class="tech-order-details"><summary>Ficha de ingreso y evidencia</summary><div class="tech-order-detail-content">
      <section><h5>Solicitud del cliente</h5><p>${escapeHtml(task.customer_concern || 'No se registró un motivo de ingreso.')}</p></section>
      <div class="tech-order-facts"><span>Ingreso<strong>${escapeHtml(receivedAt)}</strong></span><span>Kilometraje<strong>${Number.isFinite(Number(task.odometer_km)) ? `${new Intl.NumberFormat('es-CO').format(task.odometer_km)} km` : '—'}</strong></span><span>Entrega estimada<strong>${escapeHtml(deliveryAt)}</strong></span><span>Color<strong>${escapeHtml(task.vehicle_color || '—')}</strong></span></div>
      <section><h5>Inspección de recepción</h5><div class="tech-inspection-grid">${checklistRows.map(([label, value]) => `<span>${escapeHtml(label)}<strong>${escapeHtml(value)}</strong></span>`).join('')}</div><p>${escapeHtml(inspection.inspection_notes || 'Sin observaciones de recepción.')}</p></section>
      <section><h5>Daños informados</h5>${task.damages.length ? `<ul class="tech-damage-list">${task.damages.map(damage => `<li><strong>${escapeHtml(viewLabels[damage.vehicle_view] || damage.vehicle_view)} · ${escapeHtml(damageLabels[damage.damage_type] || damage.damage_type)}</strong><span>${escapeHtml(damage.note || 'Sin detalle adicional.')}</span></li>`).join('')}</ul>` : '<p>No se registraron daños visibles.</p>'}</section>
      <section><h5>Fotos de ingreso y diagnóstico</h5>${receptionPhotos.length ? `<div class="tech-photo-grid">${receptionPhotos.map(asset => `<a href="${escapeHtml(asset.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(asset.url)}" alt="${escapeHtml(asset.caption || 'Evidencia del vehículo')}" loading="lazy"><span>${escapeHtml(asset.caption || (asset.media_kind === 'damage' ? 'Daño' : asset.media_kind === 'diagnosis' ? 'Diagnóstico' : 'Recepción'))}</span></a>`).join('')}</div>` : '<p>Aún no hay fotos de ingreso o diagnóstico.</p>'}</section>
      <section><h5>Fotos de avance <span class="tech-photo-count">${progressPhotos.length}</span></h5>${progressPhotos.length ? `<div class="tech-photo-grid">${progressPhotos.map(asset => `<a href="${escapeHtml(asset.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(asset.url)}" alt="${escapeHtml(asset.caption || 'Foto de avance')}" loading="lazy"><span>${escapeHtml(asset.caption || 'Avance')}</span></a>`).join('')}</div>` : '<p>Todavía no hay evidencia de avance.</p>'}</section>
      ${task.status !== 'done' ? `<form class="tech-progress-form" data-technician-progress-form data-task-id="${escapeHtml(task.id)}"><label>Adjuntar foto de avance<input name="progress_photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required></label><label>Nota breve<input name="caption" type="text" maxlength="160" placeholder="Ej. Pieza desmontada para reparación" required></label><button class="button button-quiet" type="submit">Guardar evidencia</button><p class="tech-progress-feedback" role="status" aria-live="polite"></p></form>` : ''}
    </div></details>`;
  }

  async function saveTechnicianProgress(form) {
    const task = state.technicianTasks.find(row => row.id === form.dataset.taskId);
    const feedback = form.querySelector('.tech-progress-feedback');
    const button = form.querySelector('[type="submit"]');
    const file = form.elements.progress_photo.files[0];
    const caption = form.elements.caption.value.trim();
    if (!task || task.status === 'done' || !file || !caption) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 15 * 1024 * 1024) {
      feedback.textContent = 'Selecciona una foto JPG, PNG o WEBP de máximo 15 MB.';
      return;
    }
    button.disabled = true;
    feedback.textContent = 'Preparando y guardando la evidencia…';
    const mediaId = crypto.randomUUID();
    let objectPath = null;
    try {
      const optimized = await optimizeVehiclePhoto(file);
      objectPath = `${task.work_order_id}/progress/${mediaId}.${optimized.extension}`;
      const { error: uploadError } = await supabaseClient.storage.from('order-media').upload(objectPath, optimized.blob, {
        cacheControl: '3600', contentType: optimized.contentType, upsert: false,
      });
      if (uploadError) throw uploadError;
      const { error: rowError } = await supabaseClient.from('work_order_media').insert({
        id: mediaId,
        work_order_id: task.work_order_id,
        media_kind: 'progress',
        object_path: objectPath,
        content_type: optimized.contentType,
        caption,
        uploaded_by: currentSession.user.id,
        captured_at: new Date().toISOString(),
      });
      if (rowError) throw rowError;
      showToast('Foto de avance guardada.');
      await loadTechnicianTasks();
    } catch (error) {
      console.error('Prisma Motor: no se pudo guardar la evidencia de avance.', { code: error?.code, message: error?.message });
      feedback.textContent = 'No se pudo guardar la evidencia. Revisa la conexión y los permisos de tu tarea e inténtalo de nuevo.';
      button.disabled = false;
    }
  }

  async function updateTechnicianTask(taskId, action) {
    const task = state.technicianTasks.find(row => row.id === taskId);
    if (!task) return;
    const card = document.querySelector(`[data-task-id="${taskId}"]`);
    const now = new Date().toISOString();
    const changes = {};
    const currentSeconds = Number(task.total_seconds) || 0;
    const activeSeconds = task.active_started_at ? Math.max(0, Math.floor((Date.now() - new Date(task.active_started_at).getTime()) / 1000)) : 0;
    if (action === 'start') changes.status = 'in_progress', changes.started_at = task.started_at || now, changes.active_started_at = now, changes.blocked_note = null;
    if (action === 'pause') changes.status = 'paused', changes.total_seconds = currentSeconds + activeSeconds, changes.active_started_at = null;
    if (action === 'complete') changes.status = 'done', changes.total_seconds = currentSeconds + activeSeconds, changes.active_started_at = null, changes.completed_at = now, changes.blocked_note = null;
    if (action === 'block') {
      const note = card?.querySelector('[data-block-note]')?.value.trim();
      if (!note) { showToast('Describe brevemente qué está bloqueando esta tarea.'); return; }
      changes.status = 'blocked';
      changes.blocked_note = note;
      changes.total_seconds = currentSeconds + activeSeconds;
      changes.active_started_at = null;
    }
    const { error } = await supabaseClient.from('work_order_tasks').update(changes).eq('id', taskId).eq('assigned_to', currentSession.user.id);
    if (error) {
      console.error('Prisma Motor: no se pudo actualizar la tarea.', { code: error.code, message: error.message });
      showToast(error.code === '23514' ? error.message : 'No se pudo actualizar la tarea. Revisa tu conexión e inténtalo de nuevo.');
      return;
    }
    showToast(action === 'complete' ? 'Tarea marcada como terminada.' : action === 'block' ? 'Bloqueo informado al taller.' : action === 'pause' ? 'Cronómetro pausado.' : 'Tarea iniciada.');
    await loadTechnicianTasks();
  }

  async function refreshPendingIntakes() {
    if (!currentSession) return;
    try {
      state.pendingIntakes = await getPendingIntakes(currentSession.user.id);
      if (state.role === 'reception') render();
    } catch (error) {
      console.warn('Prisma Motor: no se pudo consultar la cola local de recepciones.', error?.message);
    }
  }

  async function syncPendingIntakes() {
    if (syncingPendingIntakes || !navigator.onLine || !supabaseClient || !currentProfile || !['owner', 'advisor'].includes(currentProfile.role)) return;
    syncingPendingIntakes = true;
    let syncedCount = 0;
    try {
      const records = await getPendingIntakes(currentSession.user.id);
      for (const record of records) {
        try {
          await syncIntakeRecord(record);
          await removePendingIntake(record.id);
          syncedCount++;
        } catch (error) {
          console.warn('Prisma Motor: una recepción sigue pendiente de sincronización.', error?.code || error?.message);
          break;
        }
      }
      state.pendingIntakes = await getPendingIntakes(currentSession.user.id);
      if (syncedCount) await loadReceptionOrders();
      if (syncedCount) showToast(`${syncedCount} ${syncedCount === 1 ? 'recepción sincronizada' : 'recepciones sincronizadas'} con Supabase.`);
    } catch (error) {
      console.warn('Prisma Motor: no se pudo sincronizar la cola local.', error?.message);
    } finally {
      syncingPendingIntakes = false;
      if (state.role === 'reception') render();
    }
  }

  function renderDamageMarks() {
    const target = document.getElementById('damageMarksList');
    if (!target) return;
    const viewNames = { front: 'Frente', rear: 'Parte trasera', left: 'Lado izquierdo', right: 'Lado derecho', top: 'Techo' };
    const typeNames = { scratch: 'Rayón', dent: 'Abolladura', broken: 'Pieza rota', other: 'Otro' };
    target.innerHTML = state.intakeDamageMarks.map((mark, index) => `<div class="damage-mark-item"><span><strong>${escapeHtml(viewNames[mark.vehicle_view])} · ${escapeHtml(typeNames[mark.damage_type])}</strong><small>${escapeHtml(mark.note)}</small></span><button type="button" data-remove-damage="${index}" aria-label="Quitar novedad">×</button></div>`).join('');
  }

  function setIntakeStep(step) {
    currentIntakeStep = step;
    document.querySelectorAll('[data-intake-step]').forEach(section => { section.hidden = Number(section.dataset.intakeStep) !== step; });
    document.querySelectorAll('[data-intake-indicator]').forEach(indicator => {
      const index = Number(indicator.dataset.intakeIndicator);
      indicator.classList.toggle('active', index <= step);
      indicator.classList.toggle('current', index === step);
    });
    if (step === 2) requestAnimationFrame(() => { if (!document.getElementById('customerSignature').width) prepareSignatureCanvas(); });
    if (step === 3) renderIntakeSummary();
    const form = document.getElementById('intakeForm');
    if (form) form.scrollTop = 0;
  }

  function validateIntakeStep(step) {
    const section = document.querySelector(`[data-intake-step="${step}"]`);
    for (const field of section.querySelectorAll('input[required], select[required], textarea[required]')) {
      if (!field.checkValidity()) { field.reportValidity(); return false; }
    }
    if (step === 2 && !intakeSignatureReady) {
      document.getElementById('signatureMessage').textContent = 'Necesitamos la firma del cliente para completar el acta de recepción.';
      return false;
    }
    if (step === 2) document.getElementById('signatureMessage').textContent = '';
    return true;
  }

  function renderIntakeSummary() {
    const values = new FormData(document.getElementById('intakeForm'));
    const modelYear = values.get('model_year') ? ` ${values.get('model_year')}` : '';
    const photos = document.getElementById('intakePhotos').files.length;
    document.getElementById('intakeSummary').innerHTML = `<div class="intake-summary-row"><span>Cliente</span><strong>${escapeHtml(values.get('customer'))} · ${escapeHtml(values.get('phone'))}</strong></div>
      <div class="intake-summary-row"><span>Vehículo</span><strong>${escapeHtml(values.get('plate').toUpperCase())} · ${escapeHtml(values.get('make'))} ${escapeHtml(values.get('model'))}${escapeHtml(modelYear)}</strong></div>
      <div class="intake-summary-row"><span>Kilometraje</span><strong>${new Intl.NumberFormat('es-CO').format(Number(values.get('odometer') || 0))} km</strong></div>
      <div class="intake-summary-row"><span>Novedades visibles</span><strong>${state.intakeDamageMarks.length ? state.intakeDamageMarks.length : 'Sin daños marcados'}</strong></div>
      <div class="intake-summary-row"><span>Evidencia</span><strong>${photos} ${photos === 1 ? 'foto' : 'fotos'} · Firma registrada</strong></div>
      <div class="intake-summary-reason"><span>Motivo de ingreso</span><p>${escapeHtml(values.get('reason'))}</p></div>`;
  }

  function prepareSignatureCanvas() {
    const canvas = document.getElementById('customerSignature');
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    signatureContext = canvas.getContext('2d');
    signatureContext.setTransform(ratio, 0, 0, ratio, 0, 0);
    signatureContext.lineWidth = 2;
    signatureContext.lineCap = 'round';
    signatureContext.lineJoin = 'round';
    signatureContext.strokeStyle = '#203b6b';
    signatureContext.fillStyle = '#fff';
    signatureContext.fillRect(0, 0, rect.width, rect.height);
  }

  function clearSignature() {
    const canvas = document.getElementById('customerSignature');
    intakeSignatureReady = false;
    if (!canvas) return;
    if (!canvas.width) prepareSignatureCanvas();
    else if (signatureContext) signatureContext.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    if (signatureContext) {
      signatureContext.fillStyle = '#fff';
      signatureContext.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    }
  }

  function resetIntakeFlow() {
    document.getElementById('intakeForm').reset();
    ['damageView', 'damageType', 'damageNote'].forEach(id => { document.getElementById(id).disabled = false; });
    document.querySelector('[data-add-damage]').disabled = false;
    state.intakeDamageMarks = [];
    renderDamageMarks();
    document.getElementById('intakeSaveMessage').textContent = '';
    document.getElementById('signatureMessage').textContent = '';
    document.getElementById('photoSelection').textContent = 'Sin fotos seleccionadas';
    document.getElementById('saveIntakeButton').disabled = false;
    document.getElementById('saveIntakeButton').innerHTML = 'Guardar recepción <span aria-hidden="true">✓</span>';
    document.getElementById('customerSignature').width = 0;
    intakeSignatureReady = false;
    signatureContext = null;
    setIntakeStep(1);
  }

  function addIntakeDamageMark() {
    if (document.getElementById('noVisibleDamage').checked) return;
    const note = document.getElementById('damageNote').value.trim();
    if (!note) { showToast('Describe brevemente la novedad antes de agregarla.'); return; }
    state.intakeDamageMarks.push({
      vehicle_view: document.getElementById('damageView').value,
      damage_type: document.getElementById('damageType').value,
      note,
    });
    document.getElementById('damageNote').value = '';
    renderDamageMarks();
  }

  function receptionView() {
    const appointments = state.orders.map(order => `<article class="appointment">
      <span class="appointment-time">${escapeHtml(order.time)}</span>
      <div class="vehicle-info"><div class="vehicle-thumb" aria-hidden="true"><svg viewBox="0 0 40 28" role="presentation"><path d="M5 17.5 8 10a3 3 0 0 1 2.8-1.9h18.4A3 3 0 0 1 32 10l3 7.5v5H5z"/><path d="m10 15 2.4-5h15.2l2.4 5z"/><circle cx="11" cy="22" r="2.3"/><circle cx="29" cy="22" r="2.3"/></svg></div><div><strong>${escapeHtml(order.plate)} · ${escapeHtml(order.make)}</strong><small>${escapeHtml(order.customer)}</small></div></div>
      <span class="pill pill-${escapeHtml(order.tone)}">${escapeHtml(order.stage)}</span>
    </article>`).join('');
    return `<div class="screen-grid">
      <div class="stats-grid">
        <article class="stat-card"><span class="stat-icon">▦</span><div><small>Vehículos en taller</small><strong>${state.orders.length + 5}</strong></div></article>
        <article class="stat-card"><span class="stat-icon orange">◷</span><div><small>Esperando atención</small><strong>2</strong></div></article>
        <article class="stat-card"><span class="stat-icon cyan">✓</span><div><small>Listos para entrega</small><strong>1</strong></div></article>
      </div>
      <label class="search-box"><span aria-hidden="true">⌕</span><input id="orderSearch" type="search" placeholder="Buscar por placa, cliente o teléfono…"><span class="search-shortcut">Buscar</span></label>
      <section><div class="section-title"><h2>Citas de hoy</h2><small>${new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())} · ${state.orders.length} vehículos</small></div><div class="appointment-list" id="appointmentList">${appointments || '<div class="empty-state">Aún no hay vehículos registrados.</div>'}</div></section>
      <section class="quick-columns">
        <article class="quick-card"><span>En diagnóstico</span><strong>2</strong><em>›</em></article>
        <article class="quick-card"><span>Esperando aprobación</span><strong>3</strong><em>›</em></article>
        <article class="quick-card"><span>Listos para entregar</span><strong>1</strong><em>›</em></article>
      </section>
      <p class="demo-hint">Datos de ejemplo para revisar el diseño. Aún no están conectados a Supabase.</p>
    </div>`;
  }

  function receptionViewPremium() {
    const today = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    const inWorkshop = state.orders.filter(order => workshopStatuses.has(order.rawStatus));
    const waitingOrders = state.orders.filter(order => order.rawStatus === 'received');
    const deliveryOrders = state.orders.filter(order => order.rawStatus === 'ready_for_delivery');
    const agendaStatuses = [...new Set(state.orders.map(order => order.stage))];
    const statusOptions = agendaStatuses.map(stage => `<option value="${escapeHtml(stage)}">${escapeHtml(stage)}</option>`).join('');
    const relativeReceptionTime = value => {
      const elapsedHours = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 3600000));
      if (elapsedHours < 1) return 'Hace menos de 1 h';
      if (elapsedHours < 24) return `Hace ${elapsedHours} h`;
      const days = Math.floor(elapsedHours / 24);
      return `Hace ${days} ${days === 1 ? 'día' : 'días'}`;
    };
    const appointments = state.orders.map(order => {
      const progress = order.totalTasks ? Math.round(order.completedTasks / order.totalTasks * 100) : 0;
      const delivery = order.targetDeliveryAt ? new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(order.targetDeliveryAt)) : '';
      const taskSummary = order.totalTasks ? `${order.completedTasks}/${order.totalTasks} actividades` : 'Actividades por definir';
      return `<article class="appointment reception-appointment reception-appointment-open" data-stage="${escapeHtml(order.stage)}" data-order-detail="${escapeHtml(order.id)}" role="button" tabindex="0" aria-label="Ver orden PM-${escapeHtml(order.orderNumber)} de ${escapeHtml(order.plate)}">
      <div class="appointment-time"><strong>${escapeHtml(order.time)}</strong><small>PM-${escapeHtml(order.orderNumber)}</small></div>
      <div class="vehicle-thumb" aria-hidden="true"><svg viewBox="0 0 40 28" role="presentation"><path d="M5 17.5 8 10a3 3 0 0 1 2.8-1.9h18.4A3 3 0 0 1 32 10l3 7.5v5H5z"/><path d="m10 15 2.4-5h15.2l2.4 5z"/><circle cx="11" cy="22" r="2.3"/><circle cx="29" cy="22" r="2.3"/></svg></div>
      <div class="vehicle-info"><div><strong>${escapeHtml(order.plate)} · ${escapeHtml(order.make)}</strong><small>${escapeHtml(order.customer)} · ${escapeHtml(order.phone)}</small><div class="reception-order-meta"><span>${escapeHtml(relativeReceptionTime(order.receivedAt))}</span>${delivery ? `<span>Entrega ${escapeHtml(delivery)}</span>` : ''}</div><div class="reception-progress"><div><small>${escapeHtml(taskSummary)}</small><small>${order.totalTasks ? `${progress}%` : ''}</small></div>${order.totalTasks ? `<span><i style="width:${progress}%"></i></span>` : ''}</div></div></div>
      <span class="pill pill-${escapeHtml(order.tone)}">${escapeHtml(order.stage)}</span>
      <span class="appointment-chevron" aria-hidden="true">›</span>
    </article>`;
    }).join('');
    return `<div class="screen-grid reception-view">
      <section class="reception-welcome"><div class="reception-welcome-copy"><p class="eyebrow">OPERACIÓN DEL TALLER</p><h2>Una recepción clara. Un taller bajo control.</h2><p>Seguimiento desde que llega el vehículo hasta que está listo para entrega.</p></div><div class="reception-date"><span>HOY</span><strong>${escapeHtml(today)}</strong></div><button class="button button-primary reception-intake-button" type="button" data-open-intake><span aria-hidden="true">＋</span> Recibir vehículo</button></section>
      <div class="stats-grid reception-stats">
        <button class="stat-card" type="button" data-vehicle-list="workshop" aria-label="Ver vehículos en el taller: ${inWorkshop.length}"><span class="stat-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 14.5 5.5 9a2 2 0 0 1 1.8-1.2h9.4A2 2 0 0 1 18.5 9l2.5 5.5V19h-2v-2H5v2H3z"/><path d="M6 14h12M7.5 11h9"/><circle cx="7" cy="15.5" r="1"/><circle cx="17" cy="15.5" r="1"/></svg></span><span class="stat-metric"><small>En el taller</small><strong>${String(inWorkshop.length).padStart(2, '0')}</strong></span><span class="stat-detail">diagnóstico, reparación o calidad</span><span class="stat-open-hint">Ver lista <b aria-hidden="true">›</b></span></button>
        <button class="stat-card" type="button" data-vehicle-list="waiting" aria-label="Ver vehículos esperando atención: ${waitingOrders.length}"><span class="stat-icon stat-icon-copper"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></svg></span><span class="stat-metric"><small>Esperando atención</small><strong>${String(waitingOrders.length).padStart(2, '0')}</strong></span><span class="stat-detail">recibidos, aún sin diagnóstico</span><span class="stat-open-hint">Ver lista <b aria-hidden="true">›</b></span></button>
        <button class="stat-card" type="button" data-vehicle-list="delivery" aria-label="Ver vehículos listos para entrega: ${deliveryOrders.length}"><span class="stat-icon stat-icon-slate"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7"/><circle cx="12" cy="12" r="9"/></svg></span><span class="stat-metric"><small>Listos para entrega</small><strong>${String(deliveryOrders.length).padStart(2, '0')}</strong></span><span class="stat-detail">coordinar con cliente</span><span class="stat-open-hint">Ver lista <b aria-hidden="true">›</b></span></button>
      </div>
      ${state.pendingIntakes.length ? `<div class="reception-load-error" role="status">${state.pendingIntakes.length} ${state.pendingIntakes.length === 1 ? 'recepción pendiente' : 'recepciones pendientes'} de sincronizar.${navigator.onLine ? ' ' : ' Cuando vuelva internet, se sincronizarán automáticamente.'}${navigator.onLine ? '<button type="button" data-sync-intakes>Sincronizar ahora</button>' : ''}</div>` : ''}
      <section class="reception-agenda"><header class="reception-agenda-heading"><div><p class="eyebrow">RECEPCIÓN · ${escapeHtml(today.toUpperCase())}</p><h2>Órdenes activas</h2><p>Vehículos que siguen en el taller, con su estado actual.</p></div><span class="agenda-count">${state.receptionLoading ? '…' : state.orders.length}<small>órdenes</small></span></header>
        ${state.receptionError ? `<div class="reception-load-error" role="status">${escapeHtml(state.receptionError)} <button type="button" data-reload-reception>Reintentar</button></div>` : ''}
        <div class="reception-tools"><label class="search-box"><span aria-hidden="true">⌕</span><input id="orderSearch" type="search" placeholder="Buscar placa, vehículo o cliente…" aria-label="Buscar en la agenda"><span class="search-shortcut">Buscar</span></label><label class="filter-select"><span>Estado de agenda</span><select id="orderStatusFilter" aria-label="Filtrar esta lista por estado"><option value="">Todos los estados</option>${statusOptions}</select></label></div>
        <div class="reception-list-heading"><span>HORA</span><span>VEHÍCULO · CLIENTE</span><span>ESTADO</span><span></span></div>
        <div class="appointment-list reception-list" id="appointmentList">${state.receptionLoading ? '<div class="empty-state">Cargando órdenes desde Supabase…</div>' : appointments || '<div class="empty-state">No hay órdenes activas registradas.</div>'}</div>
        <div class="empty-state reception-filter-empty" id="noAgendaMatches" hidden>No hay vehículos que coincidan con esos criterios.</div>
        <p class="reception-demo-note"><span class="demo-indicator"></span> ${state.receptionLive ? 'Datos actualizados desde Supabase.' : state.receptionLoading ? 'Consultando Supabase…' : 'Aún no hay conexión de datos.'}</p>
      </section>
    </div>`;
  }

  function technicianView() {
    const tasks = state.technicianTasks;
    const active = tasks.filter(task => task.status === 'in_progress').length;
    const done = tasks.filter(task => task.status === 'done').length;
    const statusLabels = { pending: 'Pendiente', in_progress: 'En curso', paused: 'Pausada', blocked: 'Bloqueada', done: 'Terminada' };
    const statusTones = { pending: 'amber', in_progress: 'blue', paused: 'amber', blocked: 'red', done: 'green' };
    const taskCards = tasks.map(task => {
      const unfinishedPrerequisites = (task.prerequisites || []).filter(prerequisite => prerequisite.status !== 'done');
      const prerequisiteNotice = unfinishedPrerequisites.length
        ? `<p class="task-prerequisite-blocked"><strong>Esperando que terminen:</strong> ${unfinishedPrerequisites.map(item => `${escapeHtml(item.title)} (${escapeHtml(statusLabels[item.status] || item.status)})`).join(' · ')}</p>`
        : task.prerequisites?.length ? '<p class="task-prerequisite-ready">Prerequisitos completados. Puedes continuar.</p>' : '';
      const startDisabled = unfinishedPrerequisites.length ? 'disabled title="Completa los prerequisitos antes de iniciar"' : '';
      return `<article class="technician-task" data-task-id="${escapeHtml(task.id)}"><header><div><p class="eyebrow">ORDEN PM-${escapeHtml(task.order_number)} · ${escapeHtml(workOrderLabels[task.order_status] || task.order_status)}</p><h3>${escapeHtml(task.plate)} · ${escapeHtml(task.vehicle)}</h3></div><span class="pill pill-${statusTones[task.status] || 'blue'}">${escapeHtml(statusLabels[task.status] || task.status)}</span></header><div class="technician-task-body"><span class="task-type-label">${escapeHtml(workTypeLabels[task.work_type] || task.work_type)}</span><h4>${escapeHtml(task.title)}</h4>${prerequisiteNotice}${task.blocked_note ? `<p class="task-blocked-note"><strong>Bloqueo informado:</strong> ${escapeHtml(task.blocked_note)}</p>` : ''}${technicianOrderDetailsMarkup(task)}<div class="task-timer-row"><span>Tiempo registrado</span><strong data-task-timer="${escapeHtml(task.id)}">${formatTaskTime(task)}</strong></div><div class="technician-task-actions">${task.status === 'pending' ? `<button class="button button-primary" type="button" data-task-action="start" data-task-id="${escapeHtml(task.id)}" ${startDisabled}>▶ Iniciar tarea</button>` : ''}${['paused', 'blocked'].includes(task.status) ? `<button class="button button-primary" type="button" data-task-action="start" data-task-id="${escapeHtml(task.id)}" ${startDisabled}>▶ Reanudar</button>` : ''}${task.status === 'in_progress' ? `<button class="button button-quiet" type="button" data-task-action="pause" data-task-id="${escapeHtml(task.id)}">Ⅱ Pausar</button>` : ''}${task.status !== 'done' ? `<button class="button button-quiet" type="button" data-task-action="complete" data-task-id="${escapeHtml(task.id)}" ${startDisabled}>✓ Marcar terminada</button><details class="task-block-form"><summary>Informar un bloqueo</summary><textarea data-block-note rows="2" maxlength="500" placeholder="¿Qué impide continuar esta tarea?"></textarea><button class="button button-quiet" type="button" data-task-action="block" data-task-id="${escapeHtml(task.id)}">Enviar bloqueo</button></details>` : ''}</div></div></article>`;
    }).join('');
    return `<div class="tech-view screen-grid"><section class="tech-welcome"><div><p class="eyebrow">MI TRABAJO · PRISMA MOTOR</p><h2>Hola, ${escapeHtml(currentProfile?.display_name || 'equipo técnico')}</h2><p>Tus tareas asignadas, con tiempos y novedades registrados.</p></div><div class="tech-welcome-actions"><button class="button button-quiet" type="button" data-open-password-setup>Crear o cambiar contraseña</button><button class="button button-quiet" type="button" data-reload-technician>Actualizar</button></div></section><div class="stats-grid tech-task-stats"><article class="stat-card"><small>Mis tareas</small><strong>${state.technicianLoading ? '…' : tasks.length}</strong></article><article class="stat-card"><small>En curso</small><strong>${active}</strong></article><article class="stat-card"><small>Terminadas</small><strong>${done}</strong></article></div><section class="technician-task-list"><header><div><p class="eyebrow">COLA DE TRABAJO</p><h2>Tareas asignadas</h2></div></header>${state.technicianError ? `<div class="reception-load-error">${escapeHtml(state.technicianError)}</div>` : ''}${state.technicianLoading ? '<div class="empty-state">Cargando tus tareas…</div>' : taskCards || '<div class="empty-state">Todavía no tienes tareas asignadas. Cuando recepción te asigne un trabajo, aparecerá aquí.</div>'}</section></div>`;
  }

  async function loadTeamMembers() {
    if (!supabaseClient || currentProfile?.role !== 'owner') return;
    state.teamLoading = true;
    state.teamError = '';
    if (state.role === 'owner') render();
    try {
      const { data, error } = await supabaseClient.functions.invoke('create-team-member', { body: { action: 'list' } });
      if (data?.error) throw Object.assign(new Error(data.error), { code: data.code });
      if (error) throw error;
      state.teamMembers = data?.members || [];
    } catch (error) {
      state.teamError = error?.code === '42703'
        ? 'Aplica primero la migración de especialidades del equipo en Supabase.'
        : error?.message === 'Escribe el nombre completo del integrante.'
          ? 'Publica la versión actualizada de la función create-team-member para mostrar los correos del equipo.'
        : error instanceof Error && error.message && error.message !== 'Edge Function returned a non-2xx status code'
          ? `No se pudo cargar el equipo: ${error.message}`
          : 'No se pudo cargar el equipo técnico. Revisa la conexión y confirma que create-team-member esté publicada en Prisma Motor.';
      console.error('Prisma Motor: no se pudo cargar el equipo.', { code: error?.code, message: error?.message });
    } finally {
      state.teamLoading = false;
      if (state.role === 'owner') render();
    }
  }

  async function inviteTeamMember(form) {
    const feedback = document.getElementById('teamInviteFeedback');
    const button = form.querySelector('[type="submit"]');
    if (!supabaseClient || currentProfile?.role !== 'owner') return;
    const formData = new FormData(form);
    const displayName = String(formData.get('display_name') || '').trim();
    const email = String(formData.get('email') || '').trim().toLowerCase();
    const specialty = String(formData.get('specialty') || '');
    button.disabled = true;
    feedback.textContent = 'Enviando invitación y creando el perfil…';
    let data;
    let error;
    try {
      ({ data, error } = await supabaseClient.functions.invoke('create-team-member', {
        body: { display_name: displayName, email, specialty },
      }));
    } catch (caught) { error = caught; }
    button.disabled = false;
    if (error || data?.error) {
      console.error('Prisma Motor: no se pudo invitar al integrante.', error || data?.error);
      feedback.textContent = data?.error || 'No se pudo enviar la invitación. Confirma que la función de Supabase esté publicada y vuelve a intentarlo.';
      return;
    }
    state.teamNotice = `Invitación enviada a ${data.email}. Cuando acepte, podrá ingresar con el correo asignado.`;
    state.teamInviteOpen = false;
    form.reset();
    await loadTeamMembers();
  }

  async function setTeamMemberActive(profileId, active) {
    if (!supabaseClient || currentProfile?.role !== 'owner') return;
    const { error } = await supabaseClient.from('profiles').update({ active }).eq('id', profileId).eq('role', 'technician');
    if (error) {
      console.error('Prisma Motor: no se pudo cambiar el acceso del integrante.', { code: error.code, message: error.message });
      showToast('No se pudo actualizar el acceso de esta persona.');
      return;
    }
    state.teamNotice = active ? 'Acceso del integrante activado.' : 'Acceso del integrante desactivado.';
    await loadTeamMembers();
  }

  async function setTeamMemberSpecialty(profileId, specialty) {
    if (!supabaseClient || currentProfile?.role !== 'owner') return;
    if (!['mechanical', 'bodywork', 'paint'].includes(specialty)) {
      showToast('Selecciona una especialidad para este integrante.');
      return;
    }
    const { error } = await supabaseClient.from('profiles').update({ specialty }).eq('id', profileId).eq('role', 'technician');
    if (error) {
      console.error('Prisma Motor: no se pudo actualizar la especialidad.', { code: error.code, message: error.message });
      showToast('No se pudo guardar la especialidad. Revisa los permisos del perfil.');
      return;
    }
    state.teamNotice = 'Especialidad guardada. Ya puedes asignar a esta persona tareas de ese oficio.';
    await loadTeamMembers();
  }

  function renderTeamManagement() {
    const rows = state.teamMembers.map(member => `<tr>
      <td data-label="Nombre"><strong>${escapeHtml(member.display_name)}</strong></td>
      <td data-label="Correo"><span class="team-email-value">${escapeHtml(member.email || 'Correo no disponible')}</span></td>
      <td data-label="Especialidad"><div class="team-specialty-actions"><select aria-label="Especialidad de ${escapeHtml(member.display_name)}" data-team-specialty="${escapeHtml(member.id)}"><option value="">Seleccionar oficio</option><option value="mechanical" ${member.specialty === 'mechanical' ? 'selected' : ''}>Mecánica</option><option value="bodywork" ${member.specialty === 'bodywork' ? 'selected' : ''}>Latonería</option><option value="paint" ${member.specialty === 'paint' ? 'selected' : ''}>Pintura</option></select><button class="button button-quiet" type="button" data-team-save-specialty="${escapeHtml(member.id)}">Guardar oficio</button></div></td>
      <td data-label="Acceso"><span class="pill pill-${member.active ? 'green' : 'amber'}">${member.active ? 'Activo' : 'Inactivo'}</span></td>
      <td data-label="Opciones"><button class="button button-quiet" type="button" data-team-toggle="${escapeHtml(member.id)}" data-active="${member.active ? 'true' : 'false'}">${member.active ? 'Desactivar acceso' : 'Activar acceso'}</button></td>
    </tr>`).join('');
    const teamList = state.teamLoading
      ? '<div class="empty-state">Cargando equipo…</div>'
      : rows
        ? `<div class="team-table-scroll"><table class="team-member-table"><thead><tr><th scope="col">Nombre</th><th scope="col">Correo</th><th scope="col">Especialidad</th><th scope="col">Acceso</th><th scope="col">Opciones</th></tr></thead><tbody>${rows}</tbody></table></div>`
        : '<div class="empty-state">Todavía no has registrado personal técnico.</div>';
    return `<section class="panel team-management-panel"><header class="panel-heading"><div><p class="eyebrow">EQUIPO · ACCESOS</p><h2>Personal técnico</h2></div><button class="button button-primary" type="button" data-open-team-invite>${state.teamInviteOpen ? 'Cerrar formulario' : '＋ Invitar integrante'}</button></header><p class="team-management-intro">Registra al mecánico, latonero o pintor. Recibirá un correo para activar su acceso a Prisma Motor.</p>${state.teamNotice ? `<p class="team-feedback team-feedback-success" role="status">${escapeHtml(state.teamNotice)}</p>` : ''}${state.teamError ? `<p class="team-feedback" role="alert">${escapeHtml(state.teamError)}</p>` : ''}${state.teamInviteOpen ? `<form class="team-invite-form" data-team-invite-form><label>Nombre completo<input name="display_name" required minlength="2" maxlength="120" autocomplete="name" placeholder="Ej. Carlos Ramírez"></label><label>Correo electrónico<input name="email" type="email" required autocomplete="email" placeholder="tecnico@correo.com"></label><label>Especialidad principal<select name="specialty" required><option value="">Seleccionar oficio</option><option value="mechanical">Mecánica</option><option value="bodywork">Latonería</option><option value="paint">Pintura</option></select></label><button class="button button-primary" type="submit">Enviar invitación</button><p class="team-feedback" id="teamInviteFeedback" role="status" aria-live="polite"></p></form>` : ''}<div class="team-member-list">${teamList}</div></section>`;
  }

  const inventoryCategoryLabels = { parts: 'Repuesto', paint_materials: 'Pintura e insumo' };
  const inventoryUnits = { unidad: 'Unidad', juego: 'Juego', litro: 'Litro', galon: 'Galón', mililitro: 'Mililitro', kilogramo: 'Kilogramo', gramo: 'Gramo', metro: 'Metro', servicio: 'Servicio' };
  function inventoryProductFields(product = {}) {
    const suffix = escapeHtml(product.id || 'new');
    const fields = [
      ['Nombre', `<input id="product-name-${suffix}" name="name" aria-label="Nombre" required maxlength="160" value="${escapeHtml(product.name || '')}" placeholder="Ej. Pintura bicapa roja">`],
      ['Código / referencia', `<input id="product-sku-${suffix}" name="sku" aria-label="Código / referencia" maxlength="80" value="${escapeHtml(product.sku || '')}" placeholder="Opcional">`],
      ['Tipo', `<select id="product-category-${suffix}" name="category" aria-label="Tipo"><option value="parts" ${product.category === 'parts' ? 'selected' : ''}>Repuesto</option><option value="paint_materials" ${product.category === 'paint_materials' ? 'selected' : ''}>Pintura e insumo</option></select>`],
      ['Unidad', `<select id="product-unit-${suffix}" name="unit" aria-label="Unidad">${Object.entries(inventoryUnits).map(([value, label]) => `<option value="${value}" ${(product.unit || 'unidad') === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select>`],
      ['Costo promedio', `<input id="product-cost-${suffix}" name="cost_price" aria-label="Costo promedio" type="number" min="0" step="1" required value="${escapeHtml(product.cost_price ?? 0)}" ${product.id ? 'readonly title="El costo promedio se actualiza al registrar compras"' : ''}>`],
      ['Precio al cliente', `<input id="product-sale-${suffix}" name="sale_price" aria-label="Precio al cliente" type="number" min="0" step="1" required value="${escapeHtml(product.sale_price ?? 0)}">`],
      ['Alerta de mínimo', `<input id="product-minimum-${suffix}" name="minimum_stock" aria-label="Alerta de mínimo" type="number" min="0" step="0.01" value="${escapeHtml(product.minimum_stock ?? '')}" placeholder="Opcional">`],
    ];
    return `<div class="inventory-entry-table-wrap"><table class="inventory-entry-table inventory-entry-table-wide inventory-product-entry-table"><thead><tr>${fields.map(([label]) => `<th scope="col">${label}</th>`).join('')}</tr></thead><tbody><tr>${fields.map(([, control]) => `<td>${control}</td>`).join('')}</tr></tbody></table></div>`;
  }
  function renderInventoryMovementSection() {
    const productOptions = state.inventoryProducts.filter(product => product.active).map(product => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} · ${escapeHtml(inventoryUnits[product.unit] || product.unit)}</option>`).join('');
    const orderOptions = state.inventoryOrders.map(order => `<option value="${escapeHtml(order.id)}">PM-${escapeHtml(order.order_number)} · ${escapeHtml(workOrderLabels[order.status] || order.status)}</option>`).join('');
    const movementLabels = { purchase: 'Compra / entrada', consumption: 'Consumo en una orden', adjustment: 'Ajuste de existencias' };
    const movements = state.inventoryMovements.map(movement => {
      const product = movement.inventory_products || {};
      const order = movement.work_orders || {};
      const estimateItem = movement.estimate_items || {};
      const date = movement.created_at ? new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(movement.created_at)) : '';
      const quantity = Number(movement.quantity_change);
      const formattedQuantity = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(Math.abs(quantity));
      return `<tr><td data-label="Fecha">${escapeHtml(date || '—')}</td><td data-label="Producto"><strong>${escapeHtml(product.name || 'Producto')}</strong><small>${escapeHtml(inventoryUnits[product.unit] || product.unit || '')}</small></td><td data-label="Movimiento">${escapeHtml(movementLabels[movement.movement_type] || movement.movement_type)}</td><td data-label="Orden / concepto">${order.order_number ? `PM-${escapeHtml(order.order_number)}` : '—'}${estimateItem.description ? `<small>${escapeHtml(estimateItem.description)}</small>` : ''}</td><td data-label="Cantidad" class="inventory-movement-quantity ${quantity < 0 ? 'is-out' : 'is-in'}">${quantity > 0 ? '+' : '−'}${formattedQuantity}</td><td data-label="Costo unitario">${formatMoney(movement.unit_cost)}</td><td data-label="Costo total"><strong>${formatMoney(movement.total_cost)}</strong></td><td data-label="Nota">${escapeHtml(movement.note || '—')}</td></tr>`;
    }).join('');
    const estimateById = new Map(state.ownerData.estimates.map(estimate => [estimate.id, estimate]));
    const itemOptions = state.ownerData.estimateItems.filter(item => item.decision === 'approved').map(item => {
      const estimate = estimateById.get(item.estimate_id);
      return estimate ? `<option value="${escapeHtml(item.id)}" data-order-id="${escapeHtml(estimate.work_order_id)}">${escapeHtml(item.description)}</option>` : '';
    }).join('');
    const movementTable = state.inventoryMovementLoading
      ? '<div class="empty-state">Cargando movimientos…</div>'
      : movements
        ? `<div class="inventory-movement-table-wrap"><table class="inventory-movement-table"><thead><tr><th scope="col">Fecha</th><th scope="col">Producto</th><th scope="col">Movimiento</th><th scope="col">Orden / concepto</th><th scope="col">Cantidad</th><th scope="col">Costo unitario</th><th scope="col">Costo total</th><th scope="col">Nota</th></tr></thead><tbody>${movements}</tbody></table></div>`
        : '<div class="empty-state">Aún no hay movimientos registrados.</div>';
    return `<section class="panel inventory-movements-panel"><header class="panel-heading"><div><p class="eyebrow">TRAZABILIDAD</p><h2>Movimientos de inventario</h2></div><button class="button button-quiet" type="button" data-inventory-movements-reload>Actualizar</button></header><p class="team-management-intro">Las compras aumentan existencias; los consumos se asocian a una orden y, si es posible, al concepto aprobado que utiliza el producto. Esa relación mejora el cálculo del margen por servicio. Usa un ajuste positivo para registrar el saldo inicial.</p>${state.inventoryMovementError ? `<p class="team-feedback" role="alert">${escapeHtml(state.inventoryMovementError)}</p>` : ''}<form class="inventory-movement-form" data-inventory-movement-form><div class="inventory-entry-table-wrap"><table class="inventory-entry-table inventory-entry-table-wide inventory-movement-entry-table"><thead><tr><th scope="col">Movimiento</th><th scope="col">Producto</th><th scope="col">Cantidad</th><th scope="col" class="inventory-movement-cost-heading">Costo unitario de compra</th><th scope="col" class="inventory-movement-order-heading" hidden>Orden de trabajo</th><th scope="col" class="inventory-movement-item-heading" hidden>Concepto aprobado</th><th scope="col">Nota</th></tr></thead><tbody><tr><td><select id="movement-type" name="movement_type" aria-label="Movimiento" data-inventory-movement-type><option value="purchase">Compra / entrada</option><option value="consumption">Consumo en una orden</option><option value="adjustment">Ajuste de existencias</option></select></td><td><select id="movement-product" name="product_id" aria-label="Producto" required><option value="">Seleccionar producto</option>${productOptions}</select></td><td><input id="movement-quantity" name="quantity" aria-label="Cantidad" type="number" step="0.01" required placeholder="Cantidad positiva"></td><td class="inventory-movement-cost"><input id="movement-unit-cost" name="unit_cost" aria-label="Costo unitario de compra" type="number" min="0" step="1" value="0" required></td><td class="inventory-movement-order" hidden><select id="movement-work-order" name="work_order_id" aria-label="Orden de trabajo" data-inventory-work-order><option value="">Seleccionar orden</option>${orderOptions}</select></td><td class="inventory-movement-item" hidden><select id="movement-estimate-item" name="estimate_item_id" aria-label="Concepto aprobado" data-inventory-estimate-item><option value="">Sin asignar a un concepto</option>${itemOptions}</select></td><td><input id="movement-note" name="note" aria-label="Nota" maxlength="300" placeholder="Proveedor, motivo o detalle opcional"></td></tr></tbody></table></div><button class="button button-primary" type="submit">Registrar movimiento</button><p class="team-feedback" data-inventory-movement-feedback role="status" aria-live="polite"></p></form>${movementTable}</section>`;
  }

  function renderInventoryPage() {
    const stockRows = state.inventoryProducts.map(product => {
      const hasStock = product.stock_quantity != null;
      const quantity = Number(product.stock_quantity);
      const minimum = product.minimum_stock == null ? null : Number(product.minimum_stock);
      const averageCost = product.cost_price == null ? null : Number(product.cost_price);
      const salePrice = product.sale_price == null ? null : Number(product.sale_price);
      const unitMargin = averageCost == null || salePrice == null ? null : salePrice - averageCost;
      const marginPercent = unitMargin == null || salePrice <= 0 ? null : (unitMargin / salePrice) * 100;
      const stockState = !hasStock ? ['Sin saldo inicial', 'neutral'] : quantity <= 0 ? ['Agotado', 'red'] : minimum != null && quantity <= minimum ? ['Bajo mínimo', 'amber'] : ['Disponible', 'green'];
      const formattedQuantity = hasStock ? new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(quantity) : '—';
      const percentLabel = marginPercent == null ? '—' : `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 1 }).format(marginPercent)}% sobre venta`;
      const productForm = `<details class="inventory-product-editor"><summary>Editar</summary><form class="inventory-product-edit-form" data-inventory-product-form data-product-id="${escapeHtml(product.id)}"><div class="inventory-product-fields">${inventoryProductFields(product)}</div><button class="button button-quiet" type="submit">Guardar cambios</button></form></details><button class="button button-quiet" type="button" data-inventory-toggle="${escapeHtml(product.id)}" data-active="${product.active ? 'true' : 'false'}">${product.active ? 'Desactivar' : 'Activar'}</button>`;
      return `<tr><td data-label="Producto"><strong>${escapeHtml(product.name)}</strong>${product.sku ? `<small>${escapeHtml(product.sku)}</small>` : ''}</td><td data-label="Tipo">${escapeHtml(inventoryCategoryLabels[product.category] || product.category)}</td><td data-label="Existencia"><strong>${formattedQuantity}</strong> ${escapeHtml(inventoryUnits[product.unit] || product.unit)}</td><td data-label="Mínimo">${minimum == null ? 'No definido' : `${new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 }).format(minimum)} ${escapeHtml(inventoryUnits[product.unit] || product.unit)}`}</td><td data-label="Compra prom.">${averageCost == null ? '—' : formatMoney(averageCost)}</td><td data-label="Precio venta">${salePrice == null ? '—' : formatMoney(salePrice)}</td><td data-label="Margen bruto unitario"><strong class="${unitMargin != null && unitMargin < 0 ? 'stock-margin-negative' : 'stock-margin-positive'}">${unitMargin == null ? '—' : formatMoney(unitMargin)}</strong><small>${percentLabel}</small></td><td data-label="Estado"><span class="stock-state stock-state-${stockState[1]}">${stockState[0]}</span></td><td data-label="Catálogo"><span class="pill pill-${product.active ? 'green' : 'amber'}">${product.active ? 'Activo' : 'Inactivo'}</span></td><td data-label="Acciones"><div class="inventory-product-actions">${productForm}</div></td></tr>`;
    }).join('');
    const stockSummary = state.inventoryLoading
      ? '<div class="empty-state">Cargando existencias…</div>'
      : stockRows
        ? `<div class="inventory-stock-table-wrap"><table class="inventory-stock-table"><thead><tr><th scope="col">Producto</th><th scope="col">Tipo</th><th scope="col">Existencia actual</th><th scope="col">Mínimo</th><th scope="col">Compra prom. / base</th><th scope="col">Precio venta</th><th scope="col">Margen bruto unitario</th><th scope="col">Estado</th><th scope="col">Catálogo</th><th scope="col">Acciones</th></tr></thead><tbody>${stockRows}</tbody></table></div>`
        : '<div class="empty-state">Agrega productos al catálogo para consultar sus existencias aquí.</div>';
    return `<div class="screen-grid"><section class="panel inventory-panel"><header class="panel-heading"><div><p class="eyebrow">CATÁLOGO · BODEGA</p><h2>Repuestos e insumos</h2></div><button class="button button-quiet" type="button" data-inventory-reload>Actualizar</button></header><p class="team-management-intro">Registra productos, costo promedio y precio al cliente. Los repuestos manuales de una cotización se crean con costo estimado y sin existencias registradas; al registrar la compra se suma el stock y se actualiza el costo promedio.</p>${state.inventoryNotice ? `<p class="team-feedback team-feedback-success" role="status">${escapeHtml(state.inventoryNotice)}</p>` : ''}${state.inventoryError ? `<p class="team-feedback" role="alert">${escapeHtml(state.inventoryError)}</p>` : ''}<section class="inventory-stock-summary"><header><div><p class="eyebrow">SALDO ACTUAL</p><h3>Existencias por producto</h3></div><span>${state.inventoryProducts.length} productos</span></header><p class="inventory-stock-note">El costo de compra es promedio ponderado si hay compras registradas; antes de ellas puede ser el costo estimado o base del catálogo. El margen bruto unitario resta ese costo al precio de venta; el porcentaje se calcula sobre el precio de venta y no incluye otros gastos del taller.</p>${stockSummary}</section><form class="inventory-create-form" data-inventory-product-form><h3>Agregar al catálogo</h3><div class="inventory-product-fields">${inventoryProductFields()}</div><button class="button button-primary" type="submit">Agregar producto</button></form></section>${renderInventoryLaborRatesSection()}${renderInventoryMovementSection()}</div>`;
  }

  function renderInventoryLaborRatesSection() {
    const ratesByType = new Map(state.ownerData.rates.map(rate => [rate.work_type, rate]));
    const dateFormat = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' });
    const rows = Object.entries(workTypeLabels).map(([workType, label]) => {
      const rate = ratesByType.get(workType);
      const hourlyCost = Number(rate?.hourly_cost) || 0;
      const updatedAt = rate?.updated_at ? dateFormat.format(new Date(rate.updated_at)) : 'Sin registro';
      return `<tr><td data-label="Oficio">${escapeHtml(label)}</td><td data-label="Costo actual / hora"><strong>${formatMoney(hourlyCost)}</strong></td><td data-label="Última actualización">${escapeHtml(updatedAt)}</td><td data-label="Nuevo costo / hora"><label class="inventory-rate-input"><span class="sr-only">Nuevo costo por hora para ${escapeHtml(label)}</span><input name="${escapeHtml(workType)}" type="number" min="0" step="1000" value="${escapeHtml(hourlyCost)}" required></label></td></tr>`;
    }).join('');
    const rateContent = state.ownerData.loading
      ? '<div class="empty-state">Cargando costos por oficio…</div>'
      : state.ownerData.ratesError
        ? `<p class="team-feedback" role="alert">${escapeHtml(state.ownerData.ratesError)}</p>`
        : `<form class="inventory-labor-rate-form" data-owner-rate-form><div class="inventory-rate-table-wrap"><table class="inventory-rate-table"><thead><tr><th scope="col">Oficio</th><th scope="col">Costo actual / hora</th><th scope="col">Actualizado</th><th scope="col">Registrar costo / hora</th></tr></thead><tbody>${rows}</tbody></table></div><button class="button button-primary" type="submit">Guardar costos por hora</button><p class="team-feedback" data-owner-rate-feedback role="status" aria-live="polite"></p></form>`;
    return `<section class="panel inventory-labor-rates-panel"><header class="panel-heading"><div><p class="eyebrow">COSTOS DEL TALLER</p><h2>Mano de obra por oficio</h2></div></header><p class="team-management-intro">Consulta y registra aquí el costo interno por hora. Finanzas usa estas tarifas para valorar las horas registradas en las tareas.</p>${rateContent}</section>`;
  }
  async function loadInventoryProducts() {
    if (!supabaseClient || !currentProfile || !['owner', 'advisor'].includes(currentProfile.role)) return;
    state.inventoryLoading = true;
    state.inventoryError = '';
    try {
      const { data, error } = await supabaseClient.from('inventory_products').select('*').order('name');
      if (error) throw error;
      state.inventoryProducts = data || [];
    } catch (error) {
      state.inventoryError = ['42P01', '42703', 'PGRST205'].includes(error?.code)
        ? 'Aplica primero la migración de catálogo de inventario en Supabase.'
        : 'No se pudo cargar el catálogo. Revisa la conexión y los permisos.';
      console.error('Prisma Motor: no se pudo cargar el catálogo.', { code: error?.code, message: error?.message });
    } finally {
      state.inventoryLoading = false;
      if (state.role === 'owner' && state.ownerSection === 'inventory') render();
    }
  }

  async function loadInventoryMovements() {
    if (!supabaseClient || currentProfile?.role !== 'owner') return;
    state.inventoryMovementLoading = true;
    state.inventoryMovementError = '';
    try {
      const [movementResult, orderResult] = await Promise.all([
        supabaseClient.from('inventory_movements').select('*, inventory_products(name, unit), work_orders(order_number), estimate_items(description)').order('created_at', { ascending: false }).limit(100),
        supabaseClient.from('work_orders').select('id, order_number, status').neq('status', 'delivered').order('received_at', { ascending: false }).limit(100),
      ]);
      if (movementResult.error) throw movementResult.error;
      if (orderResult.error) throw orderResult.error;
      state.inventoryMovements = movementResult.data || [];
      state.inventoryOrders = orderResult.data || [];
    } catch (error) {
      state.inventoryMovementError = ['42P01', 'PGRST205'].includes(error?.code)
        ? 'Aplica la migración de movimientos de inventario en Supabase para habilitar compras y consumos.'
        : 'No se pudo cargar el historial de inventario. Revisa la conexión y los permisos.';
      console.error('Prisma Motor: no se pudo cargar el historial de inventario.', { code: error?.code, message: error?.message });
    } finally {
      state.inventoryMovementLoading = false;
      if (state.role === 'owner' && state.ownerSection === 'inventory') render();
    }
  }

  async function saveInventoryMovement(form) {
    const feedback = form.querySelector('[data-inventory-movement-feedback]');
    const button = form.querySelector('[type="submit"]');
    const formData = new FormData(form);
    const movementType = String(formData.get('movement_type') || '');
    const quantity = Number(formData.get('quantity'));
    if (!Number.isFinite(quantity) || quantity === 0 || (movementType !== 'adjustment' && quantity < 0)) {
      feedback.textContent = movementType === 'adjustment' ? 'El ajuste debe ser distinto de cero; usa signo negativo para descontar.' : 'Escribe una cantidad positiva.';
      return;
    }
    button.disabled = true;
    feedback.textContent = 'Guardando movimiento…';
    const { data, error } = await supabaseClient.rpc('record_inventory_movement', {
      p_product_id: String(formData.get('product_id') || ''),
      p_movement_type: movementType,
      p_quantity: quantity,
      p_unit_cost: movementType === 'purchase' ? Number(formData.get('unit_cost')) : null,
      p_work_order_id: movementType === 'consumption' ? String(formData.get('work_order_id') || '') || null : null,
      p_estimate_item_id: movementType === 'consumption' ? String(formData.get('estimate_item_id') || '') || null : null,
      p_note: String(formData.get('note') || '').trim() || null,
    });
    button.disabled = false;
    if (error) {
      console.error('Prisma Motor: no se pudo registrar el movimiento de inventario.', { code: error.code, message: error.message });
      feedback.textContent = error.message || 'No se pudo registrar el movimiento. Revisa el saldo y los datos ingresados.';
      return;
    }
    state.inventoryNotice = `Movimiento registrado. Existencias actuales: ${data.stock_quantity}.`;
    state.inventoryError = '';
    await Promise.all([loadInventoryProducts(), loadInventoryMovements(), loadOwnerDashboard()]);
    render();
  }

  async function saveInventoryProduct(form) {
    if (!supabaseClient || currentProfile?.role !== 'owner') return;
    const formData = new FormData(form);
    const numeric = name => String(formData.get(name) ?? '').trim() === '' ? null : Number(formData.get(name));
    const payload = {
      name: String(formData.get('name') || '').trim(),
      sku: String(formData.get('sku') || '').trim() || null,
      category: String(formData.get('category') || 'parts'),
      unit: String(formData.get('unit') || 'unidad'),
      sale_price: numeric('sale_price'),
      minimum_stock: numeric('minimum_stock'),
    };
    const productId = form.dataset.productId;
    if (!productId) payload.cost_price = numeric('cost_price');
    const result = productId
      ? await supabaseClient.from('inventory_products').update(payload).eq('id', productId)
      : await supabaseClient.from('inventory_products').insert({ ...payload, created_by: currentSession.user.id });
    if (result.error) {
      console.error('Prisma Motor: no se pudo guardar el producto.', { code: result.error.code, message: result.error.message });
      state.inventoryError = 'No se pudo guardar. Revisa el nombre, el código, los precios y el mínimo de existencias.';
      render();
      return;
    }
    state.inventoryNotice = productId ? 'Producto actualizado.' : 'Producto agregado al catálogo.';
    state.inventoryError = '';
    await loadInventoryProducts();
    render();
  }

  async function setInventoryProductActive(productId, active) {
    if (!supabaseClient || currentProfile?.role !== 'owner') return;
    const { error } = await supabaseClient.from('inventory_products').update({ active }).eq('id', productId);
    if (error) { showToast('No se pudo actualizar el producto.'); return; }
    state.inventoryNotice = active ? 'Producto activado para cotizaciones.' : 'Producto desactivado; se conserva en cotizaciones anteriores.';
    await loadInventoryProducts();
    render();
  }

  function ownerView() {
    if (state.ownerSection === 'inventory') return `<div class="screen-grid owner-compact-layout">${ownerSubnav()}${renderInventoryPage()}</div>`;
    if (state.ownerSection === 'finance') return `<div class="screen-grid owner-compact-layout">${ownerSubnav()}${renderOwnerFinance()}</div>`;
    const data = state.ownerData;
    const counts = {
      active: data.orders.filter(order => !['delivered'].includes(order.status)).length,
      approval: data.orders.filter(order => order.status === 'awaiting_approval').length,
      delivery: data.orders.filter(order => order.status === 'ready_for_delivery').length,
    };
    const orderStatus = { received: 'Recibido', diagnosis: 'En diagnóstico', awaiting_approval: 'Esperando aprobación', awaiting_parts: 'Esperando repuestos', in_repair: 'En reparación', quality_control: 'Control de calidad', ready_for_delivery: 'Listo para entrega', delivered: 'Entregado' };
    const currentOrders = data.orders.filter(order => order.status !== 'delivered').slice(0, 8);
    const orderRows = currentOrders.map(order => {
      const vehicle = order.vehicles || {}; const customer = order.customers || {};
      const deleteAction = currentProfile?.role === 'owner'
        ? `<button class="button button-delete-order" type="button" data-owner-delete-order data-order-id="${escapeHtml(order.id)}" data-order-number="${escapeHtml(order.order_number)}" data-plate="${escapeHtml(vehicle.plate || 'Sin placa')}" aria-label="Eliminar vehículo y orden PM-${escapeHtml(order.order_number)}">Eliminar</button>`
        : '';
      return `<article class="owner-live-order"><div><strong>PM-${escapeHtml(order.order_number)} · ${escapeHtml(vehicle.plate || 'Sin placa')}</strong><small>${escapeHtml([vehicle.make, vehicle.model, vehicle.model_year].filter(Boolean).join(' '))} · ${escapeHtml(customer.full_name || 'Cliente')}</small></div><div class="owner-live-order-actions"><span class="pill pill-${order.status === 'ready_for_delivery' ? 'green' : order.status === 'awaiting_approval' || order.status === 'awaiting_parts' ? 'amber' : 'blue'}">${escapeHtml(orderStatus[order.status] || order.status)}</span>${deleteAction}</div></article>`;
    }).join('');
    return `<div class="screen-grid owner-compact-layout">
      ${ownerSubnav()}
      <div class="stats-grid owner-kpis">
        <article class="stat-card"><span class="stat-icon">▣</span><div><small>Órdenes abiertas</small><strong>${data.loading ? '…' : counts.active}</strong></div></article>
        <article class="stat-card"><span class="stat-icon cyan">◷</span><div><small>Esperando aprobación</small><strong>${data.loading ? '…' : counts.approval}</strong></div></article>
        <article class="stat-card"><span class="stat-icon orange">✓</span><div><small>Listos para entrega</small><strong>${data.loading ? '…' : counts.delivery}</strong></div></article>
      </div>
      <section class="panel"><header class="panel-heading"><div><p class="eyebrow">OPERACIÓN EN VIVO</p><h2>Vehículos en el taller</h2></div><button class="button button-quiet" type="button" data-owner-reload>Actualizar</button></header>${data.error ? `<p class="team-feedback" role="alert">${escapeHtml(data.error)}</p>` : ''}<div class="owner-live-orders">${data.loading ? '<div class="empty-state">Cargando órdenes desde Supabase…</div>' : orderRows || '<div class="empty-state">No hay órdenes abiertas en este momento.</div>'}</div></section>
      ${renderTeamManagement()}
    </div>`;
  }

  function ownerSubnav() {
    const section = state.ownerSection;
    return `<nav class="owner-subnav" aria-label="Secciones de administración"><button type="button" class="${section === 'dashboard' ? 'active' : ''}" data-owner-section="dashboard">Torre de control</button><button type="button" class="${section === 'finance' ? 'active' : ''}" data-owner-section="finance">Finanzas</button><button type="button" class="${section === 'inventory' ? 'active' : ''}" data-owner-section="inventory">Repuestos e insumos</button></nav>`;
  }

  const paymentMethodLabels = { cash: 'Efectivo', transfer: 'Transferencia', card: 'Tarjeta', other: 'Otro' };
  function ownerFinancialTotals() {
    const data = state.ownerData;
    const now = new Date(); const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const collected = data.payments.reduce((sum, payment) => sum + (new Date(payment.paid_at) >= monthStart ? Number(payment.amount) : 0), 0);
    const approvedItems = data.estimateItems.filter(item => item.decision === 'approved');
    const approvedRevenue = approvedItems.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_price), 0);
    const estimateOrder = new Map(data.estimates.map(estimate => [estimate.id, estimate.work_order_id]));
    const estimateDate = new Map(data.estimates.map(estimate => [estimate.id, estimate.created_at]));
    const approvedOrders = new Set(approvedItems.map(item => estimateOrder.get(item.estimate_id)).filter(Boolean));
    const revenueByOrder = new Map();
    approvedItems.forEach(item => {
      const orderId = estimateOrder.get(item.estimate_id);
      if (orderId) revenueByOrder.set(orderId, (revenueByOrder.get(orderId) || 0) + Number(item.quantity) * Number(item.unit_price));
    });
    const paidByOrder = new Map();
    data.payments.forEach(payment => paidByOrder.set(payment.work_order_id, (paidByOrder.get(payment.work_order_id) || 0) + Number(payment.amount)));
    const outstanding = [...revenueByOrder].reduce((sum, [orderId, revenue]) => sum + Math.max(0, revenue - (paidByOrder.get(orderId) || 0)), 0);
    const today = new Date();
    const months = Array.from({ length: 6 }, (_, index) => new Date(today.getFullYear(), today.getMonth() - 5 + index, 1));
    const monthKey = date => { const parsed = date ? new Date(date) : null; return parsed && !Number.isNaN(parsed.getTime()) ? `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}` : null; };
    const monthSeries = months.map(date => ({ key: monthKey(date), label: new Intl.DateTimeFormat('es-CO', { month: 'short' }).format(date), approved: 0, collected: 0, vehicles: 0, grossMargin: 0 }));
    const seriesByMonth = new Map(monthSeries.map(row => [row.key, row]));
    const orderApprovalMonth = new Map();
    approvedItems.forEach(item => {
      const approvalDate = item.decided_at || estimateDate.get(item.estimate_id);
      const row = seriesByMonth.get(monthKey(approvalDate));
      if (row) row.approved += Number(item.quantity) * Number(item.unit_price);
      const orderId = estimateOrder.get(item.estimate_id);
      if (orderId && approvalDate && (!orderApprovalMonth.has(orderId) || new Date(approvalDate) > new Date(orderApprovalMonth.get(orderId)))) orderApprovalMonth.set(orderId, approvalDate);
    });
    data.payments.forEach(payment => { const row = seriesByMonth.get(monthKey(payment.paid_at)); if (row) row.collected += Number(payment.amount); });
    data.orders.forEach(order => { const row = seriesByMonth.get(monthKey(order.received_at)); if (row) row.vehicles += 1; });
    const costByItem = new Map(); const laborByItem = new Map(); const orderCosts = new Map();
    data.movements.forEach(movement => {
      if (movement.movement_type !== 'consumption' || !approvedOrders.has(movement.work_order_id)) return;
      const cost = Number(movement.total_cost) || 0;
      orderCosts.set(movement.work_order_id, (orderCosts.get(movement.work_order_id) || 0) + cost);
      if (movement.estimate_item_id) costByItem.set(movement.estimate_item_id, (costByItem.get(movement.estimate_item_id) || 0) + cost);
    });
    const rateByType = Object.fromEntries(data.rates.map(rate => [rate.work_type, Number(rate.hourly_cost) || 0]));
    data.tasks.forEach(task => {
      if (!approvedOrders.has(task.work_order_id)) return;
      const runningSeconds = task.active_started_at ? Math.max(0, Math.floor((Date.now() - new Date(task.active_started_at).getTime()) / 1000)) : 0;
      const labor = ((Number(task.total_seconds) || 0) + runningSeconds) / 3600 * (rateByType[task.work_type] || 0);
      orderCosts.set(task.work_order_id, (orderCosts.get(task.work_order_id) || 0) + labor);
      if (task.estimate_item_id) laborByItem.set(task.estimate_item_id, (laborByItem.get(task.estimate_item_id) || 0) + labor);
    });
    const grossMargin = approvedRevenue - [...orderCosts.values()].reduce((sum, cost) => sum + cost, 0);
    revenueByOrder.forEach((revenue, orderId) => {
      const row = seriesByMonth.get(monthKey(orderApprovalMonth.get(orderId)));
      if (row) row.grossMargin += revenue - (orderCosts.get(orderId) || 0);
    });
    const serviceMap = new Map();
    approvedItems.filter(item => item.category === 'labor').forEach(item => {
      const revenue = Number(item.quantity) * Number(item.unit_price);
      const materialCost = costByItem.get(item.id) || 0; const laborCost = laborByItem.get(item.id) || 0;
      const cost = materialCost + laborCost;
      const key = item.description.trim().toLocaleLowerCase('es-CO');
      const service = serviceMap.get(key) || { name: item.description.trim(), orders: 0, revenue: 0, cost: 0, trackedOrders: 0 };
      service.orders += 1; service.revenue += revenue; service.cost += cost;
      if (laborCost > 0) service.trackedOrders += 1;
      serviceMap.set(key, service);
    });
    const services = [...serviceMap.values()].map(service => ({
      ...service,
      margin: service.revenue - service.cost,
      marginPercent: service.revenue ? (service.revenue - service.cost) / service.revenue * 100 : 0,
      costTracked: service.orders > 0 && service.trackedOrders === service.orders,
    })).sort((a, b) => b.margin - a.margin);
    const orderCostsComplete = new Map([...revenueByOrder.keys()].map(id => [id, true]));
    approvedItems.filter(item => item.category === 'labor').forEach(item => {
      const orderId = estimateOrder.get(item.estimate_id);
      if (orderId && !(laborByItem.get(item.id) > 0)) orderCostsComplete.set(orderId, false);
    });
    data.tasks.forEach(task => {
      if (!revenueByOrder.has(task.work_order_id)) return;
      const seconds = Number(task.total_seconds) || 0;
      if (task.status !== 'done' || seconds <= 0 || !(rateByType[task.work_type] > 0)) orderCostsComplete.set(task.work_order_id, false);
    });
    const vehicleMargins = data.orders.filter(order => revenueByOrder.has(order.id)).map(order => {
      const revenue = revenueByOrder.get(order.id) || 0;
      const cost = orderCosts.get(order.id) || 0;
      const vehicle = order.vehicles || {};
      return { orderId: order.id, orderNumber: order.order_number, status: order.status, receivedAt: order.received_at,
        plate: vehicle.plate || 'Sin placa', vehicle: [vehicle.make, vehicle.model, vehicle.model_year].filter(Boolean).join(' '),
        revenue, cost, margin: revenue - cost, marginPercent: revenue ? (revenue - cost) / revenue * 100 : 0,
        costTracked: orderCostsComplete.get(order.id) !== false };
    }).sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
    const brandMap = new Map();
    data.orders.forEach(order => {
      const revenue = revenueByOrder.get(order.id);
      if (!revenue) return;
      const brand = order.vehicles?.make?.trim() || 'Marca no registrada';
      const current = brandMap.get(brand) || { name: brand, orders: 0, revenue: 0 };
      current.orders += 1; current.revenue += revenue; brandMap.set(brand, current);
    });
    const brands = [...brandMap.values()].sort((a, b) => b.orders - a.orders || b.revenue - a.revenue);
    const averageTicket = revenueByOrder.size ? approvedRevenue / revenueByOrder.size : 0;
    return { collected, approvedRevenue, grossMargin, outstanding, averageTicket, services, brands, vehicleMargins, monthSeries };
  }

  function compactChartValue(value, isCurrency) {
    const amount = Number(value) || 0;
    const compact = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.abs(amount));
    return isCurrency ? `${amount < 0 ? '−' : ''}$${compact}` : `${compact} autos`;
  }

  function renderOwnerPeriodChart(title, description, points, valueKey, isCurrency = true) {
    const max = Math.max(1, ...points.map(point => Math.abs(Number(point[valueKey]) || 0)));
    const bars = points.map(point => {
      const value = Number(point[valueKey]) || 0;
      const height = Math.max(value !== 0 ? 5 : 0, Math.abs(value) / max * 100);
      const label = compactChartValue(value, isCurrency);
      return `<div class="owner-chart-column" title="${escapeHtml(point.label)} · ${escapeHtml(isCurrency ? formatMoney(value) : `${value} vehículos`)}"><span class="owner-chart-value ${value < 0 ? 'is-negative' : ''}">${escapeHtml(label)}</span><div class="owner-chart-track"><i class="${value < 0 ? 'is-negative' : ''}" style="height:${height}%"></i></div><small>${escapeHtml(point.label)}</small></div>`;
    }).join('');
    return `<section class="panel owner-period-chart"><header><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div></header><div class="owner-time-chart" role="img" aria-label="${escapeHtml(title)} durante los últimos seis meses">${bars}</div></section>`;
  }

  function renderOwnerFinance() {
    const data = state.ownerData; const totals = ownerFinancialTotals();
    const orders = data.orders.map(order => {
      const vehicle = order.vehicles || {};
      return `<option value="${escapeHtml(order.id)}">PM-${escapeHtml(order.order_number)} · ${escapeHtml(vehicle.plate || 'Vehículo')}</option>`;
    }).join('');
    const serviceRows = totals.services.slice(0, 10).map(service => `<article class="owner-live-order"><div><strong>${escapeHtml(service.name)}</strong><small>${service.orders} ${service.orders === 1 ? 'servicio aprobado' : 'servicios aprobados'} · ingresos ${formatMoney(service.revenue)} · costos registrados ${formatMoney(service.cost)}</small></div><span><strong>${service.costTracked ? formatMoney(service.margin) : '—'}</strong><small>${service.costTracked ? `${service.marginPercent.toFixed(1)}% margen bruto` : 'completa tiempos y costos'}</small></span></article>`).join('');
    const brandRows = totals.brands.slice(0, 8).map(brand => `<article class="owner-live-order"><div><strong>${escapeHtml(brand.name)}</strong><small>${brand.orders} ${brand.orders === 1 ? 'orden aprobada' : 'órdenes aprobadas'}</small></div><strong>${formatMoney(brand.revenue)}</strong></article>`).join('');
    const vehicleRows = totals.vehicleMargins.slice(0, 15).map(vehicle => `<article class="owner-vehicle-margin"><div><strong>PM-${escapeHtml(vehicle.orderNumber)} · ${escapeHtml(vehicle.plate)}</strong><small>${escapeHtml(vehicle.vehicle || 'Vehículo')} · ingresos ${formatMoney(vehicle.revenue)} · costos ${formatMoney(vehicle.cost)}</small></div><div class="owner-vehicle-margin-result"><strong>${formatMoney(vehicle.margin)}</strong><small>${vehicle.marginPercent.toFixed(1)}%${vehicle.costTracked ? '' : ' · parcial'}</small></div></article>`).join('');
    const timeCharts = `<div class="owner-period-charts">${renderOwnerPeriodChart('Ingresos aprobados', 'Por mes · últimos seis meses', totals.monthSeries, 'approved')}${renderOwnerPeriodChart('Pagos recibidos', 'Recaudo por mes · últimos seis meses', totals.monthSeries, 'collected')}${renderOwnerPeriodChart('Vehículos recibidos', 'Órdenes nuevas por mes · últimos seis meses', totals.monthSeries, 'vehicles', false)}${renderOwnerPeriodChart('Margen bruto mensual', 'Por mes de aprobación · últimos seis meses', totals.monthSeries, 'grossMargin')}</div>`;
    const payments = data.payments.slice(0, 12).map(payment => {
      const order = payment.work_orders || {}; const date = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(payment.paid_at));
      return `<article class="owner-live-order"><div><strong>${escapeHtml(order.order_number ? `PM-${order.order_number}` : 'Orden')} · ${escapeHtml(paymentMethodLabels[payment.payment_method] || payment.payment_method)}</strong><small>${escapeHtml(date)}${payment.reference ? ` · ${escapeHtml(payment.reference)}` : ''}</small></div><strong>${formatMoney(payment.amount)}</strong></article>`;
    }).join('');
    const marginTone = totals.grossMargin > 0 ? 'is-positive' : totals.grossMargin < 0 ? 'is-negative' : 'is-neutral';
    return `<section class="panel owner-finance-panel"><header class="panel-heading"><div><p class="eyebrow">DATOS REGISTRADOS</p><h2>Resumen financiero y gestión</h2></div><button class="button button-quiet" type="button" data-owner-reload>Actualizar</button></header><p class="team-management-intro">El margen por servicio resta sus costos directos registrados de los ingresos aprobados. Si faltan tarifas u horas, aparecerá incompleto. El margen global no incluye arriendo, servicios, impuestos ni otros gastos generales.</p>${data.error ? `<p class="team-feedback" role="alert">${escapeHtml(data.error)}</p>` : ''}<div class="stats-grid owner-kpis"><article class="stat-card"><span class="stat-icon">＄</span><div><small>Recaudado este mes</small><strong>${formatMoney(totals.collected)}</strong></div></article><article class="stat-card"><span class="stat-icon cyan">▤</span><div><small>Ingresos aprobados</small><strong>${formatMoney(totals.approvedRevenue)}</strong></div></article><article class="stat-card owner-margin-summary ${marginTone}"><span class="stat-icon">↗</span><div><small>Margen bruto registrado</small><strong>${formatMoney(totals.grossMargin)}</strong></div></article><article class="stat-card"><span class="stat-icon">◷</span><div><small>Saldo estimado por cobrar</small><strong>${formatMoney(totals.outstanding)}</strong></div></article><article class="stat-card"><span class="stat-icon cyan">▣</span><div><small>Ticket promedio aprobado</small><strong>${formatMoney(totals.averageTicket)}</strong></div></article></div>${timeCharts}<div class="two-col"><section class="panel owner-finance-inner"><h3>Registrar pago recibido</h3><form class="owner-payment-form" data-owner-payment-form><label>Orden<select name="work_order_id" required><option value="">Seleccionar orden</option>${orders}</select></label><label>Valor recibido<input name="amount" type="number" min="1" step="1" required placeholder="COP"></label><label>Medio<select name="payment_method"><option value="transfer">Transferencia</option><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="other">Otro</option></select></label><label>Fecha<input name="paid_at" type="date" value="${new Date().toISOString().slice(0, 10)}" required></label><label class="span-two">Referencia / nota<input name="reference" maxlength="200" placeholder="Opcional"></label><button class="button button-primary span-two" type="submit">Guardar pago</button><p class="team-feedback span-two" data-owner-payment-feedback role="status"></p></form><h3>Pagos recientes</h3><div class="owner-live-orders">${payments || '<div class="empty-state">Todavía no hay pagos registrados.</div>'}</div></section><section class="panel owner-finance-inner"><h3>Costos por hora del equipo</h3><p>El registro y la consulta de tarifas están en Repuestos e insumos. Finanzas usa esos valores para calcular el costo de mano de obra y el margen bruto.</p><button class="button button-quiet" type="button" data-owner-section="inventory">Administrar costos por hora</button></section></div><div class="two-col"><section class="panel owner-finance-inner"><h3>Margen por servicio</h3><p>Se agrupan servicios aprobados con el mismo nombre. El margen se muestra cuando cada servicio tiene costos de mano de obra registrados.</p><div class="owner-live-orders">${serviceRows || '<div class="empty-state">Todavía no hay servicios de mano de obra aprobados.</div>'}</div></section><section class="panel owner-finance-inner"><h3>Marcas más atendidas</h3><p>Vehículos con cotización aprobada, ordenados por cantidad de órdenes.</p><div class="owner-live-orders">${brandRows || '<div class="empty-state">Todavía no hay órdenes con conceptos aprobados.</div>'}</div></section></div><section class="panel owner-finance-inner"><h3>Margen bruto por vehículo recibido</h3><p>Una fila por orden del vehículo. El margen resta los costos de mano de obra e inventario ya registrados; las filas marcadas parcial aún tienen tareas o costos por registrar.</p><div class="owner-vehicle-margin-list">${vehicleRows || '<div class="empty-state">Aún no hay órdenes con conceptos aprobados para calcular el margen por vehículo.</div>'}</div></section></section>`;
  }

  async function collectOrderStoragePaths(folder, paths = []) {
    let offset = 0;
    while (true) {
      const { data, error } = await supabaseClient.storage.from('order-media').list(folder, {
        limit: 100,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw error;
      const entries = data || [];
      for (const entry of entries) {
        const objectPath = `${folder}/${entry.name}`;
        if (entry.id == null && !entry.metadata) await collectOrderStoragePaths(objectPath, paths);
        else paths.push(objectPath);
      }
      if (entries.length < 100) break;
      offset += entries.length;
    }
    return paths;
  }

  async function deleteOwnerWorkOrder(button) {
    if (!supabaseClient || currentProfile?.role !== 'owner') return;
    const { orderId, orderNumber, plate } = button.dataset;
    const confirmed = window.confirm(
      `¿Eliminar el vehículo ${plate} y la orden PM-${orderNumber}?\n\n` +
      'Se borrarán permanentemente la recepción, fotos, cotizaciones, tareas, pagos y consumos asociados. ' +
      'Las unidades consumidas se devolverán al saldo actual del inventario. ' +
      'El vehículo y el cliente se conservarán si tienen otras órdenes o vehículos.'
    );
    if (!confirmed) return;

    button.disabled = true;
    try {
      // Enumerar todos los archivos antes de borrar las referencias de la base.
      const objectPaths = await collectOrderStoragePaths(orderId);
      const { data, error } = await supabaseClient.rpc('delete_work_order_bundle', { p_work_order_id: orderId });
      if (error) {
        if (['PGRST202', '42883'].includes(error.code)) {
          throw new Error('Falta aplicar en Supabase la migración 20261125000200_delete_work_order_bundle.sql.');
        }
        throw error;
      }

      let storageCleanupFailed = false;
      const pathsToRemove = objectPaths.length ? objectPaths : (data?.object_paths || []);
      if (pathsToRemove.length) {
        const { error: storageError } = await supabaseClient.storage.from('order-media').remove(pathsToRemove);
        storageCleanupFailed = Boolean(storageError);
        if (storageError) console.error('Prisma Motor: la orden se eliminó, pero faltó limpiar algunos archivos.', { code: storageError.code, message: storageError.message });
      }

      const detailDialog = document.getElementById('orderDetailDialog');
      if (detailDialog?.open) detailDialog.close();
      await loadOwnerDashboard();
      if (state.ownerSection === 'inventory') {
        await Promise.all([loadInventoryProducts(), loadInventoryMovements()]);
      }
      showToast(storageCleanupFailed
        ? `PM-${orderNumber} fue eliminada, pero algunos archivos no se pudieron retirar.`
        : `Vehículo ${plate} y orden PM-${orderNumber} eliminados.`);
    } catch (error) {
      console.error('Prisma Motor: no se pudo eliminar la orden.', { code: error?.code, message: error?.message });
      button.disabled = false;
      showToast(error.message || 'No se pudo eliminar la orden. Revisa la conexión y los permisos.');
    }
  }

  async function loadOwnerDashboard() {
    if (!supabaseClient || currentProfile?.role !== 'owner') return;
    state.ownerData.loading = true; state.ownerData.error = ''; state.ownerData.ratesError = '';
    if (state.role === 'owner') render();
    try {
      const [orders, estimates, tasks, movements, payments, rates] = await Promise.all([
        supabaseClient.from('work_orders').select('id, order_number, status, received_at, vehicles(plate, make, model, model_year), customers(full_name)').order('received_at', { ascending: false }).limit(200),
        supabaseClient.from('estimates').select('id, work_order_id, version, status, created_at').order('version', { ascending: false }).limit(500),
        supabaseClient.from('work_order_tasks').select('id, work_order_id, estimate_item_id, work_type, total_seconds, active_started_at, status').eq('is_operational', true).limit(2000),
        supabaseClient.from('inventory_movements').select('id, work_order_id, estimate_item_id, movement_type, total_cost').eq('movement_type', 'consumption').limit(2000),
        supabaseClient.from('work_order_payments').select('id, work_order_id, amount, payment_method, paid_at, reference, work_orders(order_number)').order('paid_at', { ascending: false }).limit(500),
        supabaseClient.from('labor_cost_rates').select('work_type, hourly_cost, updated_at').order('work_type'),
      ]);
      const failed = [orders, estimates, tasks].find(result => result.error);
      if (failed) throw failed.error;
      const latest = new Map(); (estimates.data || []).forEach(estimate => { if (!latest.has(estimate.work_order_id)) latest.set(estimate.work_order_id, estimate); });
      const estimateIds = [...latest.values()].map(estimate => estimate.id);
      let items = [];
      if (estimateIds.length) {
        const result = await supabaseClient.from('estimate_items').select('id, estimate_id, category, description, quantity, unit_price, decision, decided_at').in('estimate_id', estimateIds).limit(3000);
        if (result.error) throw result.error;
        items = result.data || [];
      }
      const optionalErrors = [movements, payments, rates].filter(result => result.error);
      const needsMigration = optionalErrors.some(result => ['42P01', '42703', 'PGRST205'].includes(result.error.code));
      state.ownerData = { loading: false, error: optionalErrors.length ? (needsMigration ? 'Las órdenes ya están conectadas. Para habilitar pagos y costos financieros, ejecuta la migración 20261118000100_owner_financial_dashboard.sql en Supabase.' : 'La operación está disponible, pero no se pudieron cargar algunos datos financieros. Revisa los permisos de Supabase.') : '', ratesError: rates.error ? 'No se pudieron cargar las tarifas por oficio. Revisa la conexión y los permisos de Supabase.' : '', orders: orders.data || [], estimates: [...latest.values()], estimateItems: items, tasks: tasks.data || [], movements: movements.data || [], payments: payments.data || [], rates: rates.data || [] };
    } catch (error) {
      console.error('Prisma Motor: no se pudo cargar el tablero del propietario.', { code: error.code, message: error.message });
      state.ownerData.loading = false;
      state.ownerData.error = 'No se pudieron cargar los datos financieros. Aplica la migración financiera y revisa los permisos de Supabase.';
      state.ownerData.ratesError = 'No se pudieron cargar las tarifas por oficio. Revisa la conexión y la migración financiera.';
    }
    if (state.role === 'owner') render();
  }

  async function saveOwnerPayment(form) {
    const feedback = form.querySelector('[data-owner-payment-feedback]'); const button = form.querySelector('[type="submit"]');
    const values = new FormData(form); button.disabled = true; feedback.textContent = 'Guardando pago…';
    const paidDate = String(values.get('paid_at') || '');
    const { error } = await supabaseClient.rpc('record_work_order_payment', {
      p_work_order_id: String(values.get('work_order_id') || ''), p_amount: Number(values.get('amount')),
      p_payment_method: String(values.get('payment_method') || ''), p_paid_at: paidDate ? new Date(`${paidDate}T12:00:00`).toISOString() : new Date().toISOString(),
      p_reference: String(values.get('reference') || '').trim() || null,
    });
    button.disabled = false;
    if (error) { feedback.textContent = error.message || 'No se pudo registrar el pago.'; return; }
    showToast('Pago registrado.'); await loadOwnerDashboard();
  }

  async function saveOwnerRates(form) {
    const feedback = form.querySelector('[data-owner-rate-feedback]'); const button = form.querySelector('[type="submit"]');
    const values = new FormData(form); button.disabled = true; feedback.textContent = 'Guardando tarifas…';
    const updates = [...values.entries()].filter(([key]) => workTypeLabels[key]).map(([work_type, hourly_cost]) => ({ work_type, hourly_cost: Number(hourly_cost), updated_by: currentSession.user.id, updated_at: new Date().toISOString() }));
    const { error } = await supabaseClient.from('labor_cost_rates').upsert(updates, { onConflict: 'work_type' });
    button.disabled = false;
    if (error) { feedback.textContent = error.message || 'No se pudieron guardar las tarifas.'; return; }
    showToast('Tarifas guardadas.'); await loadOwnerDashboard();
  }

  function customerView() {
    const active = state.clientPreviewSection || 'vehicle';
    const tabs = [['vehicle', 'Vehículo'], ['quote', 'Cotización'], ['tracking', 'Seguimiento'], ['payments', 'Pagos']];
    let content = '';
    if (active === 'vehicle') content = `<div class="customer-preview-vehicle"><div class="customer-preview-car-icon" aria-hidden="true">✦</div><div class="customer-preview-vehicle-main"><p class="eyebrow">VEHÍCULO EN SERVICIO · ORDEN PM-1045</p><h2>BMW X5 2021</h2><p>Placa <strong>ABC-123</strong> · Ingreso 12 nov 2026</p></div><span class="customer-preview-status">En reparación</span></div><div class="customer-preview-facts"><article><small>ETAPA ACTUAL</small><strong>Reparación</strong></article><article><small>FECHA ESTIMADA DE ENTREGA</small><strong>Pendiente de confirmar</strong></article><article><small>ASESOR DE SERVICIO</small><strong>Prisma Motor</strong></article></div><p class="customer-preview-caption">La información real aparece al abrir el enlace privado de tu cotización.</p>`;
    if (active === 'quote') content = `<div class="customer-preview-section-title"><div><p class="eyebrow">PROPUESTA DE SERVICIO · VERSIÓN 1</p><h2>Revisa cada concepto</h2></div><span class="customer-preview-status customer-preview-status-warm">Esperando tu decisión</span></div><form class="customer-preview-quote-form"><div class="customer-preview-quote-group"><h3>ACTIVIDADES Y MANO DE OBRA</h3><article><div><strong>Diagnóstico y reparación de frenos</strong><small>1 servicio · Mano de obra</small></div><b>$ 180.000</b><label>Tu decisión<select required><option value="">Seleccionar</option><option>Aprobar</option><option>No aprobar</option></select></label></article></div><div class="customer-preview-quote-group"><h3>REPUESTOS E INSUMOS</h3><article><div><strong>Filtro de aire</strong><small>1 unidad · Repuesto</small></div><b>$ 60.000</b><label>Tu decisión<select required><option value="">Seleccionar</option><option>Aprobar</option><option>No aprobar</option></select></label></article></div><div class="customer-preview-total"><span>Total cotizado</span><strong>$ 240.000</strong></div><button class="button customer-preview-submit" type="button" data-client-preview-submit>Probar envío de decisión</button></form><p class="customer-preview-caption">Muestra interactiva: el botón valida las selecciones, pero no envía datos.</p>`;
    if (active === 'tracking') content = `<div class="customer-preview-section-title"><div><p class="eyebrow">ORDEN PM-1045</p><h2>Seguimiento del servicio</h2></div><span class="customer-preview-status">2 de 4 actividades</span></div><div class="customer-preview-progress"><span><i></i></span><strong>50%</strong></div><div class="customer-preview-timeline"><article class="is-done"><i></i><div><strong>Vehículo recibido</strong><small>12 nov · 9:30 a. m.</small></div></article><article class="is-done"><i></i><div><strong>Diagnóstico completado</strong><small>13 nov · 11:15 a. m.</small></div></article><article class="is-current"><i></i><div><strong>En reparación</strong><small>Actualización del taller · 18 nov</small></div></article><article><i></i><div><strong>Control de calidad y entrega</strong><small>Te avisaremos al avanzar</small></div></article></div><p class="customer-preview-caption">Solo se muestran etapas y avances compartidos por el taller.</p>`;
    if (active === 'payments') content = `<div class="customer-preview-section-title"><div><p class="eyebrow">ORDEN PM-1045 · COTIZACIÓN APROBADA</p><h2>Pagos y saldo</h2></div><span class="customer-preview-status">Actualizado</span></div><div class="customer-preview-payment-total"><span>Total aprobado<strong>$ 240.000</strong></span><span>Abonado<strong>$ 100.000</strong></span><span>Saldo pendiente<strong>$ 140.000</strong></span></div><div class="customer-preview-payment-row"><span>18 nov 2026 · Transferencia</span><b>$ 100.000</b></div><p class="customer-preview-caption">Estos datos aparecen cuando el taller registra un pago.</p>`;
    return `<div class="screen-grid customer-demo-view"><div class="customer-demo-label"><span>VISTA PREVIA DEL CLIENTE</span><small>Datos de ejemplo · Selecciona cada sección para ver su contenido</small></div><nav class="customer-preview-tabs" aria-label="Secciones del portal del cliente">${tabs.map(([id, label]) => `<button class="customer-preview-tab ${active === id ? 'active' : ''}" type="button" data-client-preview-tab="${id}" aria-current="${active === id ? 'page' : 'false'}">${label}</button>`).join('')}</nav><section class="customer-preview-panel">${content}</section><p class="customer-preview-disclaimer">Esta vista sirve para revisar el diseño. Los datos reales se cargan desde el enlace privado que se envía al cliente.</p></div>`;
  }

  function render() {
    const [defaultHeading, defaultSummary] = roles[state.role];
    const heading = state.role === 'owner' && state.ownerSection === 'inventory' ? 'Repuestos e insumos' : state.role === 'owner' && state.ownerSection === 'finance' ? 'Finanzas' : defaultHeading;
    const summary = state.role === 'owner' && state.ownerSection === 'inventory' ? 'Administra los productos que recepción puede agregar a una cotización.' : state.role === 'owner' && state.ownerSection === 'finance' ? 'Pagos, costos operativos y margen bruto del taller.' : defaultSummary;
    title.textContent = heading;
    description.textContent = summary;
    document.body.classList.toggle('theme-dark', state.role === 'technician');
    document.body.classList.toggle('role-owner', state.role === 'owner');
    document.body.classList.toggle('role-reception', state.role === 'reception');
    document.body.classList.toggle('role-customer', state.role === 'customer');
    document.querySelectorAll('[data-role]').forEach(button => button.classList.toggle('active', button.dataset.role === state.role));
    document.querySelectorAll('[data-open-intake]').forEach(button => { button.hidden = state.role !== 'reception'; });
    screen.innerHTML = ({ reception: receptionViewPremium, technician: technicianView, owner: ownerView, customer: customerView })[state.role]();
    window.clearInterval(technicianTimerInterval);
    technicianTimerInterval = null;
    if (state.role === 'technician') {
      refreshTaskTimers();
      technicianTimerInterval = window.setInterval(refreshTaskTimers, 1000);
    }
  }

  function showAuthMessage(message, retry = false) {
    document.body.classList.remove('is-authenticated');
    authGate.hidden = false;
    loginForm.hidden = false;
    passwordSetupForm.hidden = true;
    authTitle.textContent = 'Bienvenido';
    authIntro.textContent = 'Ingresa con la cuenta que te asignó el propietario del taller.';
    authFeedback.textContent = message;
    authRetry.hidden = !retry;
  }

  function showPasswordSetup(message = '') {
    document.body.classList.remove('is-authenticated');
    authGate.hidden = false;
    loginForm.hidden = true;
    passwordSetupForm.hidden = false;
    authTitle.textContent = 'Activa tu cuenta';
    authIntro.textContent = 'Antes de entrar a Mi Bahía, crea una contraseña segura para tu acceso.';
    authFeedback.textContent = message;
    authRetry.hidden = true;
  }

  async function saveAccountPassword(event) {
    event.preventDefault();
    const newPassword = document.getElementById('newAccountPassword');
    const confirmPassword = document.getElementById('confirmAccountPassword');
    const button = document.getElementById('saveAccountPassword');
    if (newPassword.value.length < 8) { authFeedback.textContent = 'La contraseña debe tener al menos 8 caracteres.'; return; }
    if (newPassword.value !== confirmPassword.value) { authFeedback.textContent = 'Las contraseñas no coinciden.'; return; }
    if (!supabaseClient || !currentSession) { showAuthMessage('El enlace de invitación ya no está activo. Pide al propietario que envíe uno nuevo.'); return; }
    button.disabled = true;
    button.textContent = 'Guardando…';
    authFeedback.textContent = '';
    try {
      const updatedMetadata = { ...(currentSession.user.user_metadata || {}), password_setup_required: false };
      const { error: updateError } = await supabaseClient.auth.updateUser({ password: newPassword.value, data: updatedMetadata });
      if (updateError) throw updateError;
      passwordSetupMode = false;
      newPassword.value = '';
      confirmPassword.value = '';
      const cleanUrl = new URL(location.href);
      cleanUrl.hash = '';
      cleanUrl.searchParams.delete('type');
      cleanUrl.searchParams.delete('code');
      history.replaceState(null, document.title, `${cleanUrl.pathname}${cleanUrl.search}`);
      const { data, error: sessionError } = await supabaseClient.auth.getSession();
      if (sessionError || !data.session) throw sessionError || new Error('La sesión terminó. Inicia sesión con tu nueva contraseña.');
      currentSession = data.session;
      await loadAuthenticatedProfile(data.session);
    } catch (error) {
      console.error('Prisma Motor: no se pudo guardar la contraseña.', { code: error?.code, message: error?.message });
      authFeedback.textContent = error?.message || 'No se pudo guardar la contraseña. Solicita una invitación nueva e inténtalo otra vez.';
    } finally {
      button.disabled = false;
      button.textContent = 'Guardar contraseña';
    }
  }

  async function loadAuthenticatedProfile(session) {
    if (!supabaseClient || !session?.user) {
      showAuthMessage('No se pudo conectar con Supabase. Revisa tu conexión e inténtalo de nuevo.', true);
      return;
    }
    currentSession = session;
    if (passwordSetupMode || session.user.user_metadata?.password_setup_required) {
      passwordSetupMode = true;
      showPasswordSetup();
      return;
    }
    authFeedback.textContent = 'Verificando tu acceso…';
    authRetry.hidden = true;
    let timeoutId;
    const profileRequest = Promise.resolve(
      supabaseClient
        .from('profiles')
        .select('display_name, role, active')
        .eq('id', session.user.id)
        .maybeSingle()
    ).catch(error => ({ data: null, error }));
    const timedOut = new Promise(resolve => {
      timeoutId = window.setTimeout(() => resolve({ data: null, error: new Error('Profile request timed out') }), 12000);
    });
    const { data: profile, error } = await Promise.race([profileRequest, timedOut]);
    window.clearTimeout(timeoutId);
    if (error) {
      showAuthMessage('No pudimos verificar tu perfil. Revisa la conexión y vuelve a intentar.', true);
      return;
    }
    if (!profile || !profile.active || !['owner', 'advisor', 'technician'].includes(profile.role)) {
      await supabaseClient.auth.signOut();
      currentSession = null;
      showAuthMessage('Esta cuenta no tiene un perfil activo en Prisma Motor. Contacta al propietario.');
      return;
    }
    currentProfile = profile;
    state.role = profile.role === 'owner' ? 'owner' : profile.role === 'advisor' ? 'reception' : 'technician';
    const displayName = profile.display_name || session.user.email || 'Prisma Motor';
    document.getElementById('profileLabel').textContent = displayName;
    document.getElementById('profileAvatar').textContent = displayName.trim().slice(0, 2).toUpperCase();
    document.body.classList.toggle('can-preview-roles', profile.role === 'owner');
    document.body.classList.add('is-authenticated');
    authGate.hidden = true;
    render();
    if (profile.role === 'owner') { loadTeamMembers(); loadOwnerDashboard(); }
    if (['owner', 'advisor'].includes(profile.role)) {
      loadInventoryProducts();
      await refreshPendingIntakes();
      loadReceptionOrders();
      if (navigator.onLine) syncPendingIntakes();
    } else loadTechnicianTasks();
  }

  async function initializeAuth() {
    if (!supabaseClient) {
      showAuthMessage('No se pudo cargar la conexión con Supabase. Revisa tu conexión a internet y vuelve a intentar.', true);
      return;
    }
    let data;
    let error;
    try {
      ({ data, error } = await supabaseClient.auth.getSession());
    } catch {
      showAuthMessage('No pudimos comprobar tu sesión. Revisa tu conexión y vuelve a intentar.', true);
      return;
    }
    if (error) {
      showAuthMessage('No pudimos comprobar tu sesión. Vuelve a intentar.', true);
      return;
    }
    if (data.session) {
      await loadAuthenticatedProfile(data.session);
      return;
    }
    showAuthMessage('');
  }

  function showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    window.setTimeout(() => toast.classList.remove('show'), 2800);
  }

  function updateTimerDisplay() {
    const display = document.getElementById('timerDisplay');
    if (!display) return;
    const hours = String(Math.floor(state.timer / 3600)).padStart(2, '0');
    const minutes = String(Math.floor((state.timer % 3600) / 60)).padStart(2, '0');
    const seconds = String(state.timer % 60).padStart(2, '0');
    display.textContent = `${hours}:${minutes}:${seconds}`;
  }

  document.addEventListener('click', event => {
    const clientPreviewTab = event.target.closest('[data-client-preview-tab]');
    if (clientPreviewTab && state.role === 'customer') {
      state.clientPreviewSection = clientPreviewTab.dataset.clientPreviewTab;
      render();
      return;
    }
    const clientPreviewSubmit = event.target.closest('[data-client-preview-submit]');
    if (clientPreviewSubmit) {
      const form = clientPreviewSubmit.closest('form');
      if (!form?.reportValidity()) return;
      showToast('Vista previa: la decisión no se envió al taller.');
      return;
    }
    if (event.target.closest('[data-open-password-setup]')) {
      passwordSetupMode = true;
      showPasswordSetup();
      return;
    }
    if (event.target.closest('[data-open-team-invite]')) {
      state.teamInviteOpen = !state.teamInviteOpen;
      state.teamNotice = '';
      render();
      return;
    }
    const ownerDeleteButton = event.target.closest('[data-owner-delete-order]');
    if (ownerDeleteButton) { deleteOwnerWorkOrder(ownerDeleteButton); return; }
    const ownerSectionButton = event.target.closest('[data-owner-section]');
    if (ownerSectionButton && currentProfile?.role === 'owner') {
      state.ownerSection = ['inventory', 'finance'].includes(ownerSectionButton.dataset.ownerSection) ? ownerSectionButton.dataset.ownerSection : 'dashboard';
      state.inventoryNotice = '';
      render();
      if (state.ownerSection === 'inventory') { loadInventoryProducts(); loadInventoryMovements(); loadOwnerDashboard(); }
      if (state.ownerSection === 'finance' || state.ownerSection === 'dashboard') loadOwnerDashboard();
      return;
    }
    if (event.target.closest('[data-owner-reload]')) { loadOwnerDashboard(); return; }
    const inventoryToggle = event.target.closest('[data-inventory-toggle]');
    if (inventoryToggle) { setInventoryProductActive(inventoryToggle.dataset.inventoryToggle, inventoryToggle.dataset.active !== 'true'); return; }
    if (event.target.closest('[data-inventory-reload]')) { loadInventoryProducts(); loadOwnerDashboard(); return; }
    if (event.target.closest('[data-inventory-movements-reload]')) { loadInventoryMovements(); return; }
    const teamToggle = event.target.closest('[data-team-toggle]');
    if (teamToggle) { setTeamMemberActive(teamToggle.dataset.teamToggle, teamToggle.dataset.active !== 'true'); return; }
    const teamSpecialtySave = event.target.closest('[data-team-save-specialty]');
    if (teamSpecialtySave) {
      const specialty = teamSpecialtySave.closest('.team-member-row')?.querySelector('[data-team-specialty]')?.value || '';
      setTeamMemberSpecialty(teamSpecialtySave.dataset.teamSaveSpecialty, specialty);
      return;
    }
    const detailTrigger = event.target.closest('[data-order-detail]');
    if (detailTrigger && supabaseClient && currentProfile && ['owner', 'advisor'].includes(currentProfile.role)) {
      if (vehicleListDialog.open) vehicleListDialog.close();
      openOrderDetail(detailTrigger.dataset.orderDetail);
      return;
    }
    const vehicleListTrigger = event.target.closest('[data-vehicle-list]');
    if (vehicleListTrigger) { openVehicleList(vehicleListTrigger.dataset.vehicleList); return; }
    if (event.target.closest('[data-close-vehicle-list]')) { vehicleListDialog.close(); return; }
    if (event.target.closest('[data-close-order-detail]')) { document.getElementById('orderDetailDialog').close(); return; }
    const advanceOrderButton = event.target.closest('[data-advance-order]');
    if (advanceOrderButton) { advanceOrderStatus(advanceOrderButton.dataset.advanceOrder); return; }
    const taskAction = event.target.closest('[data-task-action]');
    if (taskAction) { updateTechnicianTask(taskAction.dataset.taskId, taskAction.dataset.taskAction); return; }
    if (event.target.closest('[data-reload-technician]')) { loadTechnicianTasks(); return; }
    const addExtraTaskButton = event.target.closest('[data-add-extra-task]');
    if (addExtraTaskButton) {
      const container = document.querySelector('[data-extra-task-rows]');
      if (!container) return;
      let technicians = [];
      try { technicians = JSON.parse(addExtraTaskButton.dataset.technicians || '[]'); } catch { technicians = []; }
      const descriptors = [...document.querySelectorAll('.task-assignment-row')].map(row => ({
        key: row.dataset.taskKey,
        title: row.querySelector('[name="task_title"]')?.value.trim() || row.querySelector('.task-assignment-source > strong')?.textContent || 'Tarea nueva',
        workType: row.querySelector('[name="work_type"]')?.value || 'other',
      }));
      const key = `extra:${crypto.randomUUID()}`;
      descriptors.push({ key, title: 'Actividad nueva', workType: 'other' });
      container.insertAdjacentHTML('beforeend', renderTaskAssignmentRow({ key, extra: true, technicians, descriptors, taskDependencies: [] }));
      refreshTaskPrerequisiteOptions();
      container.lastElementChild?.querySelector('[name="task_title"]')?.focus();
      return;
    }
    const removeExtraTaskButton = event.target.closest('[data-remove-extra-task]');
    if (removeExtraTaskButton) {
      removeExtraTaskButton.closest('.task-assignment-row')?.remove();
      refreshTaskPrerequisiteOptions();
      return;
    }
    const saveTaskAssignmentsButton = event.target.closest('[data-save-task-assignments]');
    if (saveTaskAssignmentsButton) { saveTaskAssignments(saveTaskAssignmentsButton.dataset.saveTaskAssignments); return; }
    const createEstimateButton = event.target.closest('[data-create-estimate]');
    if (createEstimateButton) { createEstimateDraft(createEstimateButton.dataset.createEstimate); return; }
    if (event.target.closest('[data-add-quote-line]')) { document.getElementById('estimateLines').insertAdjacentHTML('beforeend', quoteEditorRow()); return; }
    const removeQuoteLine = event.target.closest('[data-remove-quote-line]');
    if (removeQuoteLine) {
      const lines = document.getElementById('estimateLines');
      removeQuoteLine.closest('.quote-editor-line').remove();
      if (!lines.children.length) lines.innerHTML = quoteEditorRow();
      return;
    }
    const saveEstimateButton = event.target.closest('[data-save-estimate]');
    if (saveEstimateButton) { saveEstimateDraft(saveEstimateButton.dataset.saveEstimate, false); return; }
    const sendEstimateButton = event.target.closest('[data-send-estimate]');
    if (sendEstimateButton) { saveEstimateDraft(sendEstimateButton.dataset.sendEstimate, true); return; }
    const renewQuoteLink = event.target.closest('[data-renew-quote-link]');
    if (renewQuoteLink) { generateQuoteLink(renewQuoteLink.dataset.renewQuoteLink); return; }
    if (event.target.closest('[data-copy-quote-link]')) {
      const link = document.getElementById('quoteShareLink');
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link.value).then(() => showToast('Enlace copiado para compartir.')).catch(() => { link.focus(); link.select(); showToast('Selecciona y copia el enlace.'); });
      else { link.focus(); link.select(); showToast('Selecciona y copia el enlace.'); }
      return;
    }
    if (event.target.closest('[data-reload-reception]')) { loadReceptionOrders(); return; }
    if (event.target.closest('[data-sync-intakes]')) { syncPendingIntakes(); return; }
    if (event.target.closest('[data-intake-next]')) {
      const nextStep = Number(event.target.closest('[data-intake-next]').dataset.intakeNext);
      if (validateIntakeStep(currentIntakeStep)) setIntakeStep(nextStep);
      return;
    }
    if (event.target.closest('[data-intake-back]')) { setIntakeStep(Number(event.target.closest('[data-intake-back]').dataset.intakeBack)); return; }
    if (event.target.closest('[data-add-damage]')) { addIntakeDamageMark(); return; }
    const removeDamage = event.target.closest('[data-remove-damage]');
    if (removeDamage) { state.intakeDamageMarks.splice(Number(removeDamage.dataset.removeDamage), 1); renderDamageMarks(); return; }
    if (event.target.closest('[data-clear-signature]')) { clearSignature(); return; }
    const roleButton = event.target.closest('[data-role]');
    if (roleButton) {
      state.role = roleButton.dataset.role;
      render();
      if (state.role === 'technician') loadTechnicianTasks();
      if (state.role === 'owner' && currentProfile?.role === 'owner') loadTeamMembers();
      return;
    }
    if (event.target.closest('[data-open-intake]')) { resetIntakeFlow(); dialog.showModal(); return; }
    if (event.target.closest('[data-close-dialog]')) { dialog.close(); return; }
    if (event.target.closest('[data-timer-start]')) {
      if (!state.timerRunning) { state.timerRunning = true; state.timerInterval = window.setInterval(() => { state.timer++; updateTimerDisplay(); }, 1000); }
      showToast('Cronómetro iniciado en esta vista de muestra.'); return;
    }
    if (event.target.closest('[data-timer-pause]')) {
      state.timerRunning = false; window.clearInterval(state.timerInterval); showToast('Cronómetro pausado.'); return;
    }
    if (event.target.closest('[data-approve-quote]')) {
      state.quoteDecisionSubmitted = true; render(); showToast('Decisiones de muestra registradas en pantalla.');
    }
    if (event.target.closest('#signOutButton')) {
      if (!supabaseClient) return;
      supabaseClient.auth.signOut().then(({ error }) => {
        if (error) return showToast('No se pudo cerrar la sesión. Inténtalo de nuevo.');
        currentSession = null;
        currentProfile = null;
        showAuthMessage('');
      });
    }
  });

  document.addEventListener('keydown', event => {
    const detailTrigger = event.target.closest('[data-order-detail]');
    if (!detailTrigger || !['Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    if (supabaseClient && currentProfile && ['owner', 'advisor'].includes(currentProfile.role)) {
      if (vehicleListDialog.open) vehicleListDialog.close();
      openOrderDetail(detailTrigger.dataset.orderDetail);
    }
  });

  loginForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!supabaseClient) {
      showAuthMessage('No se pudo cargar Supabase. Revisa tu conexión a internet.', true);
      return;
    }
    const submit = loginForm.querySelector('[type="submit"]');
    const values = new FormData(loginForm);
    submit.disabled = true;
    submit.textContent = 'Ingresando…';
    authFeedback.textContent = '';
    let data;
    let error;
    try {
      ({ data, error } = await supabaseClient.auth.signInWithPassword({
        email: String(values.get('email')).trim(),
        password: String(values.get('password')),
      }));
    } catch {
      submit.disabled = false;
      submit.innerHTML = 'Ingresar <span aria-hidden="true">→</span>';
      showAuthMessage('No se pudo conectar con Supabase. Revisa tu conexión e inténtalo de nuevo.', true);
      return;
    }
    submit.disabled = false;
    submit.innerHTML = 'Ingresar <span aria-hidden="true">→</span>';
    if (error) {
      showAuthMessage('No pudimos iniciar sesión. Verifica el correo, la contraseña y que la cuenta esté confirmada.');
      return;
    }
    await loadAuthenticatedProfile(data.session);
  });

  passwordSetupForm.addEventListener('submit', saveAccountPassword);

  authRetry.addEventListener('click', () => currentSession ? loadAuthenticatedProfile(currentSession) : initializeAuth());

  const signatureCanvas = document.getElementById('customerSignature');
  if (signatureCanvas) {
    signatureCanvas.addEventListener('pointerdown', event => {
      if (!signatureContext) prepareSignatureCanvas();
      if (!signatureContext) return;
      signatureCanvas.setPointerCapture(event.pointerId);
      signatureContext.beginPath();
      signatureContext.moveTo(event.offsetX, event.offsetY);
      intakeSignatureReady = true;
      document.getElementById('signatureMessage').textContent = '';
      event.preventDefault();
    });
    signatureCanvas.addEventListener('pointermove', event => {
      if (!signatureCanvas.hasPointerCapture(event.pointerId) || !signatureContext) return;
      signatureContext.lineTo(event.offsetX, event.offsetY);
      signatureContext.stroke();
      event.preventDefault();
    });
  }

  document.getElementById('intakePhotos').addEventListener('change', event => {
    const files = [...event.target.files];
    document.getElementById('photoSelection').textContent = files.length ? `${files.length} ${files.length === 1 ? 'foto lista' : 'fotos listas'}` : 'Sin fotos seleccionadas';
    if (files.length > 8 || files.some(file => file.size > 15 * 1024 * 1024)) {
      document.getElementById('photoSelection').textContent = 'Máximo 8 fotos, de hasta 15 MB cada una.';
      event.target.value = '';
    }
  });

  document.getElementById('noVisibleDamage').addEventListener('change', event => {
    const disabled = event.target.checked;
    ['damageView', 'damageType', 'damageNote'].forEach(id => { document.getElementById(id).disabled = disabled; });
    document.querySelector('[data-add-damage]').disabled = disabled;
    if (disabled) { state.intakeDamageMarks = []; renderDamageMarks(); }
  });

  function refreshTaskPrerequisiteOptions(suggestPaintPrerequisite = false) {
    const rows = [...document.querySelectorAll('.task-assignment-row')];
    const selectedByTask = new Map(rows.map(row => [row.dataset.taskKey, [...row.querySelectorAll('[name="prerequisite_tasks"]:checked')].map(input => input.value)]));
    const descriptors = rows.map(row => ({
      key: row.dataset.taskKey,
      title: row.querySelector('[name="task_title"]')?.value.trim() || row.querySelector('.task-assignment-source > strong')?.textContent || 'Tarea nueva',
      workType: row.querySelector('[name="work_type"]')?.value || 'other',
    }));
    rows.forEach(row => {
      const container = row.querySelector('.task-prerequisite-options');
      if (!container) return;
      const taskKey = row.dataset.taskKey;
      let selected = selectedByTask.get(taskKey) || [];
      if (suggestPaintPrerequisite && row.querySelector('[name="work_type"]')?.value === 'paint' && !selected.length) {
        selected = descriptors.filter(candidate => candidate.key !== taskKey && candidate.workType === 'bodywork').map(candidate => candidate.key);
      }
      const locked = row.dataset.taskStatus !== 'pending';
      const candidates = descriptors.filter(candidate => candidate.key !== taskKey);
      container.innerHTML = candidates.length
        ? candidates.map(candidate => `<label class="task-prerequisite-option"><input type="checkbox" name="prerequisite_tasks" value="${escapeHtml(candidate.key)}" ${selected.includes(candidate.key) ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>${escapeHtml(candidate.title)} <small>${escapeHtml(workTypeLabels[candidate.workType] || candidate.workType)}</small></span></label>`).join('')
        : '<small class="order-detail-muted">Agrega otra tarea para definir un prerequisito.</small>';
    });
  }

  document.addEventListener('change', event => {
    const movementTypeSelect = event.target.closest('[data-inventory-movement-type]');
    if (movementTypeSelect) {
      const form = movementTypeSelect.closest('.inventory-movement-form');
      const type = movementTypeSelect.value;
      const cost = form.querySelector('.inventory-movement-cost');
      form.querySelector('.inventory-movement-cost-heading').hidden = type !== 'purchase';
      const order = form.querySelector('.inventory-movement-order');
      form.querySelector('.inventory-movement-order-heading').hidden = type !== 'consumption';
      cost.hidden = type !== 'purchase';
      cost.querySelector('input').required = type === 'purchase';
      order.hidden = type !== 'consumption';
      order.querySelector('select').required = type === 'consumption';
      const item = form.querySelector('.inventory-movement-item');
      form.querySelector('.inventory-movement-item-heading').hidden = type !== 'consumption';
      item.hidden = type !== 'consumption';
      if (type !== 'consumption') form.querySelector('[data-inventory-estimate-item]').value = '';
      form.querySelector('[name="quantity"]').placeholder = type === 'adjustment' ? 'Ej. +2 o -1' : 'Cantidad positiva';
      return;
    }
    if (event.target.matches('[data-inventory-work-order]')) {
      const orderId = event.target.value;
      const itemSelect = event.target.form.querySelector('[data-inventory-estimate-item]');
      [...itemSelect.options].forEach(option => { option.hidden = Boolean(option.value && option.dataset.orderId !== orderId); });
      itemSelect.value = '';
      return;
    }
    const productSelect = event.target.closest('.quote-editor-line [name="inventory_product_id"]');
    if (productSelect) {
      const product = state.inventoryProducts.find(row => row.id === productSelect.value);
      const line = productSelect.closest('.quote-editor-line');
      if (product) {
        line.querySelector('[name="category"]').value = product.category;
        line.querySelector('[name="description"]').value = product.name;
        line.querySelector('[name="unit_price"]').value = Number(product.sale_price);
        line.querySelector('[name="product_unit"]').value = product.unit;
      }
      syncManualProductFields(line);
      return;
    }
    const quoteCategorySelect = event.target.closest('.quote-editor-line [name="category"]');
    if (quoteCategorySelect) {
      syncManualProductFields(quoteCategorySelect.closest('.quote-editor-line'));
      return;
    }
    const workTypeSelect = event.target.closest('.task-assignment-row [name="work_type"]');
    if (workTypeSelect) {
      const row = workTypeSelect.closest('.task-assignment-row');
      const assignee = row.querySelector('[name="assigned_to"]');
      let technicians = [];
      try { technicians = JSON.parse(assignee.dataset.technicians || '[]'); } catch { technicians = []; }
      assignee.innerHTML = technicianOptions(technicians, workTypeSelect.value);
      refreshTaskPrerequisiteOptions(workTypeSelect.value === 'paint');
      return;
    }
    const itemCheckbox = event.target.closest('[data-quote-item]');
    if (!itemCheckbox) return;
    const item = state.quoteItems.find(row => row.id === itemCheckbox.dataset.quoteItem);
    if (!item || state.quoteDecisionSubmitted) return;
    item.selected = itemCheckbox.checked;
    render();
  });

  function filterReceptionAgenda() {
    const list = document.getElementById('appointmentList');
    if (!list) return;
    const term = document.getElementById('orderSearch')?.value.trim().toLocaleLowerCase('es') || '';
    const stage = document.getElementById('orderStatusFilter')?.value || '';
    const items = [...list.querySelectorAll('.appointment')];
    let visibleItems = 0;
    items.forEach(item => {
      const matchesText = item.textContent.toLocaleLowerCase('es').includes(term);
      const matchesStage = !stage || item.dataset.stage === stage;
      item.hidden = !(matchesText && matchesStage);
      if (!item.hidden) visibleItems++;
    });
    const noMatches = document.getElementById('noAgendaMatches');
    if (noMatches) noMatches.hidden = items.length === 0 || visibleItems > 0;
  }

  document.addEventListener('input', event => {
    if (event.target.matches('.task-assignment-row [name="task_title"]')) {
      refreshTaskPrerequisiteOptions();
      return;
    }
    if (event.target.id !== 'orderSearch') return;
    filterReceptionAgenda();
  });

  document.addEventListener('change', event => {
    if (event.target.id !== 'orderStatusFilter') return;
    filterReceptionAgenda();
  });

  async function optimizeVehiclePhoto(file) {
    const originalExtensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    if (!originalExtensions[file.type] || !window.createImageBitmap) {
      return { blob: file, contentType: file.type, extension: originalExtensions[file.type] || 'jpg' };
    }
    let bitmap;
    try { bitmap = await createImageBitmap(file); }
    catch { return { blob: file, contentType: file.type, extension: originalExtensions[file.type] }; }
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d', { alpha: false }).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const optimized = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.82));
    if (!optimized || (scale === 1 && optimized.size >= file.size)) {
      return { blob: file, contentType: file.type, extension: originalExtensions[file.type] };
    }
    const optimizedType = optimized.type || 'image/webp';
    const optimizedExtensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    return { blob: optimized, contentType: optimizedType, extension: optimizedExtensions[optimizedType] || 'webp' };
  }

  async function buildIntakeRecord(form) {
    const values = Object.fromEntries([...new FormData(form).entries()].filter(([key]) => key !== 'photos'));
    const workOrderId = crypto.randomUUID();
    const customerId = crypto.randomUUID();
    const vehicleId = crypto.randomUUID();
    const userId = currentSession.user.id;
    const media = [];
    const photos = [...document.getElementById('intakePhotos').files];
    const photosAllowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (photos.length > 8 || photos.some(file => !photosAllowed.has(file.type) || file.size > 15 * 1024 * 1024)) {
      throw new Error('Selecciona hasta 8 fotos JPG, PNG o WEBP de máximo 15 MB cada una.');
    }

    for (let index = 0; index < photos.length; index++) {
      statusMessageForUpload(index, photos.length);
      const optimized = await optimizeVehiclePhoto(photos[index]);
      const mediaId = crypto.randomUUID();
      media.push({
        id: mediaId,
        kind: 'intake',
        path: `${workOrderId}/intake/${mediaId}.${optimized.extension}`,
        blob: optimized.blob,
        contentType: optimized.contentType,
        caption: `Foto de recepción ${index + 1} · ${Math.round(photos[index].size / 1024)} KB → ${Math.round(optimized.blob.size / 1024)} KB`,
      });
    }

    const signatureBlob = await new Promise(resolve => document.getElementById('customerSignature').toBlob(resolve, 'image/png'));
    if (!signatureBlob) throw new Error('No se pudo preparar la firma. Limpia el recuadro y vuelve a firmar.');
    const signatureId = crypto.randomUUID();
    const signaturePath = `${workOrderId}/signature/${signatureId}.png`;
    media.push({ id: signatureId, kind: 'signature', path: signaturePath, blob: signatureBlob, contentType: 'image/png', caption: 'Firma de recepción del cliente' });

    const plateRaw = String(values.plate || '').trim().toUpperCase().replace(/\s+/g, '');
    const plate = plateRaw.length === 6 && !plateRaw.includes('-') ? `${plateRaw.slice(0, 3)}-${plateRaw.slice(3)}` : plateRaw;
    const now = new Date().toISOString();
    return {
      id: workOrderId,
      userId,
      customer: {
        id: customerId,
        full_name: String(values.customer || '').trim(),
        phone: String(values.phone || '').trim(),
        email: String(values.email || '').trim() || null,
        created_by: userId,
      },
      vehicle: {
        id: vehicleId,
        customer_id: customerId,
        plate,
        make: String(values.make || '').trim(),
        model: String(values.model || '').trim(),
        model_year: values.model_year ? Number(values.model_year) : null,
        color: String(values.color || '').trim() || null,
      },
      workOrder: {
        id: workOrderId,
        customer_id: customerId,
        vehicle_id: vehicleId,
        opened_by: userId,
        status: 'received',
        odometer_km: Number(values.odometer),
        customer_concern: String(values.reason || '').trim(),
      },
      checklist: {
        work_order_id: workOrderId,
        fuel_level: Number(values.fuel_level),
        spare_tire_present: values.spare_tire_present === '' ? null : values.spare_tire_present === 'true',
        tools_present: values.tools_present === '' ? null : values.tools_present === 'true',
        radio_present: values.radio_present === '' ? null : values.radio_present === 'true',
        upholstery_condition: values.upholstery_condition || null,
        checklist: {
          lights: values.lights,
          tires: values.tires,
          glass_mirrors: values.glass_mirrors,
          inspection_notes: String(values.inspection_notes || '').trim(),
          no_visible_damage: document.getElementById('noVisibleDamage').checked,
          photo_paths: media.filter(asset => asset.kind === 'intake').map(asset => asset.path),
        },
        customer_signature_path: signaturePath,
        signed_at: now,
        recorded_by: userId,
      },
      damageMarks: state.intakeDamageMarks.map(mark => ({
        id: crypto.randomUUID(),
        work_order_id: workOrderId,
        vehicle_view: mark.vehicle_view,
        panel: mark.vehicle_view,
        damage_type: mark.damage_type,
        note: mark.note,
        created_by: userId,
      })),
      media,
      statusHistory: {
        id: crypto.randomUUID(),
        work_order_id: workOrderId,
        previous_status: null,
        new_status: 'received',
        note: 'Orden creada desde Recepción.',
        changed_by: userId,
      },
    };
  }

  function statusMessageForUpload(index, total) {
    document.getElementById('intakeSaveMessage').textContent = `Optimizando foto ${index + 1} de ${total}…`;
  }

  function isDuplicateStorageError(error) {
    return error?.status === 409 || error?.statusCode === '409' || /already exists|duplicate/i.test(error?.message || '');
  }

  async function syncIntakeRecord(record) {
    const upsert = async (table, rows, onConflict = 'id') => {
      const { error } = await supabaseClient.from(table).upsert(rows, { onConflict });
      if (error) throw error;
    };
    await upsert('customers', record.customer);
    await upsert('vehicles', record.vehicle);
    const { data: order, error: orderError } = await supabaseClient.from('work_orders')
      .upsert(record.workOrder, { onConflict: 'id' }).select('order_number').single();
    if (orderError) throw orderError;

    for (const asset of record.media) {
      const { error } = await supabaseClient.storage.from('order-media').upload(asset.path, asset.blob, {
        cacheControl: '3600', contentType: asset.contentType, upsert: false,
      });
      if (error && !isDuplicateStorageError(error)) throw error;
    }

    await upsert('intake_checklists', record.checklist, 'work_order_id');
    if (record.damageMarks.length) await upsert('damage_marks', record.damageMarks);
    await upsert('work_order_media', record.media.map(({ id, kind, path, contentType, caption }) => ({
      id,
      work_order_id: record.id,
      media_kind: kind,
      object_path: path,
      content_type: contentType,
      caption,
      uploaded_by: record.userId,
      captured_at: new Date().toISOString(),
    })));
    const { error: historyError } = await supabaseClient.from('work_order_status_history').insert(record.statusHistory);
    if (historyError && historyError.code !== '23505') throw historyError;
    return order?.order_number;
  }

  async function rollbackIntakeRecord(record) {
    await supabaseClient.storage.from('order-media').remove(record.media.map(asset => asset.path));
    await supabaseClient.from('work_orders').delete().eq('id', record.id);
    await supabaseClient.from('vehicles').delete().eq('id', record.vehicle.id);
    await supabaseClient.from('customers').delete().eq('id', record.customer.id);
  }

  function intakeErrorMessage(error) {
    if (error?.code === '23505') return 'Ya existe un vehículo con esa placa. Revisa la placa o consulta la orden existente.';
    if (String(error?.message || '').toLowerCase().includes('row-level security')) return 'Tu perfil no tiene permiso para registrar órdenes. Contacta al propietario.';
    if (!navigator.onLine) return 'La recepción quedó guardada en este dispositivo y se sincronizará al recuperar internet.';
    return 'No se pudo completar el registro en Supabase. Tus datos siguen en el formulario; revisa la conexión y vuelve a intentar.';
  }

  async function saveReceptionOrder(event) {
    event.preventDefault();
    if (!supabaseClient || !currentSession || !currentProfile || !['owner', 'advisor'].includes(currentProfile.role)) {
      document.getElementById('intakeSaveMessage').textContent = 'Se requiere una sesión activa de Recepción para guardar la orden.';
      return;
    }
    const saveButton = document.getElementById('saveIntakeButton');
    const statusMessage = document.getElementById('intakeSaveMessage');
    const form = event.currentTarget;
    let queuedRecord = null;
    saveButton.disabled = true;
    try {
      saveButton.textContent = 'Preparando…';
      statusMessage.textContent = 'Optimizando fotos y preparando el registro…';
      const record = await buildIntakeRecord(form);
      await savePendingIntake(record);
      queuedRecord = record;
      state.pendingIntakes = await getPendingIntakes(currentSession.user.id);
      if (!navigator.onLine) {
        dialog.close();
        resetIntakeFlow();
        render();
        showToast('Recepción guardada en este dispositivo; se sincronizará al volver internet.');
        return;
      }
      saveButton.textContent = 'Sincronizando…';
      statusMessage.textContent = 'Guardando cliente, vehículo, inspección y fotos en Supabase…';
      const orderNumber = await syncIntakeRecord(record);
      await removePendingIntake(record.id);
      state.pendingIntakes = await getPendingIntakes(currentSession.user.id);
      dialog.close();
      resetIntakeFlow();
      await loadReceptionOrders();
      showToast(`Recepción guardada · Orden PM-${orderNumber}`);
    } catch (error) {
      console.error('Prisma Motor: no se pudo guardar la recepción.', { code: error?.code, message: error?.message });
      statusMessage.textContent = intakeErrorMessage(error);
      if (queuedRecord) {
        try {
          state.pendingIntakes = await getPendingIntakes(currentSession.user.id);
          if (!navigator.onLine) {
            dialog.close();
            resetIntakeFlow();
            showToast('Recepción protegida en el dispositivo; se sincronizará al volver internet.');
          } else {
            statusMessage.textContent += ' La recepción quedó protegida en este dispositivo; puedes reintentar la sincronización.';
          }
        } catch (queueError) {
          console.error('Prisma Motor: no se pudo verificar la recepción local.', queueError?.message);
        }
      }
    } finally {
      saveButton.disabled = false;
      saveButton.innerHTML = 'Guardar recepción <span aria-hidden="true">✓</span>';
      render();
    }
  }

  let horizontalTouch = null;
  document.addEventListener('touchstart', event => {
    if (event.touches.length !== 1 || event.target.closest('button, input, select, textarea, a, summary')) return;
    const area = event.target.closest(horizontalScrollSelector);
    if (!area || area.scrollWidth <= area.clientWidth) return;
    const touch = event.touches[0];
    horizontalTouch = { area, startX: touch.clientX, startY: touch.clientY, startScroll: area.scrollLeft, moved: false };
  }, { passive: true });
  document.addEventListener('touchmove', event => {
    if (!horizontalTouch || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const deltaX = touch.clientX - horizontalTouch.startX;
    const deltaY = touch.clientY - horizontalTouch.startY;
    if (Math.abs(deltaX) < 6 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    horizontalTouch.moved = true;
    horizontalTouch.area.scrollLeft = horizontalTouch.startScroll - deltaX;
    event.preventDefault();
  }, { passive: false });
  const finishHorizontalTouch = () => { horizontalTouch = null; };
  document.addEventListener('touchend', finishHorizontalTouch, { passive: true });
  document.addEventListener('touchcancel', finishHorizontalTouch, { passive: true });
  let horizontalDrag = null;
  const horizontalScrollSelector = '.inventory-stock-table-wrap, .inventory-movement-table-wrap, .inventory-rate-table-wrap, .inventory-entry-table-wrap, .team-table-scroll, .owner-subnav, .owner-time-chart';
  document.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.pointerType !== 'mouse' || event.target.closest('button, input, select, textarea, a, summary')) return;
    const area = event.target.closest(horizontalScrollSelector);
    if (!area || area.scrollWidth <= area.clientWidth) return;
    horizontalDrag = { area, startX: event.clientX, startScroll: area.scrollLeft, moved: false };
  });
  document.addEventListener('pointermove', event => {
    if (!horizontalDrag) return;
    const deltaX = event.clientX - horizontalDrag.startX;
    if (!horizontalDrag.moved && Math.abs(deltaX) < 5) return;
    horizontalDrag.moved = true;
    horizontalDrag.area.classList.add('is-horizontal-dragging');
    horizontalDrag.area.scrollLeft = horizontalDrag.startScroll - deltaX;
    event.preventDefault();
  }, { passive: false });
  const finishHorizontalDrag = () => {
    if (!horizontalDrag) return;
    const { area, moved } = horizontalDrag;
    area.classList.remove('is-horizontal-dragging');
    if (moved) area.dataset.horizontalDragged = 'true';
    horizontalDrag = null;
  };
  document.addEventListener('pointerup', finishHorizontalDrag);
  document.addEventListener('pointercancel', finishHorizontalDrag);
  document.addEventListener('click', event => {
    const area = event.target.closest(horizontalScrollSelector);
    if (area?.dataset.horizontalDragged === 'true') {
      delete area.dataset.horizontalDragged;
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);
  document.addEventListener('submit', event => {
    if (event.target.matches('[data-technician-progress-form]')) {
      event.preventDefault();
      saveTechnicianProgress(event.target);
      return;
    }
    if (event.target.matches('[data-team-invite-form]')) {
      event.preventDefault();
      inviteTeamMember(event.target);
      return;
    }
    if (event.target.matches('[data-inventory-product-form]')) { event.preventDefault(); saveInventoryProduct(event.target); }
    if (event.target.matches('[data-inventory-movement-form]')) { event.preventDefault(); saveInventoryMovement(event.target); }
    if (event.target.matches('[data-owner-payment-form]')) { event.preventDefault(); saveOwnerPayment(event.target); }
    if (event.target.matches('[data-owner-rate-form]')) { event.preventDefault(); saveOwnerRates(event.target); }
    if (event.target.matches('[data-inventory-work-order]')) {
      const orderId = event.target.value;
      const itemSelect = event.target.form.querySelector('[data-inventory-estimate-item]');
      if (itemSelect) [...itemSelect.options].forEach(option => { option.hidden = Boolean(option.value && option.dataset.orderId !== orderId); if (option.value && option.dataset.orderId !== orderId && option.selected) itemSelect.value = ''; });
    }
  });

  document.querySelector('#intakeForm').addEventListener('submit', saveReceptionOrder);
  window.addEventListener('online', syncPendingIntakes);

  const publicQuoteToken = new URLSearchParams(location.search).get('quote') || new URLSearchParams(location.hash.slice(1)).get('quote');
  if (publicQuoteToken) loadClientQuotePortal(publicQuoteToken);
  else initializeAuth();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js?v=74'));
})();
