const form = document.querySelector('#login-form');
const button = document.querySelector('#login-button');
const feedback = document.querySelector('#login-feedback');
const clientInstanceId = getClientInstanceId();

form.addEventListener('submit', handleLogin);

async function handleLogin(event) {
  event.preventDefault();
  setLoading(true);
  setFeedback('Validando acesso...', 'warning');

  const formData = new FormData(form);
  const payload = {
    login: String(formData.get('login') || '').trim(),
    password: String(formData.get('password') || '')
  };

  try {
    const response = await fetch('/auth/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Instance': clientInstanceId
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    if (!response.ok || !result.success) {
      throw new Error(result.error?.message || 'Nao foi possivel entrar.');
    }

    setFeedback('Acesso liberado. Redirecionando...', 'success');
    window.location.href = result.data?.redirectTo || '/painel';
  } catch (error) {
    setFeedback(error.message, 'error');
  } finally {
    setLoading(false);
  }
}

function setLoading(isLoading) {
  button.disabled = isLoading;
  button.textContent = isLoading ? 'Entrando...' : 'Entrar';
}

function setFeedback(message, type) {
  feedback.textContent = message;
  feedback.className = `feedback${type ? ` ${type}` : ''}`;
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
