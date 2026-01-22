import axios from "axios";

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

export class AIService {
  private apiKey: string;
  private model: string = "gpt-3.5-turbo";

  constructor() {
    this.apiKey = process.env.OPENAI_API_KEY || "";
  }

  async chat(
    messages: Message[],
    context?: ConversationContext
  ): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(context);

    try {
      const response = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: this.model,
          messages: [{ role: "system", content: systemPrompt }, ...messages],
          temperature: 0.7,
          max_tokens: 500,
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      return response.data.choices[0].message.content;
    } catch (error) {
      console.error("Erro ao chamar API da OpenAI:", error);
      throw new Error("Falha ao processar mensagem com IA");
    }
  }

  private buildSystemPrompt(context?: ConversationContext): string {
    const basePrompt = `Você é um assistente virtual de um consultório odontológico. Seu trabalho é ajudar os pacientes a agendar consultas de forma natural e amigável.

REGRAS IMPORTANTES:
1. Seja educado, empático e profissional
2. Colete as seguintes informações para agendamento:
   - Nome completo do paciente
   - Serviço desejado (limpeza, canal, extração, avaliação, clareamento, etc)
   - Data preferida
   - Horário preferido

3. Horários disponíveis: Segunda a Sexta, 8h às 18h (intervalos de 1 hora)
4. Confirme todos os dados antes de finalizar
5. Seja breve e objetivo nas respostas
6. Se o paciente perguntar sobre preços, diga que o dentista informará na consulta
7. Quando todas as informações estiverem coletadas, confirme o agendamento

FORMATO DE RESPOSTA FINAL:
Quando tiver todas as informações, responda EXATAMENTE assim:
AGENDAMENTO_COMPLETO
Nome: [nome]
Serviço: [serviço]
Data: [data no formato YYYY-MM-DD]
Horário: [horário no formato HH:00]`;

    if (context) {
      let contextInfo = "\n\nINFORMAÇÕES JÁ COLETADAS:";
      if (context.customerName)
        contextInfo += `\n- Nome: ${context.customerName}`;
      if (context.service) contextInfo += `\n- Serviço: ${context.service}`;
      if (context.date) contextInfo += `\n- Data: ${context.date}`;
      if (context.time) contextInfo += `\n- Horário: ${context.time}`;

      return basePrompt + contextInfo;
    }

    return basePrompt;
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

    const nameMatch = message.match(/Nome:\s*(.+)/i);
    const serviceMatch = message.match(/Serviço:\s*(.+)/i);
    const dateMatch = message.match(/Data:\s*(\d{4}-\d{2}-\d{2})/i);
    const timeMatch = message.match(/Horário:\s*(\d{2}:\d{2})/i);

    if (nameMatch && serviceMatch && dateMatch && timeMatch) {
      return {
        isComplete: true,
        data: {
          customerName: nameMatch[1].trim(),
          service: serviceMatch[1].trim(),
          date: dateMatch[1].trim(),
          time: timeMatch[1].trim(),
        },
      };
    }

    return { isComplete: false };
  }
}

export const aiService = new AIService();
