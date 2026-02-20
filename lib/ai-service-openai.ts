import OpenAI from "openai";
import conveniosData from "./convenios.json";

interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

interface ConversationContext {
  customerName?: string;
  service?: string;
  date?: string;
  time?: string;
}

const VALID_TIMES = ["09:30", "10:30", "11:30", "13:00", "14:00", "15:00", "16:00"];

export class OpenAIService {
  private client: OpenAI;
  private model: string = "gpt-4o-mini";

  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || "",
    });
  }

  async chat(
    messages: Message[],
    _context?: ConversationContext,
    availableInfo?: string
  ): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(availableInfo);

    const openaiMessages = [
      { role: "system" as const, content: systemPrompt },
      ...messages
        .filter((m) => m.role !== "system")
        .map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        })),
    ];

    try {
      const chatCompletion = await this.client.chat.completions.create({
        model: this.model,
        messages: openaiMessages,
        temperature: 0.3,
        max_tokens: 600,
      });

      return (chatCompletion.choices[0]?.message?.content || "").trim();
    } catch (error: any) {
      console.error("Erro ao chamar API da OpenAI:", error);
      throw new Error("Falha ao processar mensagem com IA (OpenAI)");
    }
  }

  private buildSystemPrompt(availableInfo?: string): string {
    const today = new Date();
    const todayBR = today.toLocaleDateString("pt-BR");
    const conveniosList = conveniosData.map((c) => `• ${c}`).join("\n");

    return `Voce e o assistente virtual da Clinica SpeOdonto. Seu unico objetivo e agendar consultas.

=== INFORMACOES DA CLINICA ===
Telefone: (11) 4184-4602
Endereco: Av Delfino Cerqueira, 672, Centro, Carapicuiba, SP
Email: speodonto@gmail.com
Pagamento: Debito, Credito, PIX e Dinheiro
Hoje: ${todayBR}

=== HORARIOS E DATAS DISPONIVEIS ===
Os horarios abaixo ja foram verificados pelo sistema. Ofereca SOMENTE estes.
Se o paciente pedir um dia ou horario que nao consta abaixo, diga que nao ha disponibilidade e mostre as opcoes.

${availableInfo ?? "Nenhum horario disponivel no momento. Oriente o paciente a ligar: (11) 4184-4602."}

=== FLUXO DE ATENDIMENTO ===
Siga esta ordem. Nao pule etapas. Faca UMA pergunta por mensagem.

1. NOME: Pergunte o nome completo. Nao avance sem ele.
2. SERVICO: Pergunte qual servico deseja.
3. CONVENIO: Pergunte se sera particular ou por convenio.
   - Se convenio: verifique se esta na lista abaixo.
   - Convenio nao aceito: informe e pergunte se deseja como particular.
4. PREFERENCIA DE DIA: Pergunte qual periodo prefere (ex: "Tem preferencia por algum dia da semana ou periodo - manha ou tarde?").
5. MOSTRAR OPCOES: Com base na resposta, mostre APENAS os dias e horarios relevantes da lista acima.
   - Paciente disse "quinta": mostre so as quintas disponiveis e seus horarios.
   - Paciente disse "manha": mostre so os horarios de manha (09:30, 10:30, 11:30) dos dias disponiveis.
   - Paciente nao tem preferencia: mostre os proximos 3 dias disponiveis.
   - NUNCA mostre todos os 14 dias de uma vez.
6. CONFIRMACAO: Apos o paciente escolher, repita: nome, servico, data e horario. Aguarde confirmacao. Depois envie AGENDAMENTO_COMPLETO.

=== CONVENIOS ACEITOS ===
${conveniosList}

Procedimentos geralmente nao cobertos (particular): Canal, Implantes, Aparelho ortodontico, Clareamento, Protese completa.

=== SERVICOS OFERECIDOS ===
Limpeza/Profilaxia, Avaliacao/Consulta inicial, Canal, Extracao, Clareamento, Restauracao, Implantes, Aparelho ortodontico, Manutencao de aparelhos, Protese, Conserto de protese, Periodontia, Atendimento domiciliar.

=== TOM ===
Formal, breve e respeitoso. Use "Sr." ou "Sra." + nome. Cumprimente com "Bom dia/Boa tarde/Boa noite".
Precos: "Os valores sao informados durante a consulta de avaliacao."

=== ALTERAR OU CANCELAR ===
Para alterar: colete nova data/horario disponivel e use o bloco ALTERACAO_COMPLETA.
Para cancelar: confirme com o paciente e escreva CANCELAR_AGENDAMENTO.

=== CONFIRMACAO DO AGENDAMENTO ===
Quando tiver nome + servico + data + horario confirmados pelo paciente, escreva EXATAMENTE:

AGENDAMENTO_COMPLETO
Nome: [nome real do paciente]
Servico: [servico escolhido]
Data: [YYYY-MM-DD]
Horario: [HH:MM]

Em seguida, adicione uma mensagem amigavel de confirmacao.

REGRAS CRITICAS:
- Use SOMENTE datas e horarios que aparecem como disponiveis acima.
- Data: formato YYYY-MM-DD. Horario: formato HH:MM (ex: 09:30, 14:00).
- Nunca use placeholders como [nome] — use o dado real informado pelo paciente.
- Nunca envie AGENDAMENTO_COMPLETO sem ter confirmado todos os dados com o paciente.
- Nunca envie AGENDAMENTO_COMPLETO mais de uma vez.

Para alteracao:
ALTERACAO_COMPLETA
NovaData: [YYYY-MM-DD]
NovoHorario: [HH:MM]`;
  }

  extractAppointmentData(message: string): {
    isComplete: boolean;
    data?: {
      customerName: string;
      service: string;
      date: string;
      time: string;
    };
  } {
    if (!message.includes("AGENDAMENTO_COMPLETO")) {
      return { isComplete: false };
    }

    console.log("🔍 Extraindo dados de AGENDAMENTO_COMPLETO...");

    const nameMatch = message.match(/Nome:\s*(.+)/i);
    const serviceMatch = message.match(/Servi[cç]o:\s*(.+)/i);
    const dateMatch = message.match(/Data:\s*(\d{4}-\d{2}-\d{2})/i);
    const timeMatch = message.match(/Hor[aá]rio:\s*(\d{1,2}[h:]?\d{0,2})/i);

    console.log("📋 Campos extraídos:", {
      nome: nameMatch?.[1] ?? "NÃO ENCONTRADO",
      servico: serviceMatch?.[1] ?? "NÃO ENCONTRADO",
      data: dateMatch?.[1] ?? "NÃO ENCONTRADO",
      horario: timeMatch?.[1] ?? "NÃO ENCONTRADO",
    });

    if (!nameMatch || !serviceMatch || !dateMatch || !timeMatch) {
      console.log("❌ Campos obrigatórios ausentes");
      return { isComplete: false };
    }

    const customerName = nameMatch[1].trim();
    const service = serviceMatch[1].trim();

    // Rejeitar placeholders
    if (
      customerName.startsWith("[") ||
      customerName.toLowerCase().includes("nome") ||
      service.startsWith("[")
    ) {
      console.log("❌ Placeholder detectado:", { customerName, service });
      return { isComplete: false };
    }

    // Normalizar horário para HH:MM
    const rawTime = timeMatch[1].trim().replace("h", ":");
    const [h, m = "00"] = rawTime.split(":");
    const normalizedTime = `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;

    // Rejeitar horários fora dos permitidos
    if (!VALID_TIMES.includes(normalizedTime)) {
      console.log("❌ Horário inválido:", normalizedTime);
      return { isComplete: false };
    }

    const result = {
      customerName,
      service,
      date: dateMatch[1].trim(),
      time: normalizedTime,
    };

    console.log("✅ Dados extraídos:", result);
    return { isComplete: true, data: result };
  }

  extractRescheduleData(message: string): {
    isReschedule: boolean;
    data?: { newDate: string; newTime: string };
  } {
    if (!message.includes("ALTERACAO_COMPLETA")) {
      return { isReschedule: false };
    }

    const dateMatch = message.match(/NovaData:\s*(\d{4}-\d{2}-\d{2})/i);
    const timeMatch = message.match(/NovoHor[aá]rio:\s*(\d{1,2}[h:]?\d{0,2})/i);

    if (!dateMatch || !timeMatch) {
      return { isReschedule: false };
    }

    const rawTime = timeMatch[1].trim().replace("h", ":");
    const [h, m = "00"] = rawTime.split(":");
    const normalizedTime = `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;

    return {
      isReschedule: true,
      data: { newDate: dateMatch[1].trim(), newTime: normalizedTime },
    };
  }
}

export const openAIService = new OpenAIService();
