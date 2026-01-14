'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { formatDistanceToNow, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface Appointment {
  id: string
  customerName: string
  service: string
  date: string
  time: string
  status: string
  createdAt: string
}

interface ExtractedData {
  name: string
  service: string
  date: string
  time: string
  extractedAt: string
  userMessageTimestamp: string
}

interface Conversation {
  id: string
  phoneNumber: string
  customerName: string | null
  lastMessage: string
  lastMessageAt: string
  messageCount: number
  appointmentCount: number
  status: string
  createdAt: string
  updatedAt: string
  lastAppointment: Appointment | null
  extractedData: ExtractedData | null
  hasProblems: {
    missingName: boolean
    noAppointment: boolean
    extractionFailed: boolean
  }
  problemFlags: string[]
}

export default function ConversationsPage() {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filter, setFilter] = useState('recent') // 'all', 'recent', 'with_appointment', 'problematic'
  const [hours, setHours] = useState('48')

  useEffect(() => {
    fetchConversations()
  }, [filter, hours])

  const fetchConversations = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ filter, hours })
      const res = await fetch(`/api/conversations?${params}`)
      const data = await res.json()
      setConversations(data.conversations || [])
    } catch (error) {
      console.error('Erro ao buscar conversas:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredConversations = conversations.filter(conv => {
    const search = searchTerm.toLowerCase()
    return (
      conv.customerName?.toLowerCase().includes(search) ||
      conv.phoneNumber.includes(search) ||
      conv.lastMessage.toLowerCase().includes(search)
    )
  })

  const problematicCount = conversations.filter(c => c.problemFlags.length > 0).length
  const withAppointmentCount = conversations.filter(c => c.appointmentCount > 0).length

  const getProblemBadge = (flags: string[]) => {
    if (flags.length === 0) return null

    const labels: { [key: string]: string } = {
      missingName: 'Sem Nome',
      noAppointment: 'Sem Agendamento',
      extractionFailed: 'Falha na Extração'
    }

    return (
      <div className="flex flex-wrap gap-1 mt-2">
        {flags.map(flag => (
          <span key={flag} className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
            ⚠️ {labels[flag] || flag}
          </span>
        ))}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Carregando conversas...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="max-w-6xl mx-auto p-4">
        <div className="bg-white rounded-lg shadow-sm mb-4 p-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Conversas - Debug</h1>

          {/* Filters */}
          <div className="mb-4">
            <div className="flex gap-2 mb-3 flex-wrap">
              <button
                onClick={() => setFilter('recent')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  filter === 'recent'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Recentes
              </button>
              <button
                onClick={() => setFilter('all')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  filter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Todas
              </button>
              <button
                onClick={() => setFilter('with_appointment')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  filter === 'with_appointment'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Com Agendamento
              </button>
              <button
                onClick={() => setFilter('problematic')}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  filter === 'problematic'
                    ? 'bg-red-600 text-white'
                    : 'bg-red-100 text-red-700 hover:bg-red-200'
                }`}
              >
                Problemáticas ({problematicCount})
              </button>

              {filter === 'recent' && (
                <select
                  value={hours}
                  onChange={(e) => setHours(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg bg-white"
                >
                  <option value="24">Últimas 24h</option>
                  <option value="48">Últimas 48h</option>
                  <option value="72">Últimas 72h</option>
                  <option value="168">Última semana</option>
                </select>
              )}
            </div>

            <input
              type="text"
              placeholder="Buscar por nome, telefone ou mensagem..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="bg-blue-50 rounded-lg p-3">
              <p className="text-xs text-gray-600">Total de Conversas</p>
              <p className="text-2xl font-bold text-blue-600">{conversations.length}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-3">
              <p className="text-xs text-gray-600">Com Agendamento</p>
              <p className="text-2xl font-bold text-green-600">{withAppointmentCount}</p>
            </div>
            <div className="bg-red-50 rounded-lg p-3">
              <p className="text-xs text-gray-600">Problemáticas</p>
              <p className="text-2xl font-bold text-red-600">{problematicCount}</p>
            </div>
            <div className="bg-purple-50 rounded-lg p-3">
              <p className="text-xs text-gray-600">Total Mensagens</p>
              <p className="text-2xl font-bold text-purple-600">
                {conversations.reduce((acc, conv) => acc + conv.messageCount, 0)}
              </p>
            </div>
          </div>
        </div>

        {/* Conversations List */}
        <div className="space-y-3">
          {filteredConversations.length === 0 ? (
            <div className="bg-white rounded-lg shadow-sm p-8 text-center">
              <p className="text-gray-500">
                {searchTerm ? 'Nenhuma conversa encontrada' : 'Nenhuma conversa neste filtro'}
              </p>
            </div>
          ) : (
            filteredConversations.map((conversation) => (
              <Link
                key={conversation.id}
                href={`/admin/conversations/${conversation.id}`}
                className={`block bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow border-l-4 ${
                  conversation.problemFlags.length > 0
                    ? 'border-red-500'
                    : conversation.appointmentCount > 0
                    ? 'border-green-500'
                    : 'border-gray-300'
                }`}
              >
                <div className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900">
                          {conversation.customerName || 'Cliente sem nome'}
                        </h3>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          conversation.status === 'ACTIVE' ? 'bg-green-100 text-green-700' :
                          conversation.status === 'CLOSED' ? 'bg-gray-100 text-gray-700' :
                          'bg-yellow-100 text-yellow-700'
                        }`}>
                          {conversation.status}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500">{conversation.phoneNumber}</p>
                    </div>
                    <div className="text-right">
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                        {conversation.messageCount} msg
                      </span>
                      {conversation.appointmentCount > 0 && (
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 ml-1">
                          {conversation.appointmentCount} agend.
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Appointment Info */}
                  {conversation.lastAppointment && (
                    <div className="bg-green-50 rounded p-2 mb-2 text-sm">
                      <p className="font-medium text-green-900">
                        Agendamento: {conversation.lastAppointment.customerName}
                      </p>
                      <p className="text-green-700 text-xs">
                        {conversation.lastAppointment.service} - {' '}
                        {format(new Date(conversation.lastAppointment.date), 'dd/MM/yyyy', { locale: ptBR })} às {conversation.lastAppointment.time}
                      </p>
                    </div>
                  )}

                  {/* Extracted Data (for debugging) */}
                  {conversation.extractedData && (
                    <div className="bg-blue-50 rounded p-2 mb-2 text-xs">
                      <p className="font-medium text-blue-900">Dados Extraídos pela IA:</p>
                      <p className="text-blue-700">
                        {conversation.extractedData.name} - {conversation.extractedData.service}
                      </p>
                      <p className="text-blue-700">
                        {format(new Date(conversation.extractedData.date), 'dd/MM/yyyy')} às {conversation.extractedData.time}
                      </p>
                    </div>
                  )}

                  {/* Problem Badges */}
                  {getProblemBadge(conversation.problemFlags)}

                  <p className="text-sm text-gray-600 line-clamp-2 mb-2 mt-2">
                    {conversation.lastMessage}
                  </p>

                  <p className="text-xs text-gray-400">
                    {formatDistanceToNow(new Date(conversation.lastMessageAt), {
                      addSuffix: true,
                      locale: ptBR
                    })}
                  </p>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
