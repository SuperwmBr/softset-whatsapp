export async function getGreetingIfNoMessageToday(env, phone, setup_data) {
    try {
      // 1. Obter a data atual no formato "YYYY-MM-DD" no fuso UTC-3 (São Paulo)
      const [dia, mes, ano] = new Date().toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).split('/');
      const currentDate = `${ano}-${mes}-${dia}`;
      // Correção: agora temos currentDate e vamos usá-la na query
  
      // 2. Preparar query usando placeholder para a data
      const query = `
        SELECT MAX(data_hora) AS earliest_moment
        FROM WHATSAPP_MENSAGENS
        WHERE token = ?
          AND phone = ?
          AND DATE(data_hora, '-3 hours') = ?
      `;
  
      // 3. Executa a query com os parâmetros token, telefone e data de hoje
      const result = await env.db
        .prepare(query)
        .bind(setup_data.app_key, phone, currentDate) // Correção: agora bind inclui currentDate
        .first();
  
      // 4. Se já existe mensagem hoje, não retorna saudação
      if (result && result.earliest_moment) {
        return "";
      }
  
      // 5. Caso contrário, calcula hora atual em UTC-3 e escolhe a saudação
      const hourFormatter = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        hour12: false
      });
      const currentHour = parseInt(hourFormatter.format(new Date()), 10);
  
      if (currentHour >= 6 && currentHour < 12) {
        return "Bom dia";
      } else if (currentHour >= 12 && currentHour < 18) {
        return "Boa tarde";
      } else {
        return "Boa noite";
      }
  
    } catch (error) {
      console.error(
        `getGreetingIfNoMessageToday :: Erro ao obter mensagens do cliente (app_key: ${setup_data.app_key}, phone: ${phone}):`,
        error
      );
      // Correção: garante que a função nunca lance exceção, sempre retorna string
      return "";
    }
  }
  
  
 export function checkAfterHours(dayOfWeek, hour) {
    // Verifica se é fora do horário comercial conforme o dia e hora de São Paulo
    if (dayOfWeek === "sáb" && (hour < 9 || hour > 12)) return true;
    if (dayOfWeek === "dom.") return true;
    if (dayOfWeek !== "sáb" && dayOfWeek !== "dom") {
      if (hour < 9 ||
        // (hour >= 12 && hour < 13.5) 
        hour >= 18) return true;
    }
    return false;
  }
  
  // Função para consultar dados da tabela Whatsapp_message no D1
  export async function getDataFromD1(db) {
    const query = `
      SELECT  phone, momment, photo, senderName
      FROM Whatsapp_message order by momment desc
    `;
    const { results } = await db.prepare(query).all();
    return results;
  }
  
  // Função para agrupar os dados por hora
  function groupDataByHour(data) {
    const result = {};
  
    data.forEach(entry => {
      const date = new Date(entry.momment);
      date.setHours(date.getHours() - 3); // Ajusta o fuso horário para -3
  
      // Formata o `hourKey` no formato "DD/MM ( HH )"
      const day = String(date.getDate()).padStart(2, '0');
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const hour = String(date.getHours()).padStart(2, '0');
      const hourKey = `${day}/${month} ( ${hour} )`;
  
      if (!result[hourKey]) result[hourKey] = 0;
      result[hourKey]++;
    });
  
    return result;
  }
  
  
  
export function formatarNumeroWhatsApp(numero) {
    // Converte para string e remove caracteres não numéricos
    let numeroLimpo = String(numero).replace(/\D/g, '');
  
    // Verifica se começa com 55 (Brasil)
    if (numeroLimpo.startsWith('55')) {
      // Remove o 55 para trabalhar só com DDD + número
      const numeroSemPais = numeroLimpo.slice(2);
  
      // Verifica se tem entre 10 e 11 dígitos (com ou sem 9 extra)
      if (numeroSemPais.length === 10) {
        // Formato sem o 9 extra: (XX) XXXX-XXXX
        return numeroSemPais.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3');
      } else if (numeroSemPais.length === 11) {
        // Formato com o 9 extra: (XX) XXXXX-XXXX
        return numeroSemPais.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3');
      } else {
        // Retorna sem formatação se o tamanho estiver errado
        return numeroLimpo;
      }
    } else {
      // Retorna sem formatação se não for Brasil
      return numeroLimpo;
    }
  }
  

  // ================================ //
function escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  
  /**
   * Formata timestamp para "DD/MM/YYYY HH:mm (UTC-3)" usando timezone America/Sao_Paulo.
   * Aceita string ISO, number (ms) ou Date.
   */
  export function formatTimestamp(ts) {
    const tz = 'America/Sao_Paulo';
  
    // Normalize input: Date | number (s ou ms) | string
    let date;
    if (ts instanceof Date) {
      date = ts;
    } else if (typeof ts === 'number') {
      // Se número pequeno, provavelmente seconds -> converte para ms
      date = new Date(ts < 1e12 ? ts * 1000 : ts);
    } else if (typeof ts === 'string' && ts.trim() !== '') {
      date = new Date(ts);
    } else {
      date = new Date();
    }
  
    if (isNaN(date.getTime())) {
      // Entrada inválida: retorna timestamp atual formatado como fallback
      const now = new Date();
      return now.toLocaleString('pt-BR') + ' (UTC-3)';
    }
  
    // Tenta usar Intl.formatToParts (mais consistente com timezone)
    try {
      const hasFormatToParts = typeof Intl !== 'undefined'
        && Intl.DateTimeFormat
        && typeof Intl.DateTimeFormat.prototype.formatToParts === 'function';
  
      if (hasFormatToParts) {
        const partsArr = new Intl.DateTimeFormat('pt-BR', {
          timeZone: tz,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false
        }).formatToParts(date);
  
        // Monta mapa ignorando 'literal'
        const parts = {};
        for (const p of partsArr) {
          if (p.type && p.type !== 'literal') parts[p.type] = p.value;
        }
  
        const day = parts.day || date.toLocaleString('pt-BR', { timeZone: tz, day: '2-digit' });
        const month = parts.month || date.toLocaleString('pt-BR', { timeZone: tz, month: '2-digit' });
        const year = parts.year || date.toLocaleString('pt-BR', { timeZone: tz, year: 'numeric' });
        // hour/minute podem vir com espaços ou formato local — garantir dois dígitos
        const hour = (parts.hour || date.toLocaleString('pt-BR', { timeZone: tz, hour: '2-digit', hour12: false })).padStart(2, '0').replace(/\s/g, '');
        const minute = (parts.minute || date.toLocaleString('pt-BR', { timeZone: tz, minute: '2-digit' })).padStart(2, '0').replace(/\s/g, '');
  
        return `${day}/${month}/${year} ${hour}:${minute} (UTC-3)`;
      } else {
        // Fallback: toLocaleString com opções de timezone
        const s = date.toLocaleString('pt-BR', {
          timeZone: tz,
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hour12: false
        });
        return `${s} (UTC-3)`;
      }
    } catch (err) {
      // Último fallback: locale simples
      return date.toLocaleString('pt-BR') + ' (UTC-3)';
    }
  }
  
 export function buildHtml({ timestamp, whatsapp, name, transcription, subject }) {
    const ts = formatTimestamp(timestamp);
    const safeName = escapeHtml(name || 'Remetente');
    const safeWhatsapp = escapeHtml(whatsapp || '');
    const safeTranscription = escapeHtml(transcription || '');
  
    return `<!doctype html>
  <html lang="pt-BR">
  <head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(subject || 'Transcrição de Áudio')}</title>
  <style>
    body{font-family:Arial,Helvetica,sans-serif;background:#f4f6fb;margin:0;padding:18px;color:#111827}
    .container{max-width:700px;margin:0 auto}
    .card{background:#fff;border-radius:12px;padding:22px;box-shadow:0 8px 30px rgba(17,24,39,0.06)}
    .header{display:flex;align-items:center;gap:12px}
    .badge{background:linear-gradient(90deg,#6d28d9,#4f46e5);color:#fff;padding:8px 12px;border-radius:8px;font-weight:700}
    .title{margin:0;font-size:18px;color:#111827}
    .meta{margin-top:12px;color:#374151;font-size:13px;line-height:1.5}
    .meta .label{color:#6b7280;font-weight:600;margin-right:6px}
    .message{margin-top:18px;background:#f8fafc;padding:14px;border-radius:8px;white-space:pre-wrap;color:#0f172a;border:1px solid #eef2ff}
    .footer{margin-top:18px;font-size:12px;color:#9ca3af;text-align:center}
    .app-link{display:inline-block;margin-top:8px;color:#4f46e5;text-decoration:none;font-weight:600}
    @media (max-width:480px){ .card{padding:16px} .title{font-size:16px} }
  </style>
  </head>
  <body>
    <div class="container">
      <div class="card" role="article" aria-label="Transcrição de áudio">
        <div class="header">
          <div class="badge">Whatszaip</div>
          <div>
            <h1 class="title">Transcrição de Áudio</h1>
            <div style="font-size:13px;color:#6b7280">Automática • Mensagem transcrita</div>
          </div>
        </div>
  
        <div class="meta">
          <div><span class="label">Data/Hora:</span> ${ts}</div>
          <div><span class="label">WhatsApp:</span> ${safeWhatsapp}</div>
          <div><span class="label">Nome:</span> ${safeName}</div>
        </div>
  
        <div class="message">${safeTranscription}</div>
  
        <div class="footer">
           • Mensagem transcrita automaticamente 
          <div>
            <a class="app-link" href="https://www.whatszaip.com.br" target="_blank" rel="noopener noreferrer">www.whatszaip.com.br</a>
          </div>
        </div>
      </div>
    </div>
  </body>
  </html>`;
  }
  
  

export function formatarDataBRUTC3(input) {
    if (!input) return '';
  
    // Detecta se é timestamp numérico (em segundos)
    let data;
    if (typeof input === 'number' || /^\d{10}$/.test(input)) {
      data = new Date(parseInt(input, 10) * 1000); // timestamp em segundos → milissegundos
    } else {
      data = new Date(input); // assume ISO ou algo compatível
    }
  
    // Ajusta para UTC-3 (manual, já que não há timezone nativa no Worker)
    const dataUTC3 = new Date(data.getTime() - 3 * 60 * 60 * 1000);
  
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC' // importante: manter UTC aqui pois já fizemos o ajuste manual
    }).format(dataUTC3);
  }
  
  // Função para formatar a data no padrão dd/mm/aaaa hh:mm
export function formatarData(timestamp, allday, inicio_fim) {
    const data = new Date(timestamp * 1000); // Converte o timestamp para milissegundos
    data.setHours(data.getHours() - 3); // Subtrai 3 horas para ajustar para o horário de Brasília
    const dia = String(data.getUTCDate()).padStart(2, '0');
    const mes = String(data.getUTCMonth() + 1).padStart(2, '0'); // Janeiro é 0
    const ano = data.getUTCFullYear();
    const horas = String(data.getUTCHours()).padStart(2, '0');
    let minutos = String(data.getUTCMinutes()).padStart(2, '0');
    if (minutos == "00") {
      minutos = `h`
    } else {
      minutos = `:${minutos}h`
    }
    if (allday) {
      // return `${dia}/${mes}/${ano}`;
      return `${dia}/${mes}`;
    } else {
      if (inicio_fim == 'inicio') {
        // return `${dia}/${mes}/${ano} de ${horas}${minutos }`;
        return `${dia}/${mes} de ${horas}${minutos}`;
      } else if ((inicio_fim == 'fim')) {
        return `às ${horas}${minutos}`;
      }
    }
  }
  
  
