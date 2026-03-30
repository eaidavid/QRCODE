# n8n + Postgres + WhatsApp

Melhor escolha para seguir agora: `PostgreSQL`.

Motivos:

- confiavel para producao
- facil de conectar no `n8n`
- simples para buscar pendentes, atualizar pagos e auditar tudo
- combina bem com varios provedores de WhatsApp

## Ordem recomendada

1. criar a tabela no Postgres usando `n8n/04-postgres-schema.sql`
2. ajustar o fluxo `01` para salvar a cobranca criada
3. ajustar o fluxo `02` para atualizar status quando o webhook confirmar
4. ajustar o fluxo `03` para reconsultar apenas pendentes do WhatsApp
5. so depois ligar o provedor real do WhatsApp

## Fluxo 01 - salvar no banco

Depois do node `Montar Resposta PIX`, adicione um node `Postgres` com operacao `Insert`.

Mapeamento recomendado:

- `channel` -> `whatsapp`
- `group_id` -> `{{$json.groupId}}`
- `user_id` -> `{{$json.userId}}`
- `user_name` -> `{{$json.userName}}`
- `phone` -> `{{$json.phone}}`
- `operator_login` -> `operador19` ou `{{$('Normalizar Mensagem').first().json.operatorLogin}}`
- `external_id` -> `{{$json.externalId}}`
- `reference` -> `{{$json.reference}}`
- `amount_formatted` -> `{{$json.amount}}`
- `code` -> `{{$json.code}}`
- `image` -> `{{$json.image}}`
- `reply_text` -> `{{$json.replyText}}`
- `status` -> `pending`
- `metadata` -> JSON com a mensagem original

Ligue:

- `Montar Resposta PIX` -> `Salvar Cobranca Postgres` -> `Responder Webhook`

## Fluxo 02 - atualizar pago

No fluxo `02`, depois do node `Montar Confirmacao`, adicione um node `Postgres` com operacao `Update`.

Filtro:

- `reference = {{$json.reference}}`

Campos:

- `status` -> `paid`
- `paid_at` -> `{{$now}}`
- `reply_text` -> `{{$json.replyText}}`
- `webhook_payload` -> `{{$json.charge}}`

Ligue:

- `Montar Confirmacao` -> `Atualizar Pago Postgres` -> `Responder Webhook1`

## Fluxo 03 - buscar pendentes reais

Substitua o node `Carregar Pendentes` por um node `Postgres` com operacao `Select`.

SQL:

```sql
select reference
from whatsapp_pix_transactions
where status = 'pending'
  and channel = 'whatsapp'
order by created_at asc
limit 100;
```

Depois do `Select`, use um node `Code` para transformar em array compativel com o `Split Out`:

```javascript
return [{
  json: {
    pendingReferences: $input.all().map((item) => item.json.reference).filter(Boolean)
  }
}];
```

No final do ramo `true` do node `Ja Pagou?`, adicione um `Postgres Update`:

- filtro: `reference = {{$json.data.reference}}`
- `status` -> `paid`
- `paid_at` -> `{{$now}}`

## O que isso resolve

- so consulta cobrancas que vieram do WhatsApp
- nao mistura com cobrancas do painel
- mantem o extrato do painel funcionando porque a cobranca continua sendo criada pelo seu backend
- permite auditoria completa do bot

## Ponto final antes do WhatsApp

Quando os 3 fluxos estiverem conectados ao Postgres, voce estara pronto para integrar o canal real do WhatsApp.

Nessa etapa, o que faltara sera apenas:

- trocar o `Webhook Entrada` pela entrada do provedor WhatsApp
- trocar o retorno JSON por envio real de mensagem
- usar o numero/grupo real do provedor
