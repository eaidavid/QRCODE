const form = document.querySelector('#deposit-form');
const submitButton = document.querySelector('#submit-button');
const resetButton = document.querySelector('#reset-button');
const copyButton = document.querySelector('#copy-button');
const logoutButton = document.querySelector('#logout-button');
const refreshStatementButton = document.querySelector('#refresh-statement-button');
const clearFiltersButton = document.querySelector('#clear-filters-button');
const accountBadge = document.querySelector('#account-badge');
const toast = document.querySelector('#toast');
const qrStage = document.querySelector('#qr-stage');
const paymentCode = document.querySelector('#payment-code');
const cardTitle = document.querySelector('#card-title');
const statementList = document.querySelector('#statement-list');
const statementTotalGenerated = document.querySelector('#statement-total-generated');
const statementTotalPaid = document.querySelector('#statement-total-paid');
const statementTotalCount = document.querySelector('#statement-total-count');
const statementPaidCount = document.querySelector('#statement-paid-count');
const statementFiltersForm = document.querySelector('#statement-filters');
const panelTabs = [...document.querySelectorAll('.panel-tab')];
const panelViews = [...document.querySelectorAll('.panel-view')];
const statementQrModal = document.querySelector('#statement-qr-modal');
const closeQrModalButton = document.querySelector('#close-qr-modal-button');
const statementQrStage = document.querySelector('#statement-qr-stage');
const statementQrTitle = document.querySelector('#statement-qr-title');
const statementQrReference = document.querySelector('#statement-qr-reference');
const statementQrStatus = document.querySelector('#statement-qr-status');
const statementQrAmount = document.querySelector('#statement-qr-amount');
const statementQrCreated = document.querySelector('#statement-qr-created');
const statementQrCode = document.querySelector('#statement-qr-code');
const statementCopyButton = document.querySelector('#statement-copy-button');
const clientInstanceId = getClientInstanceId();

const paymentReference = document.querySelector('#payment-reference');
const paymentFullReference = document.querySelector('#payment-full-reference');
const paymentStatus = document.querySelector('#payment-status');
const paymentAmount = document.querySelector('#payment-amount');
const paymentCreated = document.querySelector('#payment-created');

const step1 = document.querySelector('#step-1');
const step2 = document.querySelector('#step-2');
const step3 = document.querySelector('#step-3');

let pollTimer = null;
let toastTimer = null;
let currentStatementItems = [];
let sessionHeartbeatTimer = null;

form.addEventListener('submit', handleSubmit);
submitButton.addEventListener('click', handleSubmit);
resetButton.addEventListener('click', resetView);
copyButton.addEventListener('click', copyCode);
logoutButton?.addEventListener('click', logout);
refreshStatementButton?.addEventListener('click', loadStatement);
statementFiltersForm?.addEventListener('submit', handleStatementFilterSubmit);
clearFiltersButton?.addEventListener('click', clearStatementFilters);
panelTabs.forEach((tab) => tab.addEventListener('click', () => setActivePanel(tab.dataset.panel)));
statementList?.addEventListener('click', handleStatementListClick);
closeQrModalButton?.addEventListener('click', closeStatementQrModal);
statementQrModal?.addEventListener('click', handleQrModalBackdropClick);
statementCopyButton?.addEventListener('click', copyStatementCode);
window.addEventListener('keydown', handleWindowKeydown);

loadSession();
loadStatement();
setActivePanel('deposit');
startSessionHeartbeat();

function getPayload() {
  const data = new FormData(form);

  return {
    amount: data.get('amount')?.toString().trim()
  };
}

async function handleSubmit(event) {
  event?.preventDefault();

  if (!form.reportValidity()) {
    return;
  }

  stopPolling();
  setLoading(true);
  showToast('Gerando o QR Code...', 'warning');

  try {
    const response = await fetch('/checkout/create', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Instance': clientInstanceId
      },
      body: JSON.stringify(getPayload())
    });

    const payload = await response.json();

    if (response.status === 401) {
      resetPaymentData();
      showToast('Sua sessao expirou. Faca login novamente.', 'error');
      window.setTimeout(() => {
        window.location.href = '/login';
      }, 1200);
      return;
    }

    if (!response.ok || !payload.success) {
      throw new Error(payload.error?.message || 'Nao foi possivel criar o codigo.');
    }

    if (!hasQrPayload(payload.data)) {
      throw new Error('A cobranca foi criada, mas o gateway nao retornou QR Code nem codigo copia e cola.');
    }

    applyPayment(payload.data);
    startPollingIfNeeded(payload.data);
    loadStatement();
    showToast('QR Code gerado com sucesso. Aguarde a confirmacao do pagamento.', 'success');
  } catch (error) {
    resetPaymentData();
    showToast(error.message, 'error');
  } finally {
    setLoading(false);
  }
}

function applyPayment(payment) {
  cardTitle.textContent = getCardTitle(payment.state);
  paymentReference.textContent = getShortTransactionId(payment.reference);
  paymentFullReference.textContent = payment.reference || '-';
  paymentStatus.textContent = formatStatus(payment.state);
  paymentAmount.textContent = payment.amountFormatted || '-';
  paymentCreated.textContent = formatDateTime(payment.createdAt);
  paymentCode.value = payment.code || '';
  copyButton.disabled = !payment.code;

  renderQrCode(payment.image, payment);
  paintSteps(payment.state);
}

function renderQrCode(imageSrc, payment = null) {
  if (!imageSrc) {
    qrStage.innerHTML = `
      <div class="qr-placeholder">
        <span>Codigo</span>
        <p>A imagem nao ficou disponivel para esta cobranca.</p>
      </div>
    `;

    if (payment?.code) {
      showToast('QR visual indisponivel no momento. Use o codigo copia e cola desta cobranca.', 'warning');
    }

    return;
  }

  qrStage.innerHTML = `
    <div class="qr-content">
      <span class="qr-caption">Escaneie para pagar</span>
      <img src="${imageSrc}" alt="Codigo de pagamento" />
    </div>
  `;
}

function hasQrPayload(payment) {
  return Boolean(payment?.image || payment?.code);
}

function paintSteps(state) {
  const rows = [...document.querySelectorAll('.status-row')];
  rows.forEach((row) => row.classList.remove('active', 'done'));

  const normalized = String(state || '').toLowerCase();
  const row1 = document.querySelector('[data-step="1"]');
  const row2 = document.querySelector('[data-step="2"]');
  const row3 = document.querySelector('[data-step="3"]');

  step1.textContent = normalized === 'pending' ? 'Gerado' : normalized ? formatStatus(normalized) : 'Pendente';
  step2.textContent = normalized === 'processing' ? 'Em andamento' : normalized === 'paid' ? 'Concluido' : 'Aguardando';
  step3.textContent = normalized === 'paid' ? 'Recebido' : '-';

  row1.classList.add('done');

  if (['processing', 'paid'].includes(normalized)) {
    row2.classList.add(normalized === 'paid' ? 'done' : 'active');
  } else {
    row2.classList.add('active');
  }

  if (normalized === 'paid') {
    row3.classList.add('done');
  }
}

function startPollingIfNeeded(payment) {
  if (!payment?.reference) {
    return;
  }

  if (!['pending', 'processing'].includes(String(payment.state).toLowerCase())) {
    return;
  }

  stopPolling();

  pollTimer = window.setInterval(async () => {
    try {
      const response = await fetch(`/checkout/status/${encodeURIComponent(payment.reference)}`, {
        credentials: 'same-origin',
        headers: {
          'X-Client-Instance': clientInstanceId
        }
      });
      const payload = await response.json();

      if (response.status === 401) {
        showToast('Sua sessao expirou. Faca login novamente.', 'error');
        window.setTimeout(() => {
          window.location.href = '/login';
        }, 1200);
        return;
      }

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || 'Falha ao atualizar o status.');
      }

      applyPayment(payload.data);
      loadStatement(true);

      if (!['pending', 'processing'].includes(String(payload.data.state).toLowerCase())) {
        stopPolling();
      }

      if (String(payload.data.state).toLowerCase() === 'paid') {
        showToast('Pagamento confirmado com sucesso.', 'success');
      }
    } catch (error) {
      stopPolling();
      showToast(error.message, 'error');
    }
  }, 5000);
}

async function loadSession() {
  try {
    const response = await fetch('/auth/session', {
      credentials: 'same-origin',
      headers: {
        'X-Client-Instance': clientInstanceId
      }
    });
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      stopSessionHeartbeat();
      window.location.href = '/login';
      return;
    }

    accountBadge.textContent = payload.data?.label || payload.data?.login || 'Acesso liberado';
  } catch {
    stopSessionHeartbeat();
    window.location.href = '/login';
  }
}

async function loadStatement(silent = false) {
  try {
    if (refreshStatementButton) {
      refreshStatementButton.disabled = true;
    }

    const response = await fetch(`/checkout/statement${buildStatementQuery()}`, {
      credentials: 'same-origin',
      headers: {
        'X-Client-Instance': clientInstanceId
      }
    });
    const payload = await response.json();

    if (response.status === 401) {
      if (!silent) {
        showToast('Sua sessao expirou. Faca login novamente.', 'error');
      }
      return;
    }

    if (!response.ok || !payload.success) {
      throw new Error(payload.error?.message || 'Nao foi possivel carregar o extrato.');
    }

    renderStatement(payload.data);
  } catch (error) {
    if (!silent) {
      showToast(error.message, 'error');
    }
  } finally {
    if (refreshStatementButton) {
      refreshStatementButton.disabled = false;
    }
  }
}

function handleStatementFilterSubmit(event) {
  event.preventDefault();
  loadStatement();
}

function clearStatementFilters() {
  statementFiltersForm?.reset();
  loadStatement();
}

function setActivePanel(panel) {
  panelTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.panel === panel));
  panelViews.forEach((view) => view.classList.toggle('active', view.dataset.panelView === panel));

  if (panel === 'statement') {
    loadStatement(true);
  }
}

async function logout() {
  logoutButton.disabled = true;
  stopSessionHeartbeat();
  stopPolling();

  try {
    await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'X-Client-Instance': clientInstanceId
      }
    });
  } finally {
    window.location.href = '/login';
  }
}

function startSessionHeartbeat() {
  stopSessionHeartbeat();

  sessionHeartbeatTimer = window.setInterval(async () => {
    try {
      const response = await fetch('/auth/session', {
        credentials: 'same-origin',
        headers: {
          'X-Client-Instance': clientInstanceId
        }
      });

      if (response.status === 401) {
        stopSessionHeartbeat();
        stopPolling();
        showToast('Sua conta entrou em outro dispositivo. Esta sessao foi encerrada.', 'error');
        window.setTimeout(() => {
          window.location.href = '/login';
        }, 1200);
      }
    } catch {
      // ignore transient network issues
    }
  }, 3000);
}

function stopSessionHeartbeat() {
  if (sessionHeartbeatTimer) {
    window.clearInterval(sessionHeartbeatTimer);
    sessionHeartbeatTimer = null;
  }
}

function stopPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function copyCode() {
  if (!paymentCode.value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(paymentCode.value);
    showToast('Codigo copiado.', 'success');
  } catch {
    showToast('Nao foi possivel copiar automaticamente. Copie manualmente o codigo.', 'warning');
  }
}

function resetView() {
  stopPolling();
  form.reset();
  resetPaymentData();
  showToast('Formulario limpo. Informe um valor para continuar.', 'warning');
}

function resetPaymentData() {
  cardTitle.textContent = 'Aguardando valor';
  paymentReference.textContent = '-';
  paymentStatus.textContent = '-';
  paymentAmount.textContent = '-';
  paymentCreated.textContent = '-';
  paymentCode.value = '';
  copyButton.disabled = true;
  step1.textContent = 'Pendente';
  step2.textContent = '-';
  step3.textContent = '-';

  document.querySelectorAll('.status-row').forEach((row, index) => {
    row.classList.remove('done', 'active');
    if (index === 0) {
      row.classList.add('active');
    }
  });

  qrStage.innerHTML = `
    <div class="qr-placeholder">
      <span>Codigo</span>
      <p>Informe o valor para gerar o pagamento.</p>
    </div>
  `;
}

function showToast(message, type) {
  if (!toast) {
    return;
  }

  if (toastTimer) {
    window.clearTimeout(toastTimer);
  }

  toast.textContent = message;
  toast.className = `toast show${type ? ` ${type}` : ''}`;

  toastTimer = window.setTimeout(() => {
    toast.className = 'toast';
  }, 3600);
}

function renderStatement(data) {
  const items = Array.isArray(data?.items) ? data.items : [];
  currentStatementItems = items;
  const summary = data?.summary || {};

  statementTotalGenerated.textContent = formatCents(summary.totalGeneratedCents || 0);
  statementTotalPaid.textContent = formatCents(summary.totalPaidCents || 0);
  statementTotalCount.textContent = String(summary.totalCount || 0);
  statementPaidCount.textContent = String(summary.paidCount || 0);

  if (!items.length) {
    statementList.innerHTML = '<div class="statement-empty">Nenhum deposito registrado para este operador ainda.</div>';
    return;
  }

  statementList.innerHTML = items
    .map(
      (item) => `
        <article class="statement-item">
          <div>
            <strong>${item.amountFormatted || formatCents(item.amountCents || 0)}</strong>
            <span>${formatStatus(item.state)} - ${formatDateTime(item.createdAt)}</span>
            ${item.source === 'bot' ? '<span class="statement-tag bot">Bot</span>' : ''}
          </div>
          <div class="statement-meta">
            <span>ID: ${getShortTransactionId(item.reference)}</span>
            <span>${item.accountLabel || item.accountLogin || '-'}</span>
            <button class="ghost-button statement-open-button" type="button" data-reference="${escapeHtmlAttribute(item.reference || '')}">Ver QR</button>
          </div>
        </article>
      `
    )
    .join('');
}

function buildStatementQuery() {
  const formData = new FormData(statementFiltersForm);
  const params = new URLSearchParams();

  for (const [key, value] of formData.entries()) {
    const normalized = String(value || '').trim();
    if (normalized) {
      params.set(key, normalized);
    }
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? 'Gerando...' : 'Gerar QR Code';
}

function formatStatus(status) {
  const labels = {
    pending: 'Aguardando pagamento',
    processing: 'Processando',
    paid: 'Pago',
    failed: 'Falhou',
    cancelled: 'Cancelado',
    blocked: 'Bloqueado',
    refunded: 'Estornado',
    pre_chargeback: 'Em disputa',
    chargeback: 'Em disputa'
  };

  return labels[String(status).toLowerCase()] || status || '-';
}

function formatCents(value) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format((Number(value) || 0) / 100);
}

function formatDateTime(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '-';
  }

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function shortId(value) {
  if (!value) {
    return '-';
  }

  return value.length > 18 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function getShortTransactionId(reference) {
  const value = String(reference || '').trim();

  if (!value) {
    return '-';
  }

  return value.slice(-8).toUpperCase();
}

function getCardTitle(state) {
  return String(state).toLowerCase() === 'paid' ? 'Pagamento confirmado' : 'Pagamento em aberto';
}

function handleStatementListClick(event) {
  const button = event.target.closest('.statement-open-button');

  if (!button) {
    return;
  }

  const reference = button.dataset.reference || '';
  const item = currentStatementItems.find((entry) => entry.reference === reference);

  if (!item) {
    showToast('Nao foi possivel localizar este QR no extrato.', 'error');
    return;
  }

  openStatementQrModal(item);
}

function openStatementQrModal(item) {
  statementQrModal.hidden = false;
  document.body.classList.add('modal-open');
  statementQrTitle.textContent = item.amountFormatted || formatCents(item.amountCents || 0);
  statementQrReference.textContent = getShortTransactionId(item.reference);
  const statementQrFullReference = document.querySelector('#statement-qr-full-reference');
  statementQrFullReference.textContent = item.reference || '-';
  statementQrStatus.textContent = formatStatus(item.state);
  statementQrAmount.textContent = item.amountFormatted || formatCents(item.amountCents || 0);
  statementQrCreated.textContent = formatDateTime(item.createdAt);
  statementQrCode.value = item.code || '';
  statementCopyButton.disabled = !item.code;
  renderStatementQrCode(item.image, item);
}

function closeStatementQrModal() {
  statementQrModal.hidden = true;
  document.body.classList.remove('modal-open');
}

function renderStatementQrCode(imageSrc, item = null) {
  if (!imageSrc) {
    statementQrStage.innerHTML = `
      <div class="qr-placeholder">
        <span>QR Code</span>
        <p>Nenhum QR disponivel para esta cobranca.</p>
      </div>
    `;

    if (item?.code) {
      showToast('Este deposito nao tem imagem de QR disponivel. Use o codigo copia e cola.', 'warning');
    } else {
      showToast('Este deposito nao possui QR Code disponivel.', 'error');
    }

    return;
  }

  statementQrStage.innerHTML = `
    <div class="qr-content">
      <span class="qr-caption">Escaneie para pagar</span>
      <img src="${imageSrc}" alt="QR Code do extrato" />
    </div>
  `;
}

function handleQrModalBackdropClick(event) {
  if (event.target?.dataset?.closeQrModal === 'true') {
    closeStatementQrModal();
  }
}

function handleWindowKeydown(event) {
  if (event.key === 'Escape' && statementQrModal && !statementQrModal.hidden) {
    closeStatementQrModal();
  }
}

async function copyStatementCode() {
  if (!statementQrCode.value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(statementQrCode.value);
    showToast('Codigo do extrato copiado.', 'success');
  } catch {
    showToast('Nao foi possivel copiar automaticamente. Copie manualmente o codigo.', 'warning');
  }
}

function escapeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getClientInstanceId() {
  const existing = window.sessionStorage.getItem('client-instance-id');

  if (existing) {
    return existing;
  }

  const created = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.sessionStorage.setItem('client-instance-id', created);
  return created;
}

resetPaymentData();
