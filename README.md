# Pagamento Instantaneo

Painel em Node.js com login obrigatorio para gerar cobrancas por QR Code.

## O que foi implementado

- Tela de login em `views/login.html`
- Painel protegido em `views/checkout.html`
- Sessao com cookie `httpOnly` e vencimento automatico
- Usuarios cadastrados somente em codigo em `data/accounts.js`
- Campo publico apenas para valor
- Dados ocultos por usuario, com fallback no `.env`
- Geracao local da imagem quando o servico retornar apenas o codigo para copiar

## Como cadastrar usuarios

1. Gere a senha com hash:

```bash
npm run hash-password -- "sua-senha"
```

2. Adicione o usuario em `data/accounts.js`:

```js
{
  id: 'op-002',
  login: 'operador02',
  label: 'Operador 02',
  passwordHash: 'hash-gerado-aqui',
  active: true,
  profile: {
    name: 'Nome Oculto',
    email: 'email@exemplo.com',
    phone: '11999999999',
    documentType: 'cpf',
    documentNumber: '12345678901',
    title: 'Pagamento'
  }
}
```

## Como rodar

1. Instale as dependencias:

```bash
npm install
```

2. Copie o arquivo de ambiente:

```bash
copy .env.example .env
```

3. Preencha o `.env`:

```env
PORT=3000
APP_MODE=sandbox
APP_URL=https://01pix.com
APP_SECRET=troque_este_segredo_longo
AUTOMATION_TOKEN=token_forte_para_n8n
ACCESS_KEY=sua_chave_aqui
WEBHOOK_SECRET=defina_um_segredo_no_dashboard
RETURN_URL=
REMOTE_URL=
HOLDER_NAME=Cliente Padrao
HOLDER_MAIL=cliente@exemplo.com
HOLDER_PHONE=11999999999
HOLDER_DOC_KIND=cpf
HOLDER_DOC_ID=12345678901
ITEM_NAME=Pagamento
```

Se `RETURN_URL` ficar vazio, o sistema usa automaticamente `https://01pix.com/return/notify` quando `APP_URL=https://01pix.com`.

## Automacao com n8n

Use `AUTOMATION_TOKEN` para integrar com bot, WhatsApp e fluxos no n8n sem depender do login do painel.

- `POST /api/automation/create-charge`
- `GET /api/automation/status/:reference`
- Header obrigatorio: `Authorization: Bearer SEU_TOKEN`

Exemplo de criacao:

```bash
curl -X POST "http://localhost:3000/api/automation/create-charge" \
  -H "Authorization: Bearer SEU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "operatorLogin": "operador01",
    "amount": "150,00",
    "customerName": "Cliente WhatsApp",
    "customerPhone": "5511999999999",
    "externalId": "pedido-123",
    "note": "Pedido vindo do n8n"
  }'
```

Campos principais da resposta:

- `reference`: referencia interna da cobranca
- `code`: codigo PIX copia-e-cola
- `image`: QR Code em data URL
- `message`: texto pronto para enviar no WhatsApp
- `operator`: operador dono da cobranca

4. Inicie o projeto:

```bash
npm run dev
```

5. Abra `http://localhost:3000`

## Webhook

- URL final para cadastrar: `https://01pix.com/return/notify`
- A rota aceita `POST` e tambem responde em `GET` para teste rapido
- Se voce configurar secret no dashboard, use o mesmo valor em `WEBHOOK_SECRET`
- Eventos duplicados sao ignorados por `eventId`
- O status recebido fica em memoria para ajudar o painel quando a consulta externa falhar

## Arquivos principais

- `server.js`: autenticacao, sessao e integracao do servidor
- `data/accounts.js`: usuarios liberados e dados ocultos por login
- `lib/password.js`: hash e validacao de senha
- `scripts/hash-password.js`: gerador de hash
- `views/login.html`: tela de acesso
- `views/checkout.html`: painel interno
- `public/app.js`: interacao do painel
- `public/login.js`: envio do login
