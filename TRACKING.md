# Rastreamento de formulários — GTM server-side + PixelX

Guia de implantação e diagnóstico do evento **Lead**, escrito para ser
**reaproveitado em outros sites** com a mesma stack.

Todo o comportamento da PixelX descrito aqui foi verificado lendo o código-fonte
do `PixelXApp` e do `PxaMask` servidos pelo painel, ou recuperado do histórico
real deste repositório (os commits estão citados). O que é **hipótese a
confirmar** está marcado como tal — não misture os dois ao depurar.

---

## Índice

1. [Leia isto primeiro: os dois modos de falha](#1-leia-isto-primeiro-os-dois-modos-de-falha)
2. [O modelo mental: camada de container × camada de formulário](#2-o-modelo-mental-camada-de-container--camada-de-formulário)
3. [Arquitetura e loaders](#3-arquitetura-e-loaders)
4. [Inventário dos 5 emissores de Lead](#4-inventário-dos-5-emissores-de-lead)
5. [Escolha da arquitetura: Modelo A ou Modelo B](#5-escolha-da-arquitetura-modelo-a-ou-modelo-b)
6. [**Nomenclatura canônica** e identificação dos campos](#6-nomenclatura-canônica-e-identificação-dos-campos) ← **comece por aqui ao replicar**
7. [Defeitos originais corrigidos no CPPEM](#7-defeitos-originais-corrigidos-no-cppem)
8. [Defeitos de replicação: o que quebra ao copiar](#8-defeitos-de-replicação-o-que-quebra-ao-copiar)
9. [Template portável](#9-template-portável)
10. [Protocolo de diagnóstico](#10-protocolo-de-diagnóstico)
11. [Checklist de replicação](#11-checklist-de-replicação)
12. [Tabela sintoma → causa](#12-tabela-sintoma--causa)
13. [O que não dá para controlar pelo site](#13-o-que-não-dá-para-controlar-pelo-site)
14. [Estado atual deste projeto](#14-estado-atual-deste-projeto)

---

## 1. Leia isto primeiro: os dois modos de falha

Os dois problemas relatados ao replicar em outros sites têm causas **opostas**, e
tratar um com a receita do outro piora a situação. Diagnostique antes de mexer.

### Falha A — "só chega pageview e general event, o Lead não valida"

**Causa raiz:** o loader foi trocado corretamente, mas o **vínculo com o
formulário** não. Pageview e general event são disparados no nível do
**container** — funcionam assim que o script carrega, sem saber que existe
formulário. O Lead é disparado no nível do **formulário**, e depende de um
casamento que não sobrevive ao copiar/colar.

O erro mais comum, de longe: **copiar o `id` do `<form>` junto com o HTML.**

```html
<!-- Copiado do CPPEM para outro site — o Lead NUNCA vai disparar -->
<form id="IPEyzyfmJhKQEYIXAlZH">
```

Esse id é o identificador do formulário **dentro da conta CPPEM no painel da
PixelX**. Em outra conta ele não existe, então a regra de Lead não encontra nada
para vincular. O container carrega, o pageview vai, o general event vai — e o
Lead simplesmente não tem gatilho. Ver [§8.1](#81-valores-que-são-específicos-de-cada-site).

Outras causas de Falha A, em ordem de frequência — ver [§8](#8-defeitos-de-replicação-o-que-quebra-ao-copiar):

| # | Causa | Seção |
|---|---|---|
| 1 | 🔴 **Nomenclatura divergente** (`nome` em vez de `lead_name`/`name`, id do painel no botão em vez do `<form>`) | [§6.0](#60--a-nomenclatura-não-é-cosmética--ela-é-o-vínculo) |
| 2 | `id` do `<form>` copiado do site anterior | [§8.1](#81-valores-que-são-específicos-de-cada-site) |
| 3 | Formulário não emite evento `submit` nativo (Elementor, React, AJAX) | [§8.3](#83-formulários-que-não-emitem-submit-nativo) |
| 4 | `stopImmediatePropagation()` matando submits válidos | [§8.4](#84-a-barreira-de-validação-matando-o-lead) |
| 5 | `pixel_x_app` ainda não pronto quando o Lead é disparado | [§8.5](#85-corrida-com-o-start-assíncrono) |
| 6 | Campos sem `name`, PixelX sem dados do lead | [§6.1](#61-como-a-pixelx-identifica-os-campos) |

> **Variante que engana:** se o **GTM recebe o Lead mas o Meta não recebe nada**,
> e a máscara de telefone funciona (prova de que a PixelX carregou), a causa é
> quase sempre a nº 1 — nomenclatura. Ver [§8.8](#88-caso-manychat-nomenclatura-divergente).

### Falha B — "o Lead duplica ou triplica"

**Causa raiz:** mais de um emissor de Lead ativo ao mesmo tempo, cada um
instalado em um momento diferente, por uma pessoa diferente, em uma camada
diferente — e nenhum deles sabe da existência dos outros.

Isto **não é hipótese**: este repositório já teve, em commits distintos, cinco
mecanismos capazes de disparar Lead. Em [§4](#4-inventário-dos-5-emissores-de-lead)
estão todos, com o commit onde cada um aparece. Duplicar exige dois ativos;
triplicar exige três — e é fácil chegar a três sem perceber, porque dois deles
são invisíveis no código do site (moram no painel).

> **A regra que resolve:** deve existir **exatamente um** emissor de Lead. Antes
> de adicionar qualquer coisa, faça o inventário de [§10.3](#103-auditoria-de-emissores-duplicados)
> e desligue todos menos um.

---

## 2. O modelo mental: camada de container × camada de formulário

Interiorizar esta separação resolve a maior parte dos diagnósticos.

```text
┌─ CAMADA DE CONTAINER ──────────────────────────────────────┐
│  Loader GTM/PixelX no <head>                               │
│  • pageview          ← dispara só de carregar a página     │
│  • general event     ← idem                                │
│  Depende de: domínio + path do loader corretos             │
└────────────────────────────────────────────────────────────┘
                          ↓  independentes
┌─ CAMADA DE FORMULÁRIO ─────────────────────────────────────┐
│  Regra de Lead vinculada a um formulário específico        │
│  • Lead                                                    │
│  Depende de: id do form ↔ painel, name dos campos,         │
│              evento submit nativo existir, pixel pronto    │
└────────────────────────────────────────────────────────────┘
```

**A consequência prática, que é o diagnóstico da Falha A:**

| O que chega no painel | O que isso prova |
|---|---|
| Nada, nem pageview | Loader errado, bloqueado ou não instalado — problema de container |
| Pageview e general event, sem Lead | **Container OK. O problema está 100% na camada de formulário** |
| Lead chegando N vezes | Container OK, formulário OK, **N emissores ativos** |

Se você vê pageview, pare de mexer no loader, no domínio e no GTM. O loader está
certo. O problema é o vínculo com o formulário — vá direto para [§8](#8-defeitos-de-replicação-o-que-quebra-ao-copiar).

---

## 3. Arquitetura e loaders

Três camadas independentes que se sobrepõem no mesmo formulário:

| Camada | Onde vive | O que faz |
|---|---|---|
| **GTM server-side** | `<head>`, loader first-party | Container sGTM próprio. No CPPEM: `https://sgtm.cppem.com.br/metrics/` |
| **PixelX** | `window.pixel_x_app`, carregada pelo GTM | Captura dados do lead, aplica máscara, dispara eventos de conversão |
| **`script.js` do site** | Bottom do `<body>` | Validação, mensagem de sucesso, redirecionamento |

O ponto central de todo o trabalho: **a PixelX se engancha no evento `submit`
nativo do formulário.** Qualquer coisa que impeça esse evento de existir, ou que
o deixe passar cedo demais, quebra o rastreamento — silenciosamente.

### 3.1 Loader do GTM server-side

```html
<script>(function(w,d,s,l){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'?l='+l:'';j.async=true;j.src=
'https://sgtm.cppem.com.br/metrics/'+dl;f.parentNode.insertBefore(j,f);})
(window,document,'script','dataLayer');</script>
```

Note que **não há parâmetro `id=GTM-XXXX`** — o ID do container está embutido no
path do loader server-side (`/metrics/`). Ao replicar em outro site, troque o
domínio e o path pelos do container daquele cliente.

### 3.2 Existem DOIS jeitos de a PixelX entrar na página

Esta é uma armadilha real deste repositório. Além de ser carregada por uma tag
dentro do GTM, a PixelX tem um **loader direto**, que já esteve no `<head>` do
`index.html` (commits `2c06396`, `033be5c`, removido em `2d3fe0f`):

```html
<!-- Loader DIRETO da PixelX — coexistiu com o carregamento via GTM -->
<script type='text/javascript'>
!function(){var e=window.location.href,t=document.title,n=Date.now(),
o=document.createElement('script');o.src='https://pxa.cppem.com.br/remote?url='
+encodeURIComponent(e)+'&title='+encodeURIComponent(t)+'&time='+n,
o.async=!0,document.head.appendChild(o)}()
</script>
```

**Se os dois estiverem presentes, a PixelX é instanciada duas vezes e cada evento
é contado em dobro — inclusive o Lead.** É a causa de duplicação mais difícil de
enxergar, porque um dos loaders está no HTML e o outro está escondido dentro de
uma tag do GTM, que ninguém abre.

Ver o teste de detecção em [§10.2](#102-detectar-pixelx-carregada-duas-vezes).

### 3.3 O `noscript` do GTM

```html
<noscript><iframe src="https://sgtm.cppem.com.br/ns.html?id= GTM-PJ379FLQ"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
```

Havia um **espaço espúrio** depois de `id=` neste projeto — **corrigido**. O
`noscript` só afeta visitantes sem JavaScript, então não era a causa de nenhuma
das falhas descritas aqui. Ao copiar para outro site, mantenha `?id=GTM-XXXXXXX`,
sem espaço.

---

## 4. Inventário dos 5 emissores de Lead

Todos os cinco já existiram neste projeto. Ao auditar um site novo, **procure
pelos cinco** — não presuma que o Lead só pode vir de onde você instalou.

### Emissor 1 — Regra de `submit` no painel

Configurada no painel da PixelX, vinculada ao `id` do formulário. Mecanismo do
`monitor_forms_dynamic`: listener de `submit` com debounce de 1500 ms, com guarda
de listener duplicado pela classe `pxa_tracked`.

- **Invisível no código do site.** Só se enxerga abrindo o painel.
- É o emissor que o CPPEM usa hoje.

### Emissor 2 — Regra de clique por classe no painel

Configurada no painel como "conversão ao clicar no elemento com a classe X". A
classe é um hash opaco. Este projeto usou (commit `906004f`):

```js
const PIXELX_CLASS = "xrmmmmzdllmckwinbxuh";

function syncPixelClass() {
  if (submitBtn) submitBtn.classList.toggle(PIXELX_CLASS, isFormValid());
}
```

A ideia era engenhosa — a classe só ficava no botão enquanto o formulário estava
válido, então clicar sem preencher não contava conversão. Mas ela cria um segundo
emissor permanente.

- **Semi-invisível:** no site aparece só como uma string sem significado. Se você
  vir uma classe que parece um hash aleatório em um botão, **é isto**.
- Se a regra de clique e a regra de submit estiverem ambas ativas no painel, um
  único envio dispara **dois** Leads.

### Emissor 3 — `send_event` manual no site

```js
await window.pixel_x_app.send_event({
  event_name: "Lead",
  lead_name:  nome,
  lead_email: email,
  lead_phone: telefone,
});
```

Assinatura verificada nos commits `2c06396`, `8227f51`, `290806f`, `033be5c`,
`a86c8bc`, `6e91e0d`. Removido do CPPEM em `aeb6ced`, justamente por duplicar.

- **Visível no código.** É o mais fácil de auditar: procure `send_event` no site.

### Emissor 4 — Meta Pixel disparando Lead por conta própria

```js
fbq("track", "Lead", { content_name: "captura_cppem", page_url: location.href });
```

Presente no commit `2c06396`, junto com o Emissor 3 **e** com a regra de painel.
Eram três Leads por conversão.

- Se o painel da PixelX também encaminha conversões para o Meta, o Lead chega
  **duplicado dentro do Events Manager** — mesmo que o painel da PixelX mostre um
  número correto. Confira os dois painéis, não só um.

### Emissor 5 — PixelX carregada duas vezes

Não é um emissor "novo", e sim todos os anteriores contados em dobro. Ver
[§3.2](#32-existem-dois-jeitos-de-a-pixelx-entrar-na-página).

### ⚠ ANTES de tratar como duplicação: N destinos ≠ N duplicatas

**Este é o erro de diagnóstico mais caro desta doc, e custou uma queda real de
Lead no PMPE.** Leia antes de desligar qualquer emissor.

Se o container tem **3 tags Meta** (3 pixels, 3 contas de anúncio), então **um
único** Lead corretamente disparado aparece **3 vezes** — uma por destino. Isso é
o comportamento desejado, não duplicação. A prova está no pageview: se você vê
3 pageviews, o container tem 3 destinos, e o Lead *tem que* aparecer 3 vezes
também.

| O que você observa | Interpretação |
|---|---|
| 3 pageviews **e** 3 Leads | ✅ Correto — 3 destinos, 1 conversão cada |
| 1 pageview **e** 3 Leads | ❌ Duplicação real — 3 emissores para 1 destino |
| 3 pageviews **e** 6 Leads | ❌ Duplicação real — 2 emissores × 3 destinos |
| 3 pageviews **e** 0 Leads | ❌ Falha A — nenhum emissor chega aos destinos |

**A regra de diagnóstico:** conte o pageview primeiro. Ele te diz quantos
destinos existem. Só então divida os Leads por esse número. **Leads ÷ destinos
tem que dar exatamente 1.**

O contador de `send_event`/`fbq` no código ([§10.3](#103-auditoria-de-emissores-duplicados))
mede **emissores**, e é cego para destinos. Um `send_event` só, com 3 tags no
container, produz 3 eventos e está certo.

### Como isso vira duplicação de verdade

Os números abaixo são **por destino**. Multiplique pelo número de tags do
container para saber o que vai aparecer no relatório.

| Combinação ativa | Leads por envio, por destino |
|---|---|
| Regra de submit (só ela) | 1 ✅ |
| Regra de submit + `send_event` manual | 2 |
| Regra de submit + regra de clique por classe | 2 |
| Regra de submit + `send_event` + `fbq` | 3 |
| Regra de submit + PixelX carregada 2× | 2 |
| Regra de submit + regra de clique + PixelX 2× | 4 |

---

## 5. Escolha da arquitetura: Modelo A ou Modelo B

Escolha **um** e desligue tudo do outro. A escolha errada é o que gera os dois
modos de falha ao mesmo tempo em sites diferentes da mesma leva.

### Modelo A — Lead disparado pelo painel

O painel tem a regra de `submit` vinculada ao `id` do form. O site **não** chama
`send_event`. É o modelo do CPPEM hoje.

- ✅ Zero código de tracking no site.
- ❌ Frágil na replicação: depende do `id` casar com o painel, e do formulário
  emitir `submit` nativo. **É o modelo que produz a Falha A.**
- ❌ Não dá para adicionar guarda de idempotência — você não controla o disparo.

### Modelo B — Lead disparado pelo site

A regra de Lead no painel é **desligada**, e o site chama `send_event`
explicitamente, uma única vez, com guarda.

> ### 🛑 PRÉ-REQUISITO QUE INVALIDA O MODELO B
>
> **O Modelo B só funciona se os destinos do Lead forem nativos da PixelX.**
>
> Se as conversões são entregues por **tags do GTM** (é o caso das 3 tags Meta do
> container CPPEM/PMPE), `pixel_x_app.send_event()` **não as aciona**. Ele fala
> com o backend da PixelX; tag do GTM precisa de **gatilho do GTM**. O evento sai
> do site, é aceito pela PixelX, e **não chega em nenhum pixel Meta** — some sem
> erro no console.
>
> Pior: no Modelo B a barreira chama `stopImmediatePropagation()` no `submit`,
> o que **também mata o gatilho de formulário do próprio GTM**. Ou seja, o
> Modelo B não só deixa de disparar as tags — ele impede que qualquer outra
> coisa dispare.
>
> **Teste de 30 segundos, antes de escolher o Modelo B:**
>
> ```js
> // 1. Quantos destinos existem? (conte os pageviews no Meta/painel)
> // 2. O send_event chega neles? Rode no console e confira o relatório:
> window.pixel_x_app.send_event({ event_name: 'Lead', lead_name: 'TESTE MODELO B' });
> ```
>
> Se o evento de teste **não** aparecer nas tags de destino, os destinos são do
> GTM e **o Modelo B está descartado** — use o Modelo A.
>
> Sintoma de quem errou nisto: **pageviews normais e Lead zerado**. Ver
> [§8.7](#87-modelo-b-silenciando-as-tags-do-gtm).

- ✅ **Resolve a Falha A:** não depende do `id` casar com o painel, nem de existir
  `submit` nativo. Funciona em Elementor, React, formulário AJAX, qualquer coisa —
  basta chamar a função no ponto de sucesso.
- ✅ **Resolve a Falha B:** um emissor único, no código, auditável, com guarda de
  idempotência que impede duplo disparo mesmo com duplo clique.
- ✅ Você controla exatamente *quando* conta (só após validar / só após a API
  responder 200).
- ❌ Exige desligar a regra no painel. **Se esquecer disso, duplica.** Este é o
  único risco do Modelo B, e é um risco de checklist, não de arquitetura.

| Situação | Modelo |
|---|---|
| Site novo, formulário HTML próprio, você controla o painel | **B** |
| Formulário de terceiro (Elementor, RD, HubSpot) sem `submit` nativo | **B** (A não funciona) |
| Você não tem acesso ao painel para desligar a regra | **A** |
| Site legado já funcionando com o painel, sem queixa de duplicidade | **A**, não mexa |

> **Nunca os dois.** Se o painel dispara e o site também, são dois Leads. Não
> existe configuração em que ter os dois seja correto.

---

## 6. Nomenclatura canônica e identificação dos campos

### 6.0 🔴 A NOMENCLATURA NÃO É COSMÉTICA — ELA É O VÍNCULO

**Leia esta subseção antes de qualquer outra coisa ao replicar.** Ela custou
5 tentativas de correção na landing ManyChat, todas erradas, porque a
nomenclatura foi tratada como estilo pessoal de cada arquivo.

Existem **duas coisas diferentes** que dependem dos nomes, e confundi-las é o
erro:

| | O que faz | Depende de |
|---|---|---|
| **Identificação do campo** | captura passiva no `blur` (§13), máscara | keyword *contida* no `name` — flexível |
| **Vínculo da regra de conversão** | o **Lead** chegar ao Meta | **nomenclatura exata** — rígido |

A segunda linha é a que importa para a conversão, e ela **não** é flexível.
`nome`, `telefone` e `lead-form` identificam os campos corretamente pelo
algoritmo de keywords — e ainda assim **o Lead não chega ao Meta**, porque a
regra do painel não reconhece o formulário.

#### A nomenclatura obrigatória

Copie exatamente. Cada linha foi verificada nas três landings em produção:

| Elemento | Atributo | Valor obrigatório |
|---|---|---|
| `<form>` | `id` | o identificador do painel (ex.: `IPEyzyfmJhKQEYIXAlZH`) |
| `<form>` | `name` | `lead_form` |
| nome | `id` / `name` | `lead_name` / `name` |
| e-mail | `id` / `name` | `lead_email` / `email` |
| telefone | `id` / `name` | `lead_phone` / `phone` |
| telefone | `class` | `pxa_mask_phone` |
| botão | `id` | `lead_submit` |
| spans de erro | `data-error-for` | `name`, `email`, `phone` |

```html
<form class="form" name="lead_form" id="ID_DO_PAINEL" novalidate>
  <input type="text"  id="lead_name"  name="name"  required />
  <span class="error" data-error-for="name"></span>

  <input type="email" id="lead_email" name="email" required />
  <span class="error" data-error-for="email"></span>

  <input class="pxa_mask_phone" type="text" id="lead_phone" name="phone" required />
  <span class="error" data-error-for="phone"></span>

  <button type="submit" id="lead_submit" class="cta">ENVIAR</button>
</form>
```

#### O identificador do painel vai no `<form>`, não no botão

> Este ponto sozinho consumiu três diagnósticos errados nesta doc.

O `id` do painel pertence ao **`<form>`**. Uma landing chegou a funcionar com
ele no `<button>`, o que produziu a conclusão errada de que era "regra de
clique" e de que o valor era intercambiável entre os dois elementos. **Não é.**
Ao replicar, o padrão é sempre: identificador do painel no `<form>`,
`lead_submit` no botão.

#### 🔴 O identificador do painel é um `id` — nunca uma `class`

`#eiBtTROiAlNexbHXklSc` e `.eiBtTROiAlNexbHXklSc` são **seletores diferentes**.
A regra do painel procura o **id**. Colocar o mesmo valor como classe faz o
vínculo nunca acontecer, e o sintoma é o mais silencioso de todos: **nem o GTM
nem o Meta recebem Lead — só pageview.**

| Landing | Identificador | Onde | Como |
|---|---|---|---|
| captura-cppem | `IPEyzyfmJhKQEYIXAlZH` | `<form>` | `id` ✅ |
| pmpe | `IPEyzyfmJhKQEYIXAlZH` | `<button>` | `id` ✅ |
| ManyChat | `IPEyzyfmJhKQEYIXAlZH` | `<form>` | `id` ✅ |
| Aniversário (antes) | `eiBtTROiAlNexbHXklSc` | `<button>` | **`class`** ❌ |

> Cuidado com a §4, Emissor 2: ela descreve um mecanismo de "conversão por
> classe" que existiu no CPPEM antigo. **Não confunda os dois.** Se o painel
> cadastrou o valor como id, ele tem que ser `id` no HTML. Na dúvida, use `id`
> no `<form>` — é a configuração das três landings que funcionam.

#### 🔴 O identificador precisa ser ESTÁTICO

Nunca adicione ou remova o identificador em runtime. Houve uma tentativa
engenhosa de só marcar o botão quando o formulário estivesse válido:

```js
// ERRADO — some do DOM no load e a PixelX nunca vincula
function syncPixelClass() {
  btn.classList.toggle(PIXELX_CLASS, isFormValid());
}
syncPixelClass();   // formulário vazio → REMOVE o identificador
```

A PixelX varre o DOM para vincular a regra. Se o identificador não está lá na
varredura, o vínculo não acontece — e devolvê-lo depois **não vincula
retroativamente**. O gating de validade se faz com as barreiras de submit
([§7.8](#78-ordem-de-registro-dos-listeners-de-submit)), não mexendo no
identificador.

#### Regra prática

> **Se um site funciona e outro não, e a única diferença é nomenclatura, a
> nomenclatura É a causa.** Não trate `nome` vs `name` como preferência de
> idioma. Copie o arquivo que funciona e troque só o que é específico do site
> ([§8.1](#81-valores-que-são-específicos-de-cada-site)) — nunca "adapte" nomes.

Sintoma característico: **GTM recebe o Lead, Meta não recebe nada.** O GTM
dispara no clique e não valida nomenclatura; a PixelX é quem precisa reconhecer
o formulário para encaminhar ao Meta. Ver [§8.8](#88-caso-manychat-nomenclatura-divergente).

---

### 6.1 Como a PixelX identifica os campos

Isto define os atributos que o HTML **precisa** ter. De `input_has_type()`:

```js
const keywords = {
    phone: ['tel', 'phone', 'ph', 'cel', 'mobile', 'fone', 'whats'],
    mail:  ['mail', 'email', 'em'],
    name:  ['nome', 'nombre', 'name', 'nm'],
    doc:   ['document', 'doc', 'cpf', 'cnpj'],
};
```

Ela testa se o atributo **contém** (não "é igual a") alguma dessas palavras.

**Armadilha importante — a fonte do nome muda conforme a função:**

| Função | O que ela lê |
|---|---|
| `monitor_forms()` | `field.name \|\| field.id` — o `id` serve de reserva |
| `mask()` (máscara de telefone) | **apenas `el.name`** — sem reserva |

Ou seja: um campo só com `id="lead_phone"` e sem `name` é monitorado, mas **não
recebe a máscara**. Sempre defina os dois.

### HTML de referência

```html
<form name="lead_form" id="ID_DO_FORM_NO_PAINEL" novalidate>
  <input type="text"  id="lead_name"  name="name"                        required />
  <input type="email" id="lead_email" name="email"                       required />
  <input type="text"  id="lead_phone" name="phone" class="pxa_mask_phone" required />
  <button type="submit" id="lead_submit" class="cta">ENVIAR</button>
</form>
```

Regras que valem para qualquer site:

- O `id` do `<form>` é o identificador usado no painel da PixelX. **Ele tem que
  ser único na página** e **específico daquele site** — ver [§8.1](#81-valores-que-são-específicos-de-cada-site).
- O botão precisa de `id` próprio e `type="submit"`.
- A classe `pxa_mask_phone` (ou `pxa-mask-phone`, ou os mesmos como `id`) marca
  qual campo recebe a máscara. **O formato em si vem do painel**, não do HTML —
  `mask_load()` sai logo no início se `data.phone_mask` não estiver configurado.

---

## 7. Defeitos originais corrigidos no CPPEM

Os oito defeitos encontrados na primeira rodada. Continuam valendo como
referência: qualquer um deles reaparece ao copiar o código pela metade.

### 7.1 `id` duplicado entre o `<form>` e o `<button>`

```html
<!-- ERRADO -->
<form id="IPEyzyfmJhKQEYIXAlZH">
  <button type="submit" id="IPEyzyfmJhKQEYIXAlZH">Enviar</button>
</form>
```

`document.getElementById()` retorna o **primeiro** match, que é o `<form>`. Então
`submitBtn` apontava para o formulário, e esta linha apagava a página inteira do
formulário ao clicar:

```js
submitBtn.textContent = "ENVIANDO..."; // destruía todos os filhos do <form>
```

**Correção:** `id` único no form, `id` próprio no botão.

### 7.2 `name` do campo divergente do `data-error-for`

O e-mail tinha `name="mail"` e `data-error-for="mail"`, mas o JS chamava
`setError("email", ...)`. As mensagens de erro de e-mail simplesmente nunca
apareciam. **Correção:** padronizar tudo em `email`.

### 7.3 `name="submit"` no botão quebra `form.submit()`

`HTMLFormElement` é declarado com `[LegacyOverrideBuiltIns]` na spec: um controle
chamado `submit` **sobrescreve o método** `form.submit()`, que deixa de ser
função. Se a PixelX (ou qualquer script) chamar `form.submit()`, estoura.

**Correção:** nunca usar `name="submit"`, `name="reset"` ou `name="action"` em
controles de formulário.

### 7.4 `preventDefault()` no clique mata o evento `submit`

```js
// ERRADO — a PixelX nunca vê o submit
submitBtn.addEventListener("click", (e) => {
  e.preventDefault();
  enviar();
});
```

Cancelar a ação padrão do clique faz o navegador **não gerar** o evento `submit`.
A PixelX escuta exatamente esse evento, então o Lead nunca era registrado.

**Correção:** escutar o `submit` do formulário e dar `preventDefault()` **lá** — o
evento já foi disparado (a PixelX recebeu) e só a navegação é bloqueada. De
quebra, o Enter passa a funcionar de graça, via submissão implícita.

### 7.5 Evento `Lead` duplicado

Adicionamos manualmente `send_event({ event_name: 'Lead' })` enquanto o painel já
disparava o Lead no submit. Resultado: dois eventos por conversão.

**Fato que esclarece a confusão:** `monitor_forms()` **não dispara evento de
conversão nenhum.** Ela só percorre os inputs, identifica o tipo e chama
`input_monitor()`, que adiciona um listener de `blur` → `input_save()` →
`debounce_send_lead_data()`. Isso é **captura de dados do lead**, não Lead.

Quem dispara o Lead no submit é a regra de evento configurada no painel
(mecanismo do `monitor_forms_dynamic`, listener de `submit` com debounce de
1500 ms).

Ver o inventário completo de emissores em [§4](#4-inventário-dos-5-emissores-de-lead).

### 7.6 `form.reset()` e redirecionamento cedo demais

O handler da PixelX roda no submit, mas a requisição é assíncrona (e com debounce
de 1500 ms). Duas coisas atropelavam isso:

- `form.reset()` logo após o submit → risco de a PixelX ler campos já vazios.
  **Correção:** removido. O usuário sai da página em seguida mesmo.
- `setTimeout(redirect, 700)` → em conexão móvel lenta, a navegação cancelava a
  requisição do evento. **Correção:** 1500 ms, alinhado ao debounce da PixelX.

```js
const REDIRECT_DELAY_MS = 1500; // abaixo de ~1s começa a perder eventos
```

### 7.7 Validar o telefone pelo `length` da string — o erro mais traiçoeiro

Tentativas que **falharam**, e por quê:

| Regra | Por que quebra |
|---|---|
| `tel.length < 1` | aceita qualquer coisa |
| `tel.length < 13` | `(81) 97310-5354` mascarado tem 15 chars, mas `81973105354` cru tem 11 e seria **rejeitado**; e `(81) 97310-53`, incompleto, tem 13 e **passava** |
| `digitos.length === 11` | **o `+55` da máscara conta como 2 dígitos** |

O último merece atenção porque é o que enganou de verdade. O padrão da máscara é
`+{55} (00) [9]0000-0000`, onde `{55}` é **texto fixo**: aparece na tela desde o
primeiro caractere digitado, mas não é número que o visitante informou. Então:

```text
+55 (81) 9996-741  →  55 81 9996 741  →  11 dígitos  →  passava!
```

Um número completo tem 13 dígitos com o país. Exigir 11 estava, na prática,
pedindo apenas 7 dígitos do usuário.

**Correção:** remover o prefixo do país pelo `+` literal antes de contar. Tanto a
máscara quanto o `phone_valid()` da PixelX sempre escrevem esse `+`, o que faz
dele um marcador confiável — diferente de remover pelos dígitos, que seria
ambíguo, já que **o DDD 55 existe** (Santa Maria/RS).

```js
const isPhone = (v) => {
  const nacional = v.trim().replace(/^\+\s*55\s*/, "");
  const d = nacional.replace(/\D/g, "");

  return d.length === 11 && d[2] === "9";
};
```

| Entrada | Nacional | Dígitos | Resultado |
|---|---|---|---|
| `+55 (81) 9996-741` | `(81) 9996-741` | 9 | rejeita |
| `+55 (81) 99967-412` | `(81) 99967-412` | 10 | rejeita |
| `+55 (81) 99967-4123` | `(81) 99967-4123` | 11 | aceita |
| `81999674123` (sem máscara) | — | 11 | aceita |
| `+5581999674123` (`phone_valid`) | `81999674123` | 11 | aceita |
| `(55) 99999-9999` (DDD 55) | — | 11 | aceita |

> ⚠️ Esta regra é **específica do Brasil e de celular**. Ao replicar em site que
> aceita telefone fixo, ou de outro país, `d[2] === "9"` rejeita números válidos.
> Ver [§8.6](#86-a-validação-de-telefone-não-é-universal).

### 7.8 Ordem de registro dos listeners de `submit`

A PixelX registra o listener dela **de dentro do `start()`, que é `async`**. Um
listener registrado no próprio `<form>` dispara por ordem de registro, então não
havia garantia de que o nosso viesse antes do dela — se o dela rodasse primeiro,
gravava o Lead antes de descobrirmos que o formulário era inválido.

**Correção:** capturar o `submit` no `document`, em **fase de captura**. Um
listener de captura no `document` roda **sempre** antes de qualquer listener
registrado no elemento-alvo, independente de quem registrou primeiro.

```js
document.addEventListener("submit", (e) => {
  if (e.target !== form) return;

  e.preventDefault();               // nunca recarregar a página

  if (!validate()) {
    e.stopImmediatePropagation();   // o evento morre aqui; PixelX não vê
    return;
  }

  enviar();                         // válido → propaga → PixelX registra o Lead
}, true);
```

`stopImmediatePropagation()` (e não `stopPropagation()`) é o correto: precisamos
impedir também os listeners registrados no `<form>`, que é um nó adiante no
caminho de propagação.

---

## 8. Defeitos de replicação: o que quebra ao copiar

Esta seção é sobre o que quebra **especificamente ao levar o código para outro
site** — mesmo com o original funcionando perfeitamente.

### 8.1 Valores que são específicos de cada site

**Todo item desta tabela precisa ser trocado. Nenhum sobrevive ao copiar/colar.**
Esquecer o primeiro é a causa nº 1 da Falha A.

| Valor | Exemplo no CPPEM | Onde vive | O que acontece se não trocar |
|---|---|---|---|
| **`id` do `<form>`** | `IPEyzyfmJhKQEYIXAlZH` | [index.html](index.html) e `script.js` | **Lead nunca dispara** — id não existe no painel do novo site |
| Domínio + path do loader sGTM | `sgtm.cppem.com.br/metrics/` | `<head>` | Eventos vão para a conta do CPPEM |
| ID do container no `noscript` | `GTM-PJ379FLQ` | [index.html](index.html) | Só afeta visitantes sem JS |
| Domínio do loader direto PixelX | `pxa.cppem.com.br` | `<head>`, se presente | Idem — conta errada |
| Classe de conversão por clique | `xrmmmmzdllmckwinbxuh` | `script.js`, se presente | Classe morta, ou conversão em conta errada |
| URL de redirecionamento | `wa.me/5581973105354` | `script.js` | Leads do cliente novo caem no WhatsApp do CPPEM |
| Regra de Lead no painel | — | Painel PixelX | Precisa ser criada na conta nova |

> **Cuidado especial com o `id` do form:** ele aparece em **dois lugares** — no
> HTML e no `document.getElementById(...)` do `script.js`
> ([script.js:17](script.js#L17)). Trocar só um dos dois deixa `form === null`, e
> aí a barreira de submit nunca casa (`e.target !== form` sempre verdadeiro), o
> formulário submete nativamente e **a página recarrega com os dados na URL**.
> No [template portável](#9-template-portável) esse valor aparece uma vez só.

### 🛑 Não remova um id opaco antes de confirmar que ele não é o emissor

Esta tabela manda trocar identificadores copiados de outro site. **Isso é
verdade para o `id` do `<form>` — mas um id de aparência idêntica, sentado no
`<button>`, pode ser uma regra de CLIQUE do painel, e aí ele é o emissor real
do Lead.** Removê-lo zera a conversão.

Foi exatamente o que aconteceu no PMPE ([§8.7](#87-modelo-b-silenciando-as-tags-do-gtm)):
o id no botão parecia lixo de copy/paste e era a única via que ainda disparava
as 3 tags Meta.

**Antes de remover:** desligue a regra no painel, **ou** confirme com um lead de
teste que existe outra via ativa. Regra prática — id opaco no `<form>` costuma
ser regra de submit; id opaco no `<button>` costuma ser regra de clique.

### 8.2 O `id` do form precisa existir no painel — e ser único

Duas condições, ambas obrigatórias:

1. O `id` do `<form>` no HTML é **exatamente** o mesmo cadastrado no painel da
   PixelX daquela conta.
2. Esse `id` aparece **uma única vez** na página.

A segunda falha silenciosamente em sites com formulário repetido — cabeçalho +
rodapé, ou um modal que duplica o form da página. Se o mesmo `id` aparece duas
vezes, `getElementById` pega o primeiro; se o visitante usar o segundo, nenhuma
barreira se aplica. Teste no console:

```js
document.querySelectorAll('[id="SEU_ID_AQUI"]').length   // tem que ser 1
```

### 8.3 Formulários que não emitem `submit` nativo

**Esta é a causa de Falha A que nenhum ajuste de `id` resolve.**

O Modelo A inteiro depende de o navegador disparar um evento `submit` nativo.
Vários construtores de página **não disparam**: interceptam o clique, montam a
requisição em JavaScript e enviam por `fetch`/XHR. Casos comuns: Elementor Forms,
formulários de React/Vue sem `<form>` real, RD Station, HubSpot, Typeform
embedado.

Nesses sites, o Lead **nunca** vai disparar pelo painel, por mais correto que
esteja o `id`. Não há evento para escutar.

**Detecção — cole no console e envie o formulário:**

```js
document.addEventListener('submit', e => console.log('SUBMIT NATIVO:', e.target), true);
```

Se nada aparecer no console ao enviar, o formulário não emite `submit`.

**Solução:** Modelo B. Chame `trackLead()` no callback de sucesso do próprio
construtor — ver [§9](#9-template-portável). Não tente forçar um `submit`
sintético: `form.dispatchEvent(new Event('submit'))` não aciona a validação nem a
submissão real, e cria um caminho paralelo fácil de duplicar depois.

### 8.4 A barreira de validação matando o Lead

A barreira de [§7.8](#78-ordem-de-registro-dos-listeners-de-submit) é uma faca de
dois gumes: ela existe para **impedir** que o Lead dispare com dados inválidos.
Se a validação do site novo for mais rígida que os dados reais dos visitantes, ela
bloqueia conversões legítimas — e o sintoma é idêntico ao de "Lead não dispara".

O caso concreto: a validação de telefone de [§7.7](#77-validar-o-telefone-pelo-length-da-string--o-erro-mais-traiçoeiro)
exige celular brasileiro com 9 na terceira posição. Em um site que aceita telefone
fixo, **todo** envio com fixo é bloqueado por `stopImmediatePropagation()`. O
visitante vê erro, o painel não vê nada.

**Como distinguir de um problema de `id`:** se o campo de erro aparece na tela
para o usuário, é a validação. Se o formulário parece enviar normalmente e mesmo
assim não chega Lead, é vínculo/`id`.

### 8.5 Corrida com o `start()` assíncrono

`window.pixel_x_app` é criado pelo GTM, e o `start()` dela é `async`. Num site
mais lento que o CPPEM — ou num visitante em 3G — o objeto pode **ainda não
existir** no momento em que o formulário é enviado. No Modelo B, `send_event`
simplesmente não é chamado, e o Lead se perde sem erro visível.

O `?.` mascara isso perfeitamente:

```js
await window.pixel_x_app?.send_event({ ... });  // pixel ausente → não faz nada, sem erro
```

**Solução:** esperar o pixel ficar pronto, com timeout. Implementado no
[template](#9-template-portável) como `waitForPixel()`.

### 8.6 A validação de telefone não é universal

A regra `d.length === 11 && d[2] === "9"` significa: **celular brasileiro, com
DDD, com o nono dígito**. Ao replicar, ajuste conforme o site:

| Site aceita | Regra |
|---|---|
| Só celular BR (padrão CPPEM) | `d.length === 11 && d[2] === "9"` |
| Celular **ou** fixo BR | `d.length === 10 \|\| d.length === 11` |
| Qualquer país | `d.length >= 8 && d.length <= 15` (faixa E.164) |

A remoção do prefixo `+55` antes de contar continua necessária em todos os casos
em que a máscara da PixelX estiver ativa.

### 8.7 Modelo B silenciando as tags do GTM

**Caso real, PMPE, com queda de Lead em produção.** Sintoma: pageviews normais
(3, um por tag Meta) e **Lead zerado nos três**.

Sequência do que aconteceu:

1. O botão de submit carregava um `id` que era o identificador de uma regra de
   conversão no painel. Era **esse id o emissor real** do Lead — a regra
   disparava as 3 tags Meta do container.
2. O `id` parecia lixo de copy/paste (é o id do formulário de outra landing da
   mesma conta) e foi removido, seguindo [§8.1](#81-valores-que-são-específicos-de-cada-site).
3. O site estava em `LEAD_MODE = "site"` (Modelo B), então em tese o
   `send_event()` cobriria o Lead.
4. **Não cobriu.** O Lead foi a zero.

Por que o `send_event` não cobriu:

- As tags Meta são **tags do GTM**, e tag do GTM só dispara por **gatilho do
  GTM**. `pixel_x_app.send_event()` conversa com o backend da PixelX e não
  aciona gatilho nenhum do container.
- A barreira do Modelo B chama `stopImmediatePropagation()` no `submit`, o que
  **também mata o gatilho de formulário do GTM** — fechando a última via que
  ainda poderia disparar as tags.
- A única via que sobrevivia era o **clique**: `stopImmediatePropagation()` no
  evento `submit` não afeta listeners de `click`. Por isso a regra vinculada ao
  `id` do botão funcionava — e por isso removê-la zerou tudo.

**Lições que valem para qualquer replicação:**

| Lição | Consequência prática |
|---|---|
| Um `id` que parece hash aleatório pode ser o emissor real | Antes de remover, desligue a regra no painel — ou confirme que existe outra via |
| `stopImmediatePropagation()` no submit mata gatilho de GTM também | Modelo B é incompatível com destinos que sejam tags do GTM |
| Clique e submit são vias independentes | Matar o submit não mata o clique, e vice-versa |
| Pageview normal + Lead zero = emissor cortado | Não é problema de container; é a via de conversão que sumiu |

**Antes de remover qualquer identificador suspeito**, rode o teste de reversão:
remova, envie um lead de teste, confira o relatório. Se zerar, era emissor —
devolva e trate no painel primeiro.

#### Refinamento: a causa raiz é a regra por site, não o mecanismo do evento

A primeira leitura deste caso foi "`send_event` não aciona tag do GTM". Isso é
verdade, mas **não é a causa raiz** — e atribuir o problema a ela leva a
consertos que não funcionam. O caso da landing ManyChat fechou o diagnóstico:

| Página | Regra de conversão no painel | `id` no botão | Lead chega no Meta |
|---|---|---|---|
| captura-cppem | sim | — (id no `<form>`) | ✅ |
| pmpe | sim | `IPEyzyfmJhKQEYIXAlZH` | ✅ |
| ManyChat | **não** | `IPEyzyfmJhKQEYIXAlZH` (o mesmo) | ❌ |

O **mesmo id**, no mesmo container, funciona numa página e não na outra. E na
ManyChat um `dataLayer.push` chega ao GTM e **para ali**, sem seguir para o
Meta.

**A regra geral, então:**

> A ponte para o Meta é a PixelX, e ela só encaminha a conversão quando existe
> **regra de conversão cadastrada no painel para aquele site**. Sem a regra, não
> importa como o evento é produzido — clique, submit, `send_event` ou
> `dataLayer.push`. O Meta não vê.

Corolários que mudam o diagnóstico:

- **A regra do painel é por site, não global por `id`.** Copiar o identificador
  de uma landing que funciona para outra **não** replica a conversão.
- **Nenhuma quantidade de código no site substitui a regra.** Se o painel não
  cobre o site, a única correção é cadastrá-lo lá.
- **Evento chegando no GTM e não no Meta = serviço pela metade**, e a metade que
  falta é sempre painel-side.

Sintoma que identifica este caso: pageview normal, captura passiva funcionando
(o lead aparece no painel via `blur`, ver [§13](#13-o-que-não-dá-para-controlar-pelo-site)),
e **evento de conversão zerado**. A captura passiva funcionando engana — ela
prova que a PixelX carregou, não que existe regra de conversão.

### 8.8 Caso ManyChat: nomenclatura divergente

**O caso mais caro desta doc: 5 tentativas de correção, todas erradas, porque a
nomenclatura foi tratada como estilo de código.**

Sintoma: o Lead chegava ao **GTM** e **nunca** ao Meta. Pageview normal.
Máscara de telefone funcionando (portanto a PixelX estava carregada e ativa).
Captura passiva registrando "subscribed" no painel.

#### As 5 hipóteses erradas, e por que cada uma caiu

| # | Hipótese | Por que caiu |
|---|---|---|
| 1 | O `id` do painel no botão era lixo de copy/paste; removê-lo | Zerou o Lead em outra landing. **Era emissor.** |
| 2 | Domínio não coberto pela regra do painel | Pageview e captura passiva funcionavam no domínio |
| 3 | `send_event` não aciona tag do GTM → usar `dataLayer.push` | O evento chegou ao GTM e parou ali |
| 4 | Faltava a classe `pxa_mask_phone` | Foi adicionada; a máscara passou a funcionar e o Lead continuou zerado |
| 5 | A tag da PixelX não dispara neste hostname | A máscara funcionava, provando que a PixelX **estava** carregada |

#### O que era

A landing usava nomenclatura própria, em português:

```html
<!-- ERRADO — identifica os campos, mas a regra do painel não reconhece -->
<form id="lead-form">
  <input id="nome"     name="nome" />
  <input id="email"    name="email" />
  <input id="telefone" name="telefone" class="pxa_mask_phone" />
  <button type="submit" id="IPEyzyfmJhKQEYIXAlZH">…</button>
</form>
```

Todos esses `name` **identificam corretamente** pelo algoritmo de keywords:
`nome`→name, `telefone`→phone. A captura passiva funcionava. A máscara
funcionava. E mesmo assim a conversão não era encaminhada ao Meta.

A correção foi espelhar o arquivo que funciona, campo por campo:

```html
<!-- CERTO — nomenclatura canônica, id do painel no <form> -->
<form name="lead_form" id="IPEyzyfmJhKQEYIXAlZH">
  <input id="lead_name"  name="name" />
  <input id="lead_email" name="email" />
  <input class="pxa_mask_phone" id="lead_phone" name="phone" />
  <button type="submit" id="lead_submit">…</button>
</form>
```

Funcionou na primeira tentativa.

#### As duas lições

1. **Identificar o campo ≠ vincular a regra de conversão.** O algoritmo de
   keywords ([§6.1](#61-como-a-pixelx-identifica-os-campos)) resolve o primeiro
   e não diz nada sobre o segundo. Máscara funcionando **não** é prova de que a
   conversão está vinculada — só de que a PixelX carregou.
2. **Comparar é mais barato que inferir.** As 5 hipóteses vieram de raciocínio
   sobre o mecanismo. O que resolveu foi um diff atributo por atributo entre um
   site que funciona e um que não. **Faça o diff primeiro.**

#### O procedimento que deveria ter sido o primeiro

Quando um site funciona e outro não, com a mesma stack:

```bash
# extraia os atributos do <form> dos dois e compare campo a campo:
#   form.id, form.name, cada input (id/name/class/type), button.id, data-error-for
# qualquer divergência é suspeita até prova em contrário — inclusive "só o nome"
```

Não parta para teoria sobre painel, container ou domínio enquanto houver
**uma única** divergência de nomenclatura entre os dois arquivos.

### 8.9 Caso Aniversário: identificador como `class` e loader duplicado

Sintoma: **nem GTM nem Meta recebiam Lead — só pageview.** Diferente do caso
ManyChat ([§8.8](#88-caso-manychat-nomenclatura-divergente)), onde o GTM ao
menos recebia.

Três defeitos somados, todos invisíveis no console:

| # | Defeito | Efeito |
|---|---|---|
| 1 | Identificador do painel como **`class`** no botão, não `id` | vínculo nunca acontecia — **causa raiz** |
| 2 | Identificador **removido no load** por `syncPixelClass()` | mesmo como classe, sumia do DOM antes da varredura |
| 3 | Loader do GTM **duplicado** (`<head>` + `<body>`) | cada evento contado em dobro, inclusive pageview |

O nº 2 merece atenção porque a intenção era boa: a classe só entrava no botão
quando o formulário estivesse válido, para não contar conversão de quem clica
sem preencher. Mas `syncPixelClass()` era chamado no load, com o formulário
vazio, **removendo o identificador**. Gating de validade se faz com as barreiras
de submit, nunca mexendo no identificador.

O nº 3 é o inverso dos outros: não zera, **infla**. Vale conferir se as métricas
históricas deste site estavam dobradas — a queda após a correção é o número
certo aparecendo, não perda.

#### A lição de método

A causa raiz foi encontrada por uma tabela de quatro linhas comparando **onde** e
**como** o identificador aparece em cada landing. Não por raciocínio sobre o
mecanismo. Isso já é a segunda vez na doc: veja também
[§8.8](#88-caso-manychat-nomenclatura-divergente).

> **Compare mecanicamente antes de teorizar.** É para isso que existe o
> [validador da §11.1](#111-validador-automático).

---

## 9. Template portável

Script de referência para **Modelo B**, pensado para copiar e trocar apenas o
bloco `CONFIG`. Resolve, por construção, as Falhas A e B:

- Um único emissor de Lead, no código, auditável.
- Guarda de idempotência → duplo clique, duplo listener ou script incluído duas
  vezes não geram Lead duplicado.
- Espera o `pixel_x_app` ficar pronto antes de disparar.
- `trackLead()` exposto em `window` → funciona em formulário sem `submit` nativo.

```js
/* =========================================================
   Tracking de Lead — PixelX (Modelo B: o SITE dispara)
   Trocar SOMENTE o bloco CONFIG ao replicar.

   PRÉ-REQUISITO OBRIGATÓRIO:
   desligar a regra de Lead no painel da PixelX (submit E clique-por-classe).
   Se o painel também disparar, o Lead conta em dobro.
   ========================================================= */

const CONFIG = {
  formId:        "TROCAR_ID_DO_FORM",      // único na página; NÃO precisa casar com o painel no Modelo B
  submitBtnId:   "lead_submit",
  fields:        { name: "lead_name", email: "lead_email", phone: "lead_phone" },
  redirectUrl:   "https://wa.me/5599999999999?text=Ol%C3%A1",
  redirectDelay: 1500,                     // ≥ debounce da PixelX; abaixo de ~1s perde evento
  phoneMode:     "celular_br",             // "celular_br" | "celular_ou_fixo_br" | "internacional"
};

/* --- Elementos --- */
const form        = document.getElementById(CONFIG.formId);
const submitBtn   = document.getElementById(CONFIG.submitBtnId);
const nomeInput   = document.getElementById(CONFIG.fields.name);
const emailInput  = document.getElementById(CONFIG.fields.email);
const telefoneInput = document.getElementById(CONFIG.fields.phone);

/* Falha barulhenta em vez de silenciosa: o erro nº 1 da replicação é o id do
   form não bater. Sem isto, a página só "recarrega sozinha" e ninguém entende. */
if (!form) {
  console.error(`[tracking] Formulário "${CONFIG.formId}" não encontrado. ` +
                `Confira CONFIG.formId e o id no HTML.`);
}
if (document.querySelectorAll(`[id="${CONFIG.formId}"]`).length > 1) {
  console.error(`[tracking] id "${CONFIG.formId}" duplicado na página.`);
}

/* --- Validação --- */
function setError(key, input, msg) {
  const el = document.querySelector(`[data-error-for="${key}"]`);
  if (input) input.classList.add("is-invalid");
  if (el) el.textContent = msg;
}

function clearError(key, input) {
  const el = document.querySelector(`[data-error-for="${key}"]`);
  if (input) input.classList.remove("is-invalid");
  if (el) el.textContent = "";
}

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

/* Conta DÍGITOS, não caracteres — e remove o "+55" da máscara antes de contar,
   pelo "+" literal (remover pelos dígitos seria ambíguo: o DDD 55 existe). */
const isPhone = (v) => {
  const d = v.trim().replace(/^\+\s*55\s*/, "").replace(/\D/g, "");

  if (CONFIG.phoneMode === "celular_ou_fixo_br") return d.length === 10 || d.length === 11;
  if (CONFIG.phoneMode === "internacional")      return d.length >= 8 && d.length <= 15;

  return d.length === 11 && d[2] === "9";     // celular_br (padrão)
};

function validate() {
  let ok = true;

  const nome  = nomeInput?.value.trim() || "";
  const email = emailInput?.value.trim() || "";
  const tel   = telefoneInput?.value.trim() || "";

  clearError("name", nomeInput);
  clearError("email", emailInput);
  clearError("phone", telefoneInput);

  if (nome.length < 2)  { setError("name", nomeInput, "Informe seu nome completo."); ok = false; }
  if (!isEmail(email))  { setError("email", emailInput, "Informe um e-mail válido."); ok = false; }
  if (!isPhone(tel))    { setError("phone", telefoneInput, "Informe seu WhatsApp com DDD."); ok = false; }

  return ok;
}

/* --- Espera o pixel ficar pronto ---
   pixel_x_app é criado pelo GTM e o start() dela é async. Em conexão lenta o
   objeto pode não existir na hora do envio; sem esta espera o Lead some sem erro. */
function waitForPixel(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const pronto = () => typeof window.pixel_x_app?.send_event === "function";

    if (pronto()) return resolve(true);

    const inicio = Date.now();
    const t = setInterval(() => {
      if (pronto())                      { clearInterval(t); resolve(true); }
      else if (Date.now() - inicio > timeoutMs) {
        clearInterval(t);
        console.warn("[tracking] pixel_x_app não ficou pronto a tempo; Lead não enviado.");
        resolve(false);
      }
    }, 100);
  });
}

/* --- Emissor ÚNICO de Lead ---
   A guarda cobre duplo clique, script incluído duas vezes e listener duplicado.
   Só o painel pode duplicar a partir daqui — por isso a regra de lá tem que
   estar desligada. */
let leadEnviado = false;

async function trackLead() {
  if (leadEnviado) {
    console.warn("[tracking] Lead já enviado nesta página; ignorando.");
    return false;
  }
  leadEnviado = true;

  if (!(await waitForPixel())) return false;

  try {
    await window.pixel_x_app.send_event({
      event_name: "Lead",
      lead_name:  nomeInput?.value.trim() || "",
      lead_email: emailInput?.value.trim() || "",
      lead_phone: telefoneInput?.value.trim() || "",
    });

    console.log("[tracking] Lead enviado.");
    return true;
  } catch (err) {
    console.error("[tracking] send_event falhou:", err);
    leadEnviado = false;              // libera para nova tentativa
    return false;
  }
}

/* Exposto para formulários SEM submit nativo (Elementor, React, AJAX):
   chame window.trackLead() no callback de sucesso do próprio construtor. */
window.trackLead = trackLead;

/* --- Fluxo de envio --- */
async function enviar() {
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = "ENVIANDO...";
  }

  await trackLead();

  const successEl = document.getElementById("form-success");
  if (successEl) {
    successEl.hidden = false;
    successEl.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  /* NÃO chamar form.reset() antes daqui: a PixelX lê os campos no blur e o
     reset pode fazê-la gravar valores vazios. */
  if (CONFIG.redirectUrl) {
    setTimeout(() => { window.location.href = CONFIG.redirectUrl; }, CONFIG.redirectDelay);
  }
}

/* --- Barreira única: submit capturado no DOCUMENT, em fase de captura ---
   Roda SEMPRE antes de qualquer listener registrado no próprio <form>,
   independente de quem registrou primeiro (a PixelX registra o dela de dentro
   de um start() async, então a ordem não é garantida de outro jeito). */
document.addEventListener("submit", (e) => {
  if (!form || e.target !== form) return;

  e.preventDefault();                  // nunca recarregar a página

  if (!validate()) {
    e.stopImmediatePropagation();      // inválido → evento morre aqui
    return;
  }

  enviar();
}, true);
```

### Adaptação para Modelo A

Se você **precisa** manter o disparo pelo painel (sem acesso para desligar a
regra), use o mesmo template com duas mudanças:

1. Remova a função `trackLead()` e a chamada `await trackLead()` em `enviar()`.
2. `CONFIG.formId` passa a ser **obrigatoriamente** o id cadastrado no painel.

O resto — barreira de captura, validação, delay de redirecionamento — continua
igual e continua necessário.

---

## 10. Protocolo de diagnóstico

Execute na ordem. Cada passo elimina uma camada.

### 10.1 O container está carregando?

```js
typeof window.pixel_x_app                 // "object" = carregou
window.pixel_x_app?.data                  // config vinda do painel
window.pixel_x_app?.data?.phone_mask      // se undefined, a máscara nem carrega
window.dataLayer?.length                  // GTM presente?
```

- `undefined` → problema de **container**. Confira o loader, o domínio, bloqueio
  por adblock e a aba Network (o script do loader retornou 200?).
- `object` → container OK. **Pare de mexer no loader.** Vá ao 10.2.

### 10.2 Detectar PixelX carregada duas vezes

A causa de duplicação mais invisível ([§3.2](#32-existem-dois-jeitos-de-a-pixelx-entrar-na-página)):

```js
// 1. Quantos scripts da PixelX entraram na página?
performance.getEntriesByType("resource")
  .filter(r => /pxa|pixel/i.test(r.name))
  .map(r => r.name);
```

Se aparecer mais de um script de origem PixelX (por exemplo um `/remote?url=` do
HTML **e** outro carregado pela tag do GTM), está carregando em dobro. Remova o
loader direto do `<head>` e deixe só o do GTM — ou o contrário, mas **só um**.

```js
// 2. Loader direto sobrando no HTML?
document.documentElement.innerHTML.includes("/remote?url=");   // true = loader direto presente
```

### 10.3 Auditoria de emissores duplicados

Rode **todos** os testes. É o passo que resolve a Falha B.

```js
/* --- Emissor 3: send_event manual no código do site --- */
// Procure "send_event" no fonte do site (Ctrl+Shift+F no editor, ou Sources no DevTools).

/* --- Emissor 4: Meta Pixel disparando Lead por conta própria --- */
typeof fbq;                        // "function" = Meta Pixel presente
// Procure fbq('track', 'Lead') no fonte.

/* --- Emissor 2: conversão por classe (hash opaco no botão) --- */
document.getElementById("lead_submit")?.className;
// Uma classe que parece hash aleatório (ex: "xrmmmmzdllmckwinbxuh") É uma
// regra de clique configurada no painel. Some com as regras de submit.

/* --- Quantos listeners de submit existem de fato --- */
// DevTools → aba Elements → selecione o <form> → painel "Event Listeners"
// → marque "Ancestors". Mais de um listener de submit vindo da PixelX = duplicado.
```

E no **painel da PixelX**, confira se existe mais de uma regra de conversão ativa
para o mesmo formulário — uma de `submit` e uma de clique convivendo é o caso
clássico de duplicação sem nenhuma pista no código.

### 10.4 O formulário emite `submit` nativo?

```js
document.addEventListener('submit', e => console.log('SUBMIT NATIVO:', e.target), true);
```

Envie o formulário. Silêncio no console = [§8.3](#83-formulários-que-não-emitem-submit-nativo),
e o Modelo A é inviável nesse site.

### 10.5 O vínculo com o formulário está certo?

```js
const ID = "SEU_ID_DO_FORM";
document.querySelectorAll(`[id="${ID}"]`).length;    // tem que ser exatamente 1
document.getElementById(ID)?.tagName;                // tem que ser "FORM"

// Todo campo precisa de name E id:
[...document.getElementById(ID).elements]
  .map(el => ({ tag: el.tagName, id: el.id, name: el.name, classe: el.className }));
```

Confirme que o `id` é **o mesmo cadastrado no painel daquela conta** — no Modelo
A isso é obrigatório, e é a causa nº 1 da Falha A.

### 10.6 Contagem ponta a ponta

Em **aba anônima** (o `form_auto_fill` da PixelX preenche campos sozinho e
contamina o teste — ver [§13](#13-o-que-não-dá-para-controlar-pelo-site)):

1. Abra a página, aguarde ~10 s.
2. Preencha e envie **uma vez**.
3. Na aba Network, filtre pelo domínio do loader e conte as requisições de evento
   disparadas no envio.
4. Confira o painel: **1 envio deve virar exatamente 1 Lead.**

> Se o número no painel crescer conforme o tempo que a página ficou aberta antes
> do envio (1 Lead enviando rápido, 2–3 enviando depois de um minuto), suspeite de
> acumulação de listeners por `setInterval` — ver [§13](#13-o-que-não-dá-para-controlar-pelo-site).
> **Hipótese a confirmar caso a caso**, não é comportamento verificado no fonte
> para o listener de submit.

---

## 11. Checklist de replicação

### 11.1 Validador automático

Antes de conferir à mão, rode o validador. Ele executa este checklist inteiro e
aponta o item exato que falhou:

```bash
node validar-tracking.js <pasta-do-site>

# exemplos
node validar-tracking.js .
node validar-tracking.js ../aniversario-captura
```

Sai com código **0** se tudo passar e **1** se houver falha — dá para usar como
gate de pre-deploy. São 25 verificações, e **cada uma corresponde a um defeito
que já zerou ou inflou o Lead em produção**.

Estado atual das landings:

| Site | Resultado |
|---|---|
| captura-cppem | 25/25 |
| ManyChat | 25/25 |
| Aniversário | 25/25 |
| pmpe | 17/25 — nomenclatura não-canônica, **mas funcionando** (ver nota abaixo) |

> **Sobre o pmpe:** ele usa `nome`/`email`/`telefone` e tem um `send_event`
> residual, e mesmo assim entrega o Lead. Está em produção e não deve ser
> mexido sem necessidade. Mas se um dia parar, **alinhar a nomenclatura é o
> primeiro passo** — é a divergência conhecida.

O validador cobre: nomenclatura canônica, identificador do painel (existe, é
`id` e não `class`, é único, é estático), container (1 loader, dentro do
`<head>`, sem loader direto, `noscript` correto), JavaScript (validação por
dígitos, sem `reset()`, redirect com espera, duas barreiras, emissor único) e
consistência JS↔HTML (ids existem, chaves de erro casam, sem acesso nomeado
`form.<campo>`, `label for=` resolvem).

Ele ignora comentários de HTML e de JS — sem isso, um comentário citando
`form.reset()` ou um `id` viraria falso-positivo.

### 🔴 0. NOMENCLATURA — faça esta antes de qualquer outra

Copie de um site que funciona e confira **valor por valor**. Divergência aqui
não dá erro no console: o GTM recebe o Lead e o Meta não recebe nada
([§6.0](#60--a-nomenclatura-não-é-cosmética--ela-é-o-vínculo), [§8.8](#88-caso-manychat-nomenclatura-divergente)).

- [ ] `<form name="lead_form">` — o `name` existe e é exatamente esse
- [ ] `<form id="…">` carrega o **identificador do painel** — no `<form>`, **não** no botão
- [ ] `id="lead_name"` **e** `name="name"`
- [ ] `id="lead_email"` **e** `name="email"`
- [ ] `id="lead_phone"` **e** `name="phone"` **e** `class="pxa_mask_phone"`
- [ ] `<button type="submit" id="lead_submit">`
- [ ] `data-error-for` = `name`, `email`, `phone` (não `nome`/`telefone`)
- [ ] O identificador do painel é **`id`**, nunca `class` (`#x` ≠ `.x`)
- [ ] O identificador é **estático** — nenhum `classList.toggle` sobre ele
- [ ] O `script.js` referencia **os mesmos** ids e as mesmas chaves de erro

> **Nunca traduza nomes de campo.** `nome`, `telefone` e `lead-form` funcionam
> para identificação e máscara, e mesmo assim quebram a conversão.

### A. Trocar (nenhum destes sobrevive ao copiar/colar)

- [ ] `id` do `<form>` — **nos dois lugares**: HTML e `script.js`
- [ ] Domínio + path do loader sGTM
- [ ] ID do container no `noscript` (e sem espaço depois de `id=`)
- [ ] Domínio do loader direto da PixelX, **se** for usá-lo
- [ ] URL de redirecionamento (WhatsApp/obrigado)
- [ ] Classe de conversão por clique, se o site usar esse mecanismo
- [ ] `CONFIG.phoneMode` conforme o site aceite celular, fixo ou internacional

### B. HTML

- [ ] `id` do `<form>` único na página (`querySelectorAll('[id="..."]').length === 1`)
- [ ] Botão com `id` próprio, `type="submit"`, e **sem** `name="submit"`
- [ ] Todo campo com `id` **e** `name` (o `name` é obrigatório para a máscara)
- [ ] `name` casando com as keywords: `name`, `email`, `phone`
- [ ] Classe `pxa_mask_phone` no campo de telefone
- [ ] `novalidate` no form (a validação é nossa)
- [ ] Nenhum `id` repetido entre form e botão

### C. JavaScript

- [ ] Listener de `submit` no `document` em **fase de captura** — nunca `click`
      com `preventDefault`
- [ ] `stopImmediatePropagation()` quando inválido
- [ ] Validação de telefone por **dígitos**, removendo o `+55` antes de contar
- [ ] Sem `form.reset()` antes do redirecionamento
- [ ] Atraso de redirecionamento ≥ 1500 ms
- [ ] Guarda de idempotência no disparo do Lead
- [ ] `waitForPixel()` antes de `send_event` (Modelo B)
- [ ] Script incluído **uma única vez** na página

### D. Emissor único — o passo que impede a Falha B

- [ ] Modelo escolhido explicitamente: **A** (painel) **ou** **B** (site)
- [ ] Modelo B → regra de Lead no painel **desligada** (submit **e** clique)
- [ ] Modelo A → **nenhum** `send_event('Lead')` no código do site
- [ ] Nenhum `fbq('track', 'Lead')` concorrente (ou ciente de que é outra
      plataforma, e conferido nos dois painéis)
- [ ] Nenhuma classe-hash de conversão sobrando em botão
- [ ] PixelX carregada por **um** caminho só — GTM **ou** loader direto
- [ ] Teste de [§10.6](#106-contagem-ponta-a-ponta): 1 envio = 1 Lead

### E. Painel da PixelX

- [ ] Formulário cadastrado com o `id` correto **daquela conta** (Modelo A)
- [ ] `phone_mask` configurado (senão a máscara nem carrega)
- [ ] Uma única regra de conversão ativa por formulário
- [ ] Conferido se `power_ups.form_auto_fill` está ligado (afeta os testes)

---

## 12. Tabela sintoma → causa

| Sintoma | Causa provável | Onde ler |
|---|---|---|
| 🔴 **Nem GTM nem Meta recebem Lead; só pageview** | Identificador do painel como `class` em vez de `id`, ou removido do DOM em runtime | [§6.0](#60--a-nomenclatura-não-é-cosmética--ela-é-o-vínculo), [§8.9](#89-caso-aniversário-identificador-como-class-e-loader-duplicado) |
| Métricas historicamente dobradas | Loader do GTM duplicado (`<head>` + `<body>`) | [§3.2](#32-existem-dois-jeitos-de-a-pixelx-entrar-na-página), [§8.9](#89-caso-aniversário-identificador-como-class-e-loader-duplicado) |
| 🔴 **Lead chega no GTM, Meta não recebe nada** — e a máscara funciona | **Nomenclatura divergente.** Máscara OK prova que a PixelX carregou, não que a regra está vinculada | [§6.0](#60--a-nomenclatura-não-é-cosmética--ela-é-o-vínculo), [§8.8](#88-caso-manychat-nomenclatura-divergente) |
| Campos em português (`nome`, `telefone`) e conversão zerada | Idem — identificam pelo keyword, mas não vinculam a regra | [§6.0](#60--a-nomenclatura-não-é-cosmética--ela-é-o-vínculo) |
| **Só pageview e general event; Lead nunca chega** | `id` do form copiado do site anterior — não existe no painel desta conta | [§8.1](#81-valores-que-são-específicos-de-cada-site) |
| Idem, e o `id` está correto | Formulário não emite `submit` nativo | [§8.3](#83-formulários-que-não-emitem-submit-nativo) |
| Idem, e usuário vê mensagem de erro no campo | Validação bloqueando envios legítimos | [§8.4](#84-a-barreira-de-validação-matando-o-lead) |
| Lead chega em desktop mas some em mobile/3G | Corrida com o `start()` async, ou redirect antes do envio | [§8.5](#85-corrida-com-o-start-assíncrono), [§7.6](#76-formreset-e-redirecionamento-cedo-demais) |
| **Lead duplicado (2×)** | Dois emissores ativos — quase sempre painel + `send_event` manual | [§4](#4-inventário-dos-5-emissores-de-lead) |
| **Lead triplicado (3×)** | Painel + `send_event` + `fbq`, ou painel + clique-por-classe + `send_event` | [§4](#4-inventário-dos-5-emissores-de-lead) |
| Tudo duplicado, inclusive pageview | PixelX carregada duas vezes | [§3.2](#32-existem-dois-jeitos-de-a-pixelx-entrar-na-página), [§10.2](#102-detectar-pixelx-carregada-duas-vezes) |
| Duplica só às vezes | Duplo clique sem guarda de idempotência | [§9](#9-template-portável) |
| Página recarrega / URL ganha `?name=...` | `form === null` (id trocado só no HTML), ou erro de JS antes do listener | [§8.1](#81-valores-que-são-específicos-de-cada-site) |
| Sucesso e redirect com campo inválido | `validate()` retornando `true` — quase sempre a contagem do `+55` | [§7.7](#77-validar-o-telefone-pelo-length-da-string--o-erro-mais-traiçoeiro) |
| Botão some / form fica em branco ao clicar | `id` duplicado entre `<form>` e `<button>` | [§7.1](#71-id-duplicado-entre-o-form-e-o-button) |
| Máscara não aplica | `name` ausente no input, ou `phone_mask` não configurado no painel | [§6](#61-como-a-pixelx-identifica-os-campos) |
| Campo se preenche sozinho | `power_ups.form_auto_fill` — teste em aba anônima | [§13](#13-o-que-não-dá-para-controlar-pelo-site) |
| Telefone válido é rejeitado | `phoneMode` errado — site aceita fixo ou outro país | [§8.6](#86-a-validação-de-telefone-não-é-universal) |
| Chegam leads sem envio nenhum | Captura no `blur` — comportamento normal da PixelX, não é Lead | [§13](#13-o-que-não-dá-para-controlar-pelo-site) |

---

## 13. O que não dá para controlar pelo site

A PixelX grava dados do lead no **`blur` de cada campo**, sem nenhuma relação com
submit:

```js
async input_monitor(field) {
    field.addEventListener('blur', async event => {
        await this.input_save(event.target.name, event.target.value, field);
        this.debounce_send_lead_data()
    })
}
```

Consequência: **dados parciais chegam ao painel mesmo sem envio nenhum.** Nenhuma
validação no site impede isso. O que as correções garantem é que o **evento de
conversão** só dispare com os dados completos.

Não confunda os dois ao auditar: "apareceu um lead pela metade no painel" é este
mecanismo, e é esperado. Só conte **eventos de Lead**.

Dois comportamentos do vendor que vale conhecer ao depurar:

- `monitor_forms()` roda em `setInterval(..., 5000)` e chama `input_monitor()` de
  novo a cada volta, **sem guarda contra listener duplicado** (diferente do
  `monitor_forms_dynamic`, que usa a classe `pxa_tracked`). Os listeners de
  `blur` se acumulam enquanto a página estiver aberta. Isso multiplica requisições
  de **captura de dados**; se você observar o **Lead** também escalando com o
  tempo de página aberta, investigue por qual das duas funções a regra daquele
  painel está vinculada.
- `power_ups.form_auto_fill` preenche campos **vazios** a cada 5 s com dados de
  leads anteriores guardados em cookie/localStorage. Ao testar, isso pode fazer
  um campo "se preencher sozinho". Use uma aba anônima.

E o `phone_valid()` reescreve o campo no blur quando `power_ups.phone_update`
está ligado, **promovendo 10 dígitos para 11** ao inserir o nono dígito:

```js
if (phone.length === 10) { phone = `55${phone.substring(0,2)}9${phone.substring(2)}` }
```

Por isso a validação do site precisa aguentar receber o campo em qualquer um dos
três formatos: mascarado, cru ou já normalizado com `+55`.

---

## 14. Estado atual deste projeto

**Modelo em uso: B** (o site dispara o Lead). Configurado no topo do
[script.js](script.js):

```js
var LEAD_MODE = 'site';   // 'site' (Modelo B) | 'painel' (Modelo A)
```

### Por que Modelo B aqui

Auditoria feita no código: **nenhum** `send_event`, **nenhum** `fbq`, **nenhum**
loader direto da PixelX. O site não tinha emissor de Lead algum.

E o `<form>` tem `id="leadForm"` — um id **genérico**, não o id opaco que o
painel gera (nas outras landings da CPPEM é algo como `IPEyzyfmJhKQEYIXAlZH`).
Pelo [§6](#6-como-a-pixelx-identifica-os-campos), é esse id que vincula o
formulário à regra do painel. Sem ele, uma regra de submit não encontra nada
para vincular — **é a Falha A**.

O Modelo B não depende desse casamento, então resolve sem exigir acesso ao
painel.

> Se preferir o Modelo A: cadastre este formulário no painel, troque
> `id="leadForm"` pelo id que ele devolver (**nos dois lugares** — HTML e
> `script.js`) e mude `LEAD_MODE` para `'painel'`.

### Como a duplicação fica impedida

A barreira de submit ([§7.8](#78-ordem-de-registro-dos-listeners-de-submit)) corta
a propagação em fase de captura no `document`:

| Emissor | Situação |
|---|---|
| Regra de **submit** no painel | **Inerte** — o evento nunca chega ao `<form>` |
| `send_event` do site | Único ativo, com guarda de idempotência |
| `fbq('track','Lead')` | Não existe no projeto |
| Loader direto da PixelX | Não existe no projeto |
| Regra de **clique** no painel | ⚠️ **Não dá para neutralizar pelo site** |

> ⚠️ Uma regra de conversão **por clique** no painel dispararia junto com a
> nossa e duplicaria. O site não tem como impedir, porque o clique acontece
> antes do submit. Confira no painel — teste de
> [§10.3](#103-auditoria-de-emissores-duplicados).

### O que foi corrigido

| Defeito encontrado | Seção | Correção |
|---|---|---|
| Listener de `submit` no próprio `<form>`, sem `stopImmediatePropagation` no inválido — a PixelX registraria Lead com dado ruim | [§7.8](#78-ordem-de-registro-dos-listeners-de-submit) | Barreira em fase de **captura** no `document` |
| Telefone validado por `10 a 13 dígitos` — aceitava fixo, incompleto, e contava o `+55` da máscara | [§7.7](#77-validar-o-telefone-pelo-length-da-string--o-erro-mais-traiçoeiro) | Regra por dígitos nacionais, removendo o `+55` pelo `+` literal |
| Redirect por `Promise.race` sem piso: com `no-cors` o `fetch` resolve em ~200ms e a navegação cancelava o evento | [§7.6](#76-formreset-e-redirecionamento-cedo-demais) | Piso fixo de `REDIRECT_DELAY_MS = 1500` |
| Sem `pxa_mask_phone` no campo de telefone | [§6](#6-como-a-pixelx-identifica-os-campos) | Classe adicionada |
| Telefone ia sem código de país (viraria `+81…`, Japão) | — | `toE164()` antes do `send_event` |
| Sem guarda de idempotência | [§9](#9-template-portável) | `leadEnviado` + `enviado` |

### Diagnóstico no console

```js
cppemTracking.state()             // { leadMode, leadEnviado, pixelPronto }
cppemTracking.isPhone('...')      // testa a regra de telefone
cppemTracking.toE164('...')       // confere a normalização
```

### Verificação automatizada

**24 testes** em Chrome real, com uma PixelX falsa que conta cada Lead recebido
e um espião no listener do `<form>` simulando a regra do painel:

- telefone: rejeita incompleto, fixo e a contagem enganosa do `+55`; aceita
  mascarado, cru e DDD 55
- E.164: adiciona `+55`, não duplica país, preserva DDD 55
- submit inválido → **zero** Lead, não redireciona, mostra os erros
- submit válido → **exatamente 1** Lead, com nome, e-mail minúsculo e E.164
- regra de submit do painel → **não dispara**
- envio repetido → continua **1** Lead e **1** redirect

### ⚠️ Pendências fora do escopo de tracking

Duas coisas que encontrei na auditoria, **não corrigidas** por serem do
backend de dados e não do rastreamento:

1. **O corpo do POST é `x-www-form-urlencoded`**, mas o
   [google-apps-script.js](../pmpe/google-apps-script.js) das outras landings
   faz `JSON.parse(e.postData.contents)`. Se a implantação usada aqui for a
   mesma, o parse falha e **nada é gravado**. As outras landings enviam JSON.
2. **A chave do telefone é `whatsapp`**, e o Apps Script lê `dados.telefone`.
   Mesmo com o parse funcionando, a coluna Telefone chegaria vazia.

O `ENDPOINT` aponta para `?aba=CASA` da **mesma implantação** usada por PMPE e
UniCV. O roteamento por aba só funciona depois da nova implantação do Apps
Script corrigido — uma só resolve para todas as landings.

### Arquivos

- [index.html](index.html) — loader do GTM no `<head>`, `#leadForm` no modal
- [script.js](script.js) — `LEAD_MODE`, `trackLead()`, `waitForPixel()`,
  `toE164()` e a barreira de submit
