/* =========================================================
   CPPEM · OPERAÇÃO ALVORADA (11ª edição) — script
   ========================================================= */
(function () {
  'use strict';

  var ENDPOINT = 'https://script.google.com/macros/s/AKfycbxdFplWVSfhTjvyIA7HIWb645xRjGNhBVhTdTf5UMjo0lSpW_A_jCuys0qB4uImKXPQ/exec?aba=OPERACAO';
  var ABA = 'OPERACAO';
  var CHECKOUT = 'https://checkout.cppem.com.br/pay/operacao-alvorada-lote-01';

  /* =========================================================
     Tracking de Lead — Modelo A (§5): quem dispara é o PAINEL

     REGRA DE OURO: exatamente UM emissor de Lead. Aqui ele é a regra de
     conversão do painel da PixelX, vinculada ao id opaco do <form>
     (IPEyzyfmJhKQEYIXAlZH). Este arquivo NÃO emite conversão.

     POR QUE O MODELO B FOI REMOVIDO

     Antes o site chamava `pixel_x_app.send_event()` diretamente. Um send_event
     é NÃO-ROTEADO: não passa por regra de conversão nenhuma, então a PixelX o
     entrega pelo padrão da conta — que aqui era TODOS os destinos. Era isso que
     fazia o Lead aparecer nas três tags Meta.

     O mesmo mecanismo explica o sintoma oposto visto no PMPE (§8.7), onde o
     send_event não chegava a NENHUMA tag. Sem roteamento, o destino é o padrão
     da conta: pode ser tudo ou nada, nunca o destino certo por acaso.

     Quem roteia é a REGRA, e a regra só existe atrelada ao id do <form>.

     O que este arquivo faz: valida, grava na planilha, redireciona — e não
     atrapalha a conversão (sem preventDefault no clique válido, sem
     stopPropagation quando válido, sem sair da página cedo demais).
     ========================================================= */
  var PHONE_MODE = 'celular_br';   // 'celular_br' | 'celular_ou_fixo_br' | 'internacional'
  var REDIRECT_DELAY_MS = 1500;    // §7.6 — abaixo de ~1s começa a perder eventos

  /* ---------- ano ---------- */
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- header sticky + barra de progresso + parallax ---------- */
  var header = document.getElementById('header');
  var progress = document.getElementById('progress');
  var heroBg = document.getElementById('heroBg');
  var ticking = false;

  function render() {
    var y = window.scrollY;
    header.classList.toggle('is-stuck', y > 40);

    var max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.width = (max > 0 ? (y / max) * 100 : 0) + '%';

    if (!reduced && heroBg && y < window.innerHeight * 1.2) {
      heroBg.style.transform = 'scale(1.06) translateY(' + (y * 0.18) + 'px)';
    }
    ticking = false;
  }
  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(render); }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  render();

  /* ---------- contagem regressiva para a Operação ---------- */
  /* A data-alvo mora no atributo data-target do #countdown (index.html) — é o
     único lugar a mexer se o evento mudar de dia. */
  var cdown = document.getElementById('countdown');

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  if (cdown) {
    var alvo = new Date(cdown.getAttribute('data-target')).getTime();
    var cdD = document.getElementById('cdD');
    var cdH = document.getElementById('cdH');
    var cdM = document.getElementById('cdM');
    var cdS = document.getElementById('cdS');

    var tickCountdown = function () {
      var falta = alvo - Date.now();

      if (falta <= 0) {
        cdown.classList.add('is-over');
        cdD.textContent = cdH.textContent = cdM.textContent = cdS.textContent = '00';
        clearInterval(cdTimer);
        return;
      }

      var seg = Math.floor(falta / 1000);
      cdD.textContent = pad(Math.floor(seg / 86400));
      cdH.textContent = pad(Math.floor(seg / 3600) % 24);
      cdM.textContent = pad(Math.floor(seg / 60) % 60);
      cdS.textContent = pad(seg % 60);
    };

    var cdTimer = setInterval(tickCountdown, 1000);
    tickCountdown();

    /* ---------- barra do 1º lote ---------- */
    /* O 1º lote são 150 cadeiras — não as 250 da sede, que é a capacidade total
       do evento somando todos os lotes.

       A barra é ancorada num número REAL e cresce sozinha daí até a data do
       evento: em DATA_ANCORA havia OCUPADAS_ANCORA cadeiras vendidas, e a
       projeção caminha linearmente até OCUPADAS_TETO na véspera da abertura.
       É determinística pela data — recarregar a página nunca faz o número
       andar para trás. Para recalibrar com a venda real, basta atualizar as
       duas constantes da âncora. */
    var LOTE_CADEIRAS   = 150;
    /* fim do dia 31/07, não o começo: antes da âncora o avanço é travado em 0,
       então o dia inteiro mostra exatamente as 68 cadeiras contadas na mão. */
    var DATA_ANCORA     = new Date('2026-07-31T23:59:00-03:00').getTime();
    var OCUPADAS_ANCORA = 68;
    var OCUPADAS_TETO   = 146;   // nunca 150: sempre sobra a última chance

    var loteFill = document.getElementById('loteFill');
    var loteBar  = document.getElementById('loteBar');
    var loteLeft = document.getElementById('loteLeft');

    if (loteFill && loteLeft) {
      var span = alvo - DATA_ANCORA;
      var andado = Math.min(Math.max((Date.now() - DATA_ANCORA) / span, 0), 1);
      var ocupadas = Math.round(OCUPADAS_ANCORA + (OCUPADAS_TETO - OCUPADAS_ANCORA) * andado);
      var restam = Math.max(LOTE_CADEIRAS - ocupadas, 1);
      var pct = Math.round((ocupadas / LOTE_CADEIRAS) * 100);

      loteLeft.textContent = 'restam ' + restam + ' de ' + LOTE_CADEIRAS + ' cadeiras';
      if (loteBar) loteBar.setAttribute('aria-valuenow', String(pct));

      // pinta no próximo frame para a transição de largura acontecer
      requestAnimationFrame(function () { loteFill.style.width = pct + '%'; });
    }
  }

  /* ---------- reveal on scroll (com escalonamento) ---------- */
  var targets = document.querySelectorAll('.section__head, .card, .steps li, .final__inner, .cdown, .lote, .ficha__item, .corridao, .duo__col, .faq__item, .lineup__card');
  Array.prototype.forEach.call(targets, function (el) { el.classList.add('reveal'); });

  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      var i = 0;
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.style.transitionDelay = (i++ * 90) + 'ms';
        e.target.classList.add('is-visible');
        io.unobserve(e.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -60px' });
    Array.prototype.forEach.call(targets, function (el) { io.observe(el); });
  } else {
    Array.prototype.forEach.call(targets, function (el) { el.classList.add('is-visible'); });
  }

  /* ---------- brilho seguindo o cursor nos cards ---------- */
  Array.prototype.forEach.call(document.querySelectorAll('.card'), function (card) {
    card.addEventListener('mousemove', function (e) {
      var r = card.getBoundingClientRect();
      card.style.setProperty('--mx', ((e.clientX - r.left) / r.width) * 100 + '%');
      card.style.setProperty('--my', ((e.clientY - r.top) / r.height) * 100 + '%');
    });
  });

  /* ---------- partículas douradas na hero ---------- */
  var sparks = document.getElementById('sparks');
  if (sparks && !reduced) {
    for (var s = 0; s < 16; s++) {
      var p = document.createElement('i');
      p.className = 'spark';
      p.style.left = (Math.random() * 100) + '%';
      p.style.bottom = (Math.random() * 45) + '%';
      p.style.animationDuration = (7 + Math.random() * 8).toFixed(1) + 's';
      p.style.animationDelay = (Math.random() * 9).toFixed(1) + 's';
      p.style.transform = 'scale(' + (0.5 + Math.random()).toFixed(2) + ')';
      sparks.appendChild(p);
    }
  }

  /* ---------- modal ---------- */
  var modal = document.getElementById('modal');
  var lastFocus = null;

  function openModal() {
    lastFocus = document.activeElement;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    var first = document.getElementById('lead_name');
    if (first) setTimeout(function () { first.focus(); }, 60);
  }

  function closeModal() {
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (lastFocus) lastFocus.focus();
  }

  Array.prototype.forEach.call(document.querySelectorAll('.js-open'), function (btn) {
    btn.addEventListener('click', openModal);
  });
  Array.prototype.forEach.call(modal.querySelectorAll('[data-close]'), function (el) {
    el.addEventListener('click', closeModal);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && modal.classList.contains('is-open')) closeModal();
  });

  /* ---------- telefone e Lead (ver TRACKING.md) ---------- */

  /* §7.7 — conta DÍGITOS, não caracteres, e remove o "+55" pelo "+" literal
     antes de contar. A máscara da PixelX escreve "+{55}" como texto fixo, e
     esses dois dígitos mascaram números incompletos: "+55 (81) 9996-741"
     soma 11 dígitos e passaria por um teste ingênuo de "11 dígitos".
     Remover pelos dígitos seria ambíguo — o DDD 55 existe (Santa Maria/RS). */
  function phoneDigitsNacional(v) {
    return String(v || '').trim().replace(/^\+\s*55\s*/, '').replace(/\D/g, '');
  }

  function isPhone(v) {
    var d = phoneDigitsNacional(v);

    if (PHONE_MODE === 'celular_ou_fixo_br') return d.length === 10 || d.length === 11;
    if (PHONE_MODE === 'internacional')      return d.length >= 8 && d.length <= 15;

    return d.length === 11 && d[2] === '9';   // celular_br (padrão)
  }

  /* Superfície de diagnóstico no console (§10). Sem trackLead/send_event: no
     Modelo A o site não emite conversão — quem emite é a regra do painel.
       cppemTracking.isPhone('...')  -> testa a regra de telefone
       cppemTracking.state()         -> confere se a PixelX carregou e se o id
                                        do painel está no <form> */
  window.cppemTracking = {
    isPhone: isPhone,
    state: function () {
      return {
        modelo: 'A (painel)',
        pixelCarregado: !!window.pixel_x_app,
        formDoPainel: !!document.getElementById(PIXELX_ID)
      };
    }
  };

  /* ---------- validação ---------- */
  /* Identificador deste site no painel — o mesmo valor do id do <form>. */
  var PIXELX_ID = 'IPEyzyfmJhKQEYIXAlZH';

  var form = document.getElementById(PIXELX_ID);

  /* Referências explícitas em vez de form.elements[...]: com name="name", o
     acesso nomeado colide com a propriedade nativa HTMLFormElement.name —
     mesma família de armadilha do §7.3. */
  var nomeInput = document.getElementById('lead_name');
  var emailInput = document.getElementById('lead_email');
  var telefoneInput = document.getElementById('lead_phone');
  var submitBtn = document.getElementById('lead_submit');
  var btnLabel = submitBtn.querySelector('.btn__label');
  var spinner = submitBtn.querySelector('.spinner');

  var CAMPOS = { name: nomeInput, email: emailInput, phone: telefoneInput };

  /* Falha barulhenta em vez de silenciosa (§8.1). */
  if (!form) {
    console.error('[tracking] Formulário "' + PIXELX_ID + '" não encontrado.');
  }

  function setError(key, msg) {
    var input = CAMPOS[key];
    var slot = form.querySelector('[data-error-for="' + key + '"]');
    if (slot) slot.textContent = msg || '';
    if (input) input.classList.toggle('is-invalid', !!msg);
  }

  function validate() {
    var ok = true;
    var nome = nomeInput.value.trim();
    var email = emailInput.value.trim();
    var zap = telefoneInput.value.trim();

    if (nome.length < 3 || nome.indexOf(' ') === -1) {
      setError('name', 'Informe seu nome completo.'); ok = false;
    } else setError('name', '');

    if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) {
      setError('email', 'Informe um e-mail válido.'); ok = false;
    } else setError('email', '');

    if (!isPhone(zap)) {
      setError('phone', 'Informe seu WhatsApp com DDD — ex: (81) 90000-0000.'); ok = false;
    } else setError('phone', '');

    return ok;
  }

  Object.keys(CAMPOS).forEach(function (k) {
    CAMPOS[k].addEventListener('input', function () {
      if (CAMPOS[k].classList.contains('is-invalid')) validate();
    });
  });

  function loading(state) {
    submitBtn.disabled = state;
    spinner.hidden = !state;
    btnLabel.textContent = state ? 'REDIRECIONANDO...' : 'IR PARA O CHECKOUT';
  }

  /* ---------- envio ---------- */
  var enviado = false;   // guarda de idempotência

  function enviar() {
    if (enviado) return;
    enviado = true;

    loading(true);

    var payload = {
      aba: ABA,        // janela/aba CASA dentro da planilha
      janela: ABA,
      sheet: ABA,
      tab: ABA,
      pagina: 'Operação Alvorada',
      produto: 'Operação Alvorada 11ª Edição',
      /* As CHAVES abaixo continuam nome/email/whatsapp de propósito: são as
         colunas da planilha (aba CASA). Só a origem dos valores mudou. */
      nome: nomeInput.value.trim(),
      email: emailInput.value.trim(),
      whatsapp: telefoneInput.value.trim(),
      origem: window.location.href,
      data: new Date().toLocaleString('pt-BR')
    };

    /* O Lead NÃO é disparado aqui: no Modelo A quem dispara é a regra do
       painel, quando o evento de submit propaga (ver segunda barreira). */

    // Planilha em fire-and-forget: com no-cors não dá para ler a resposta,
    //    então esperar não garante nada — só atrasaria o visitante.
    var params = new URLSearchParams(payload).toString();
    fetch(ENDPOINT, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: params
    }).catch(function (err) {
      console.error('[Form] Falha ao salvar na planilha (segue o redirect):', err);
    });

    // 3. §7.6 — piso de 1500ms antes de navegar. O Promise.race anterior
    //    redirecionava assim que o fetch no-cors resolvia (~200ms), e nesse
    //    tempo o evento de conversão não chega a sair.
    // Mesma janela, sem target="_blank": o visitante sai daqui direto para o
    // checkout do 1º lote. O piso de 1500ms acima é exigência do rastreamento.
    setTimeout(function () {
      window.location.href = CHECKOUT;
    }, REDIRECT_DELAY_MS);
  }

  /* PRIMEIRA BARREIRA — no clique do botão, fase de captura (§7.8).
     Se os dados forem inválidos, o preventDefault cancela a ação padrão do
     botão e o navegador NUNCA chega a disparar o evento "submit". O Enter
     também passa por aqui, via submissão implícita. */
  if (submitBtn) {
    submitBtn.addEventListener('click', function (e) {
      if (!validate()) e.preventDefault();
    }, true);
  }

  /* SEGUNDA BARREIRA — "submit" capturado no DOCUMENT, em fase de captura (§7.8).
     Roda SEMPRE antes de qualquer listener registrado no <form>, inclusive o
     que a PixelX instala de dentro de um start() assíncrono.

     - Inválido -> stopImmediatePropagation: o evento morre aqui e nenhum Lead
                   é registrado com dado ruim.
     - Válido   -> PROPAGA, e é assim que a regra do painel registra o Lead.
                   Cortar a propagação aqui zeraria a conversão. */
  document.addEventListener('submit', function (e) {
    if (!form || e.target !== form) return;

    e.preventDefault();

    if (!validate()) {
      e.stopImmediatePropagation();
      var bad = form.querySelector('.is-invalid');
      if (bad) bad.focus();
      return;
    }

    enviar();
  }, true);
})();
