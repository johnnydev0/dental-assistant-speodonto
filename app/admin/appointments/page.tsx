'use client'

import { useEffect, useState } from 'react'
import Layout from '@/components/Layout'
import Card from '@/components/Card'
import Button from '@/components/Button'
import {
  CalendarIcon,
  ClockIcon,
  PhoneIcon,
  PlusIcon,
  FunnelIcon,
  NoSymbolIcon,
  MagnifyingGlassIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'
import { useRouter } from 'next/navigation'

interface Appointment {
  id: string
  customerName: string
  customerPhone: string
  service: string
  date: string
  time: string
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED'
  notes?: string
}

interface BlockedTimeSlot {
  id: string
  date: string
  startTime: string
  endTime: string
  reason?: string
}

export default function AppointmentsPage() {
  const router = useRouter()
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [blockedSlots, setBlockedSlots] = useState<BlockedTimeSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'upcoming' | 'today'>('upcoming')
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchAppointments()
  }, [filter])

  const fetchAppointments = async () => {
    try {
      setLoading(true)
      const token = localStorage.getItem('adminToken')

      let url = '/api/appointments'
      let startDate = ''
      let endDate = ''

      if (filter === 'today') {
        const today = new Date().toISOString().split('T')[0]
        url += `?startDate=${today}&endDate=${today}`
        startDate = today
        endDate = today
      } else if (filter === 'upcoming') {
        const today = new Date().toISOString().split('T')[0]
        const nextMonth = new Date()
        nextMonth.setMonth(nextMonth.getMonth() + 1)
        const nextMonthStr = nextMonth.toISOString().split('T')[0]
        url += `?startDate=${today}&endDate=${nextMonthStr}`
        startDate = today
        endDate = nextMonthStr
      }

      const [appointmentsRes, blockedSlotsRes] = await Promise.all([
        fetch(url, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`/api/blocked-slots?startDate=${startDate}&endDate=${endDate}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ])

      if (appointmentsRes.ok) {
        const data = await appointmentsRes.json()
        setAppointments(data)
      }

      if (blockedSlotsRes.ok) {
        const data = await blockedSlotsRes.json()
        setBlockedSlots(data)
      }
    } catch (error) {
      console.error('Erro ao buscar agendamentos:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusColor = (status: string) => {
    const colors = {
      PENDING: 'bg-yellow-100 text-yellow-800',
      CONFIRMED: 'bg-green-100 text-green-800',
      COMPLETED: 'bg-blue-100 text-blue-800',
      CANCELLED: 'bg-red-100 text-red-800'
    }
    return colors[status as keyof typeof colors] || 'bg-gray-100 text-gray-800'
  }

  const getStatusLabel = (status: string) => {
    const labels = {
      PENDING: 'Pendente',
      CONFIRMED: 'Confirmado',
      COMPLETED: 'Concluído',
      CANCELLED: 'Cancelado'
    }
    return labels[status as keyof typeof labels] || status
  }

  const groupByDate = (appointments: Appointment[], blockedSlots: BlockedTimeSlot[]) => {
    const grouped: { [key: string]: { appointments: Appointment[], blockedSlots: BlockedTimeSlot[] } } = {}

    appointments.forEach((apt) => {
      const date = new Date(apt.date).toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long'
      })
      if (!grouped[date]) {
        grouped[date] = { appointments: [], blockedSlots: [] }
      }
      grouped[date].appointments.push(apt)
    })

    blockedSlots.forEach((slot) => {
      const date = new Date(slot.date).toLocaleDateString('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long'
      })
      if (!grouped[date]) {
        grouped[date] = { appointments: [], blockedSlots: [] }
      }
      grouped[date].blockedSlots.push(slot)
    })

    return grouped
  }

  const filteredAppointments = search.trim()
    ? appointments.filter((apt: Appointment) => {
        const q = search.toLowerCase()
        return (
          apt.customerName.toLowerCase().includes(q) ||
          apt.customerPhone.includes(q)
        )
      })
    : appointments

  const groupedAppointments = groupByDate(filteredAppointments, search.trim() ? [] : blockedSlots)

  return (
    <Layout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">Agendamentos</h2>
          <Button
            onClick={() => router.push('/admin/appointments/new')}
            size="sm"
            className="flex items-center space-x-1"
          >
            <PlusIcon className="h-5 w-5" />
            <span>Novo</span>
          </Button>
        </div>

        {/* Filtros */}
        <div className="flex space-x-2 overflow-x-auto pb-2">
          <button
            onClick={() => setFilter('today')}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              filter === 'today'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 border border-gray-300'
            }`}
          >
            Hoje
          </button>
          <button
            onClick={() => setFilter('upcoming')}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              filter === 'upcoming'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 border border-gray-300'
            }`}
          >
            Próximos
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              filter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-white text-gray-700 border border-gray-300'
            }`}
          >
            Todos
          </button>
        </div>

        {/* Busca */}
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar por nome ou telefone..."
            value={search}
            onChange={(e: { target: { value: string } }) => setSearch(e.target.value)}
            className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              <XMarkIcon className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Lista de Agendamentos */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600"></div>
          </div>
        ) : Object.keys(groupedAppointments).length > 0 ? (
          <div className="space-y-6">
            {Object.entries(groupedAppointments).map(([date, data]) => (
              <div key={date}>
                <h3 className="text-sm font-semibold text-gray-700 uppercase mb-3 sticky top-16 bg-gray-50 py-2">
                  {date}
                </h3>
                <div className="space-y-3">
                  {/* Horários Bloqueados */}
                  {data.blockedSlots.map((slot) => (
                    <Card key={slot.id} className="bg-red-50 border-red-200">
                      <div className="flex items-center space-x-3">
                        <NoSymbolIcon className="h-5 w-5 text-red-600" />
                        <div>
                          <p className="font-semibold text-red-900">
                            Horário Bloqueado: {slot.startTime} - {slot.endTime}
                          </p>
                          {slot.reason && (
                            <p className="text-sm text-red-700">
                              {slot.reason}
                            </p>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}

                  {/* Agendamentos */}
                  {data.appointments.map((appointment) => (
                    <Card
                      key={appointment.id}
                      onClick={() => router.push(`/admin/appointments/${appointment.id}`)}
                    >
                      <div className="space-y-2">
                        {/* Horário e Status */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            <ClockIcon className="h-5 w-5 text-gray-400" />
                            <span className="font-semibold text-gray-900">
                              {appointment.time}
                            </span>
                          </div>
                          <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(appointment.status)}`}>
                            {getStatusLabel(appointment.status)}
                          </span>
                        </div>

                        {/* Nome e Serviço */}
                        <div>
                          <p className="font-semibold text-gray-900">
                            {appointment.customerName}
                          </p>
                          <p className="text-sm text-gray-600">
                            {appointment.service}
                          </p>
                        </div>

                        {/* Telefone */}
                        <div className="flex items-center space-x-2">
                          <PhoneIcon className="h-4 w-4 text-gray-400" />
                          <a
                            href={`tel:${appointment.customerPhone}`}
                            className="text-sm text-blue-600"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {appointment.customerPhone}
                          </a>
                        </div>

                        {/* Notas (se houver) */}
                        {appointment.notes && (
                          <p className="text-xs text-gray-500 bg-gray-50 p-2 rounded">
                            {appointment.notes}
                          </p>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Card>
            <div className="text-center py-12">
              <CalendarIcon className="h-16 w-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-600 font-medium mb-2">
                Nenhum agendamento encontrado
              </p>
              <p className="text-sm text-gray-500 mb-6">
                Crie um novo agendamento para começar
              </p>
              <Button onClick={() => router.push('/admin/appointments/new')}>
                Novo Agendamento
              </Button>
            </div>
          </Card>
        )}
      </div>
    </Layout>
  )
}
