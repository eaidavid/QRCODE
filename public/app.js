const form = document.querySelector('#deposit-form');
const submitButton = document.querySelector('#submit-button');
const resetButton = document.querySelector('#reset-button');
const copyButton = document.querySelector('#copy-button');
const logoutButton = document.querySelector('#logout-button');
const accountBadge = document.querySelector('#account-badge');
const feedback = document.querySelector('#feedback');
const qrStage = document.querySelector('#qr-stage');
const paymentCode = document.querySelector('#payment-code');
const cardTitle = document.querySelector('#card-title');

const paymentReference = document.querySelector('#payment-reference');
const paymentStatus = document.querySelector('#payment-status');
const paymentAmount = document.querySelector('#payment-amount');
const paymentCreated = document.querySelector('#payment-created');

const step1 = document.querySelector('#step-1');
const step2 = document.querySelector('#step-2');
const step3 = document.querySelector('#step-3');

let pollTimer = null;

form.addEventListener('submit', handleSubmit);
resetButton.addEventListener('click', resetView);
copyButton.addEventListener('click', copyCode);
logoutButton?.addEventListener('click', logout);

loadSession();

function getPayload() {
  const data = new FormData(form);

  return {
    amount: data.get('amount')?.toString().trim()
  };
}

async function handleSubmit(event) {
  event.preventDefault();
  stopPolling();
  setLoading(true);
  setFeedback('Gerando o codigo...', 'warning');

  try {
    const response = await fetch('/checkout/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(getPayload())
    });

    const payload = await response.json();

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    if (!response.ok || !payload.success) {
      throw new Error(payload.error?.message || 'Nao foi possivel criar o codigo.');
    }

    applyPayment(payload.data);
    startPollingIfNeeded(payload.data);
    setFeedback('Codigo gerado com sucesso. Aguarde a confirmacao do pagamento.', 'success');
  } catch (error) {
    resetPaymentData();
    setFeedback(error.message, 'error');
  } finally {
    setLoading(false);
  }
}

function applyPayment(payment) {
  cardTitle.textContent = getCardTitle(payment.state);
  paymentReference.textContent = shortId(payment.reference);
  paymentStatus.textContent = formatStatus(payment.state);
  paymentAmount.textContent = payment.amountFormatted || '-';
  paymentCreated.textContent = formatDateTime(payment.createdAt);
  paymentCode.value = payment.code || '';
  copyButton.disabled = !payment.code;

  renderQrCode(payment.image);
  paintSteps(payment.state);
}

function renderQrCode(imageSrc) {
  if (!imageSrc) {
    qrStage.innerHTML = `
      <div class="qr-placeholder">
        <span>Codigo</span>
        <p>A imagem nao ficou disponivel para esta cobranca.</p>
      </div>
    `;
    return;
  }

  qrStage.innerHTML = `
    <div class="qr-content">
      <span class="qr-caption">Escaneie para pagar</span>
      <img src="${imageSrc}" alt="Codigo de pagamento" />
    </div>
  `;
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
      const response = await fetch(`/checkout/status/${encodeURIComponent(payment.reference)}`);
      const payload = await response.json();

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      if (!response.ok || !payload.success) {
        throw new Error(payload.error?.message || 'Falha ao atualizar o status.');
      }

      applyPayment(payload.data);

      if (!['pending', 'processing'].includes(String(payload.data.state).toLowerCase())) {
        stopPolling();
      }

      if (String(payload.data.state).toLowerCase() === 'paid') {
        setFeedback('Pagamento confirmado com sucesso.', 'success');
      }
    } catch (error) {
      stopPolling();
      setFeedback(error.message, 'error');
    }
  }, 5000);
}

async function loadSession() {
  try {
    const response = await fetch('/auth/session');
    const payload = await response.json();

    if (!response.ok || !payload.success) {
      window.location.href = '/login';
      return;
    }

    accountBadge.textContent = payload.data?.label || payload.data?.login || 'Acesso liberado';
  } catch {
    window.location.href = '/login';
  }
}

async function logout() {
  logoutButton.disabled = true;

  try {
    await fetch('/auth/logout', { method: 'POST' });
  } finally {
    window.location.href = '/login';
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
    setFeedback('Codigo copiado.', 'success');
  } catch {
    setFeedback('Nao foi possivel copiar automaticamente. Copie manualmente o codigo.', 'warning');
  }
}

function resetView() {
  stopPolling();
  form.reset();
  resetPaymentData();
  setFeedback('Informe um valor para continuar.', '');
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

function setLoading(isLoading) {
  submitButton.disabled = isLoading;
  submitButton.textContent = isLoading ? 'Gerando...' : 'Gerar codigo';
}

function setFeedback(message, type) {
  feedback.textContent = message;
  feedback.className = `feedback${type ? ` ${type}` : ''}`;
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

function getCardTitle(state) {
  return String(state).toLowerCase() === 'paid' ? 'Pagamento confirmado' : 'Pagamento em aberto';
}

resetPaymentData();
