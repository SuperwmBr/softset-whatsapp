
const FRAUDGUARD_URL     = 'https://fraudguard.softset.com.br/api/v1/external/registryconvertion';
const FRAUDGUARD_API_KEY = '3202354@Id';
 

// ─────────────────────────────────────────────────────────────────
// Efetiva a conversão usando o fg_conversion_id gravado pelo Wix
// ─────────────────────────────────────────────────────────────────
export async function _efetivarConversao(fg_conversion_id, dadosLead = {}) {
    if (!fg_conversion_id) {
        console.log("[FraudGuard] fg_conversion_id ausente — efetivação ignorada");
        return null;
    }
 
    try {
        const response = await fetch(FRAUDGUARD_URL, {
            method:  'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key':    FRAUDGUARD_API_KEY,
            },
            body: JSON.stringify({
                evento:       "conversa_whatsapp_iniciada",  // evento de conversão real
                evento_label: "primeira_mensagem",
                // Repassa todos os dados de mídia paga que o Worker salvou
                gclid:        dadosLead.gclid       || "",
                wbraid:       dadosLead.wbraid      || "",
                gbraid:       dadosLead.gbraid      || "",
                campanha:     dadosLead.campanha    || "",
                adgroup_id:   dadosLead.adgroup_id  || "",
                keyword:      dadosLead.keyword     || "",
                utm_source:   dadosLead.utm_source  || "",
                utm_medium:   dadosLead.utm_medium  || "",
                ip:           dadosLead.ip          || "",
                visitor_id:   dadosLead.visitor_id  || "",
                site_id:      "fiftymotorhome",
                url_origem:   dadosLead.url_origem  || "",
                timestamp:    new Date().toISOString(),
                // Vincula este registro ao registro de intenção anterior
                evento_valor: fg_conversion_id,     // reutiliza campo para rastreio
            }),
        });
 
        if (response.ok) {
            const data = await response.json();
            console.log("[FraudGuard] Conversão efetivada:", {
                novo_id:          data.id,
                intencao_id:      fg_conversion_id,
                is_fraud:         data.is_fraud,
                fraud_score:      data.fraud_score_ref,
            });
            return data;
        }
 
        console.log("[FraudGuard] Falha na efetivação:", response.status);
        return null;
 
    } catch (err) {
        console.log("[FraudGuard] Erro na efetivação:", err);
        return null;
    }
}
 

export async function _consultarConversao(fg_conversion_id, dadosLead = {}) {
    if (!fg_conversion_id) {
        console.log("[FraudGuard] fg_conversion_id ausente — efetivação ignorada");
        return null;
    }
 
    try {
        const response = await fetch(`${FRAUDGUARD_URL}?id=${fg_conversion_id}`, {
            method:  'GET',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key':    FRAUDGUARD_API_KEY,
            }
        });
 
        if (response.ok) {
            const data = await response.json();
            console.log("[FraudGuard] Conversão efetivada:", {
                ref:          data.click_id_ref,
                intencao_id:      data.id,
                gclid:         data.gclid,
                received_at:      data.received_at,
            });
            return data;
        }
 
        console.log("[FraudGuard] Falha na consutla das efetivações:", response.status);
        return null;
 
    } catch (err) {
        console.log("[FraudGuard] Erro na consulta das efetivações:", err);
        return null;
    }
}
 
