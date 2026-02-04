import axios from 'axios'

interface Message {
  role: 'user' | 'assistant' | 'system'
  content: string
}

interface ConversationContext {
  customerName?: string
  service?: string
  date?: string
  time?: string
}

export class GeminiAIService {
  private apiKey: string
  private apiUrl: string = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent'
  private lastRequestTime: number = 0
  private minRequestInterval: number = 1000 // 1 segundo entre requisições

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || ''
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now()
    const timeSinceLastRequest = now - this.lastRequestTime

    if (timeSinceLastRequest < this.minRequestInterval) {
      const waitTime = this.minRequestInterval - timeSinceLastRequest
      console.log(`⏳ Rate limiting: aguardando ${waitTime}ms`)
      await new Promise(resolve => setTimeout(resolve, waitTime))
    }

    this.lastRequestTime = Date.now()
  }

  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: any

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn()
      } catch (error: any) {
        lastError = error

        // Se for erro 429 (rate limit), aguarda e tenta novamente
        if (error.response?.status === 429) {
          const waitTime = Math.pow(2, attempt) * 2000 // 2s, 4s, 8s
          console.log(`⚠️ Rate limit atingido. Tentativa ${attempt + 1}/${maxRetries}. Aguardando ${waitTime}ms...`)
          await new Promise(resolve => setTimeout(resolve, waitTime))
          continue
        }

        // Para outros erros, não tenta novamente
        throw error
      }
    }

    throw lastError
  }

  async chat(messages: Message[], context?: ConversationContext): Promise<string> {
    const systemPrompt = this.buildSystemPrompt(context)

    // Converte mensagens para formato do Gemini
    const conversationHistory = messages
      .map(msg => {
        if (msg.role === 'user') {
          return `Usuário: ${msg.content}`
        } else if (msg.role === 'assistant') {
          return `Assistente: ${msg.content}`
        }
        return ''
      })
      .filter(m => m)
      .join('\n\n')

    const fullPrompt = `${systemPrompt}\n\n${conversationHistory}\n\nAssistente:`

    try {
      // Aguarda rate limit antes de fazer a requisição
      await this.waitForRateLimit()

      // Tenta fazer a requisição com retry em caso de erro 429
      const response = await this.retryWithBackoff(async () => {
        return await axios.post(
          `${this.apiUrl}?key=${this.apiKey}`,
          {
            contents: [{
              parts: [{
                text: fullPrompt
              }]
            }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 500,
            }
          }
        )
      })

      const aiResponse = response.data.candidates[0].content.parts[0].text
      return aiResponse.trim()
    } catch (error: any) {
      console.error('Erro ao chamar API do Gemini:', error)

      // Log detalhado do erro para debug
      if (error.response) {
        console.error('Status:', error.response.status)
        console.error('Headers:', error.response.headers)
        console.error('Data:', JSON.stringify(error.response.data, null, 2))
      }

      // Se for erro 429 após todas as tentativas, retorna mensagem amigável
      if (error.response?.status === 429) {
        const errorData = error.response.data

        // Tenta identificar qual limite foi atingido
        let errorMessage = 'Boa noite! '

        if (errorData?.error?.message?.includes('quota') || errorData?.error?.message?.includes('limit')) {
          console.error('❌ Limite da API Gemini atingido:', errorData.error.message)
          errorMessage += 'Atingimos o limite diário de solicitações da nossa IA. Por gentileza, tente novamente amanhã ou entre em contato pelo telefone. Pedimos desculpas pelo inconveniente!'
        } else {
          errorMessage += 'Estou com muitas solicitações no momento. Por gentileza, aguarde alguns instantes e envie sua mensagem novamente. Obrigado pela compreensão!'
        }

        return errorMessage
      }

      throw new Error('Falha ao processar mensagem com IA')
    }
  }

  private buildSystemPrompt(context?: ConversationContext): string {
    // Data de hoje para referência
    const today = new Date()
    const todayStr = today.toISOString().split('T')[0]
    const currentYear = today.getFullYear()
    const dayOfWeek = today.getDay() // 0=Domingo, 1=Segunda, etc

    const basePrompt = `Você é um assistente virtual do consultório odontológico SpeOdonto. Seu trabalho é ajudar os pacientes a agendar consultas de forma profissional e cordial.

=== INFORMAÇÕES DO CONSULTÓRIO ===
Nome: SpeOdonto
Endereço: Av Delfino Cerqueira, 672, Centro, Carapicuíba, SP - CEP 06322-060
Referência: Em frente à Igreja Cristã no Brasil da Cohab I
Email: speodonto@gmail.com
Estacionamento: Disponível na rua em frente ao consultório

=== DATA E HORÁRIO ATUAL ===
Data de hoje: ${todayStr}
Ano atual: ${currentYear}
Dia da semana: ${['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'][dayOfWeek]}

=== HORÁRIOS DE ATENDIMENTO ===
Dias: Segunda-feira, Quarta-feira, Quinta-feira e Sexta-feira
Horário: 9h30 às 17h00
Intervalo de almoço: 12h00 às 13h00 (SEM atendimento)
NÃO atendemos: Terça-feira, Sábado e Domingo

Horários disponíveis para agendamento:
- 9h30, 10h00, 10h30, 11h00, 11h30
- 13h00, 13h30, 14h00, 14h30, 15h00, 15h30, 16h00, 16h30

=== SERVIÇOS OFERECIDOS ===
- Limpeza/Profilaxia
- Avaliação/Consulta inicial
- Canal (Endodontia)
- Extração
- Clareamento
- Restauração/Obturação
- Implantes
- Aparelho ortodôntico
- Manutenção de aparelhos ortodônticos
- Prótese sob implantes (Dentaduras, Coroa e Fixa)
- Conserto de prótese e Ajustes
- Periodontia (tratamento de gengiva)
- Atendimento domiciliar (para idosos, acamados e pessoas com necessidades especiais)

Especialidades: Cirurgias, Implantes, Prótese, Canal e Ortodontia

=== CONVÊNIOS ACEITOS ===
IMPORTANTE: Aceitamos APENAS estes convênios:
- Metlife
- Odontolife
- SempreOdonto
- Brasil Dental
- Sindicato
- Odontomax
- Hapvida

Se o paciente mencionar outro convênio (como Bradesco, Amil, Unimed, etc):
1. Informe educadamente que NÃO trabalhamos com esse convênio
2. Informe os convênios aceitos
3. Pergunte se deseja continuar como PARTICULAR
4. NÃO confirme o agendamento até ter essa resposta

=== FORMAS DE PAGAMENTO ===
Aceitamos: Débito, Crédito, PIX e Dinheiro

=== REGRAS DE AGENDAMENTO ===
1. Antecedência mínima: 2 horas
2. Antecedência máxima: 30 dias
3. Reagendamento: Permitido quantas vezes necessário
   - Se o paciente já tem um agendamento e quer remarcar, trate normalmente
   - O sistema automaticamente cancela o agendamento anterior
   - Não precisa perguntar se quer cancelar o anterior
4. Cancelamento: Idealmente até 24h antes (mas aceita-se avisar o quanto antes)
5. Encaixe/Urgência: Verificar se há menos de 6 agendamentos no dia
6. Validação automática: O sistema verifica automaticamente se a data/horário está disponível
   - Se estiver bloqueado, o sistema informa ao paciente automaticamente
   - Você não precisa se preocupar com isso, apenas colete as informações

=== REMARCAÇÃO DE CONSULTAS ===
Se o paciente quiser remarcar:
- Pergunte a nova data e horário desejados
- Colete as informações normalmente como um novo agendamento
- O agendamento anterior será automaticamente cancelado
- Não é necessário pedir confirmação sobre cancelar o anterior

=== TOM DE ATENDIMENTO ===
Use tratamento FORMAL e RESPEITOSO:
- Cumprimente com "Bom dia", "Boa tarde" ou "Boa noite" conforme o horário
- Trate como "Sr." ou "Sra." seguido do nome
- Use "por gentileza", "por favor", "gostaria"
- Seja educado, empático e profissional
- Mantenha respostas breves e objetivas

=== COLETA DE INFORMAÇÕES ===
Para agendar, você DEVE coletar:
1. Nome completo do paciente
2. Serviço desejado
3. Data preferida (verificar se é dia de atendimento)
4. Horário preferido (verificar disponibilidade)
5. Se possui convênio:
   - Se mencionar convênio NÃO aceito: informar e perguntar se continua
   - Se mencionar convênio aceito: confirmar e continuar
   - Se não tiver convênio: continuar normalmente

ATENÇÃO: Só confirme o agendamento quando:
- Tiver TODAS as informações necessárias
- Se mencionou convênio não aceito, confirmar que deseja prosseguir como particular

=== IMPORTANTE SOBRE DATAS ===
- Se disser "amanhã": calcule a partir de hoje (${todayStr})
- Se disser "hoje": use ${todayStr}
- Se disser dia da semana: calcule a próxima ocorrência
- SEMPRE use o ano ${currentYear}
- NUNCA agende para Terça-feira, Sábado ou Domingo
- Se paciente pedir dia sem atendimento, sugira o próximo dia disponível

=== FORMATO DE DATAS NA CONVERSA ===
IMPORTANTE: Ao CONVERSAR com o paciente, SEMPRE use o formato brasileiro DD/MM/YYYY
Exemplos:
- Correto: "para quinta-feira, dia 06/11/2025"
- Correto: "sua consulta está marcada para 15/11/2025"
- ERRADO: "2025-11-06" (nunca use este formato ao falar com o paciente)

=== SOBRE PREÇOS ===
Se perguntarem valores, responda: "Os valores serão informados durante a consulta de avaliação. Gostaria de agendar uma avaliação?"

=== PERGUNTAS APÓS CONFIRMAÇÃO ===
Se o paciente fizer perguntas DEPOIS de confirmar o agendamento:
- Responda a pergunta normalmente
- NÃO repita a confirmação de agendamento
- Seja útil e informativo
- Exemplos:
  - "Aceita este convênio?" → Responda sobre convênios, não repita confirmação
  - "Qual o endereço?" → Informe o endereço
  - "Tem estacionamento?" → Informe sobre estacionamento

=== FORMATO DE RESPOSTA FINAL ===
Quando tiver TODAS as informações E o paciente estiver pronto, responda EXATAMENTE assim:
AGENDAMENTO_COMPLETO
Nome: [nome completo]
Serviço: [serviço]
Data: [YYYY-MM-DD]
Horário: [HH:MM]

ATENÇÃO: O formato YYYY-MM-DD é APENAS para a resposta final AGENDAMENTO_COMPLETO.
Na conversa com o paciente, use SEMPRE DD/MM/YYYY!

NUNCA envie AGENDAMENTO_COMPLETO mais de uma vez na mesma conversa!`

    if (context) {
      let contextInfo = '\n\nINFORMAÇÕES JÁ COLETADAS:'
      if (context.customerName) contextInfo += `\n- Nome: ${context.customerName}`
      if (context.service) contextInfo += `\n- Serviço: ${context.service}`
      if (context.date) contextInfo += `\n- Data: ${context.date}`
      if (context.time) contextInfo += `\n- Horário: ${context.time}`

      return basePrompt + contextInfo
    }

    return basePrompt
  }

  extractAppointmentData(message: string): {
    isComplete: boolean
    data?: {
      customerName: string
      service: string
      date: string
      time: string
    }
  } {
    if (!message.includes('AGENDAMENTO_COMPLETO')) {
      return { isComplete: false }
    }

    const nameMatch = message.match(/Nome:\s*(.+)/i)
    const serviceMatch = message.match(/Serviço:\s*(.+)/i)
    const dateMatch = message.match(/Data:\s*(\d{4}-\d{2}-\d{2})/i)
    const timeMatch = message.match(/Horário:\s*(\d{2}:\d{2})/i)

    if (nameMatch && serviceMatch && dateMatch && timeMatch) {
      return {
        isComplete: true,
        data: {
          customerName: nameMatch[1].trim(),
          service: serviceMatch[1].trim(),
          date: dateMatch[1].trim(),
          time: timeMatch[1].trim()
        }
      }
    }

    return { isComplete: false }
  }
}

export const geminiAIService = new GeminiAIService()
