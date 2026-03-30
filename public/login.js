const form = document.querySelector('#login-form');
const button = document.querySelector('#login-button');
const feedback = document.querySelector('#login-feedback');

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
        'Content-Type': 'application/json'
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
