import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, Plus, Trash2, Users, X } from 'lucide-react';
import {
  CalCalendar,
  CalEvent,
  CalEventInput,
  createEvent,
  deleteEvent,
  listCalendars,
  queryEvents,
  updateEvent,
} from '../lib/collab';
import { getAuth } from '../lib/jmap';

interface CalendarViewProps {
  onNotify: (message: string, type?: 'error' | 'success' | 'info') => void;
}

type Mode = 'month' | 'list';

interface FormState {
  id?: string;
  title: string;
  date: string;
  time: string;
  minutes: number;
  description: string;
  location: string;
  invitees: string;
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  count: string;
}

function todayInput(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const EMPTY_FORM: FormState = {
  title: '',
  date: todayInput(),
  time: '10:00',
  minutes: 60,
  description: '',
  location: '',
  invitees: '',
  recurrence: 'none',
  count: '',
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function localDateTime(date: string, time: string): string {
  return `${date}T${time.length === 5 ? `${time}:00` : time}`;
}

function timeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function eventDate(event: CalEvent): Date {
  return new Date(event.allDay ? `${event.start}T00:00:00` : event.start);
}

function durationMinutes(duration: string): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/.exec(duration || '');
  if (!match) return 60;
  return Number(match[1] ?? 0) * 1440 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

function toDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `PT${h > 0 ? `${h}H` : ''}${m > 0 ? `${m}M` : ''}` || 'PT0M';
}

function monthMatrix(cursor: Date): Date[] {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7; // Monday-first grid
  const start = new Date(first);
  start.setDate(1 - offset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export const CalendarView: React.FC<CalendarViewProps> = ({ onNotify }) => {
  const [calendars, setCalendars] = useState<CalCalendar[]>([]);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [mode, setMode] = useState<Mode>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [books, list] = await Promise.all([listCalendars(), queryEvents()]);
      setCalendars(books);
      setEvents(list);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not load calendar', 'error');
    }
  }, [onNotify]);

  useEffect(() => {
    load();
  }, [load]);

  const days = useMemo(() => monthMatrix(cursor), [cursor]);
  const monthLabel = cursor.toLocaleDateString([], { month: 'long', year: 'numeric' });
  const upcoming = useMemo(
    () => events.filter((e) => eventDate(e).getTime() >= new Date(new Date().setHours(0, 0, 0, 0)).getTime()),
    [events]
  );

  const openCreate = (date?: Date) => {
    setForm({
      ...EMPTY_FORM,
      date: date
        ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
        : todayInput(),
      time: '10:00',
    });
  };

  const openEdit = (event: CalEvent) => {
    const start = eventDate(event);
    setForm({
      id: event.id,
      title: event.title,
      date: `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`,
      time: `${pad(start.getHours())}:${pad(start.getMinutes())}`,
      minutes: durationMinutes(event.duration),
      description: event.description ?? '',
      location: event.location ?? '',
      invitees: event.participants.map((p) => p.email).join(', '),
      recurrence: event.recurrence?.frequency ?? 'none',
      count: event.recurrence?.count ? String(event.recurrence.count) : '',
    });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    if (!form.title.trim()) {
      onNotify('Event needs a title', 'error');
      return;
    }
    if (!(form.minutes > 0)) {
      onNotify('Duration must be at least 1 minute', 'error');
      return;
    }
    const ownDomain = (getAuth()?.email.split('@')[1] ?? '').toLowerCase();
    const emails = form.invitees
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const foreign = emails.filter((email) => ownDomain && email.split('@')[1]?.toLowerCase() !== ownDomain);
    if (foreign.length > 0) {
      onNotify(`Invitees must be ${ownDomain} users: ${foreign.join(', ')}`, 'error');
      return;
    }

    const input: CalEventInput = {
      calendarId: calendars[0]?.id,
      title: form.title.trim(),
      start: localDateTime(form.date, form.time),
      duration: toDuration(form.minutes),
      timeZone: timeZone(),
      description: form.description.trim() || undefined,
      location: form.location.trim() || undefined,
      participants: emails.map((email) => ({ email })),
      recurrence:
        form.recurrence === 'none'
          ? undefined
          : {
              frequency: form.recurrence,
              interval: 1,
              count: Number(form.count) > 0 ? Number(form.count) : undefined,
            },
    };
    setBusy(true);
    try {
      if (form.id) await updateEvent(form.id, input);
      else await createEvent(input);
      onNotify(form.id ? 'Event updated' : 'Event created', 'success');
      setForm(null);
      await load();
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not save event', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (event: CalEvent) => {
    if (!window.confirm(`Delete "${event.title}"?`)) return;
    try {
      await deleteEvent(event.id);
      setEvents((prev) => prev.filter((e) => e.id !== event.id));
      onNotify('Event deleted', 'info');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not delete event', 'error');
    }
  };

  const eventsForDay = (day: Date) => events.filter((e) => sameDay(eventDate(e), day));

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-white dark:bg-[#1E1F20]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b border-[#F2F4F7] dark:border-[#2D2F31]">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-5 h-5 text-gmail-blue" />
          <h2 className="text-base font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">Calendar</h2>
          <div className="flex items-center gap-1 ml-2">
            <button
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
              className="p-1.5 rounded-full text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10"
              title="Previous month"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium min-w-[140px] text-center text-[#1F1F1F] dark:text-[#E3E3E3]">
              {monthLabel}
            </span>
            <button
              onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
              className="p-1.5 rounded-full text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10"
              title="Next month"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-full bg-[#F2F6FC] dark:bg-[#282A2C] p-0.5">
            <button
              onClick={() => setMode('month')}
              className={`px-3 py-1 rounded-full text-xs font-medium ${mode === 'month' ? 'bg-white dark:bg-[#1E1F20] text-gmail-blue shadow-sm' : 'text-[#444746] dark:text-[#C4C7C5]'}`}
            >
              Month
            </button>
            <button
              onClick={() => setMode('list')}
              className={`px-3 py-1 rounded-full text-xs font-medium ${mode === 'list' ? 'bg-white dark:bg-[#1E1F20] text-gmail-blue shadow-sm' : 'text-[#444746] dark:text-[#C4C7C5]'}`}
            >
              Agenda
            </button>
          </div>
          <button
            onClick={() => openCreate()}
            className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-gmail-blue hover:bg-blue-700 text-white text-xs font-semibold"
          >
            <Plus className="w-4 h-4" />
            <span>Create</span>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 sm:p-5">
        {mode === 'month' ? (
          <div className="rounded-2xl border border-[#E0E2E7] dark:border-[#333538] overflow-hidden">
            <div className="grid grid-cols-7 bg-[#F6F8FC] dark:bg-[#131314] text-[11px] font-semibold text-[#444746] dark:text-[#C4C7C5]">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
                <div key={d} className="px-2 py-1.5 text-center">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const inMonth = day.getMonth() === cursor.getMonth();
                const isToday = sameDay(day, new Date());
                return (
                  <div
                    key={day.toISOString()}
                    className={`min-h-[92px] border-t border-r border-[#F2F4F7] dark:border-[#2D2F31] p-1.5 text-xs ${
                      inMonth ? 'bg-white dark:bg-[#1E1F20]' : 'bg-[#FAFBFC] dark:bg-[#18191A]'
                    }`}
                    onDoubleClick={() => openCreate(day)}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className={`w-6 h-6 flex items-center justify-center rounded-full text-[11px] ${
                          isToday ? 'bg-gmail-blue text-white font-semibold' : inMonth ? 'text-[#1F1F1F] dark:text-[#E3E3E3]' : 'text-[#8E918F]'
                        }`}
                      >
                        {day.getDate()}
                      </span>
                    </div>
                    <div className="space-y-0.5">
                      {eventsForDay(day).slice(0, 3).map((event) => (
                        <button
                          key={event.id}
                          onClick={() => openEdit(event)}
                          className="w-full text-left px-1.5 py-0.5 rounded bg-[#E8F0FE] dark:bg-[#004A77]/40 text-gmail-blue text-[10px] truncate hover:bg-[#D2E3FC] dark:hover:bg-[#004A77]/70"
                          title={event.title}
                        >
                          {event.allDay ? '' : `${pad(eventDate(event).getHours())}:${pad(eventDate(event).getMinutes())} `}
                          {event.title}
                        </button>
                      ))}
                      {eventsForDay(day).length > 3 && (
                        <div className="text-[10px] text-[#5E5E5E] dark:text-[#8E918F] px-1">
                          +{eventsForDay(day).length - 3} more
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {upcoming.length === 0 && (
              <p className="text-sm text-[#5E5E5E] dark:text-[#8E918F] py-8 text-center">No upcoming events.</p>
            )}
            {upcoming.map((event) => (
              <div
                key={event.id}
                className="rounded-2xl border border-[#E0E2E7] dark:border-[#333538] p-3 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#1F1F1F] dark:text-[#E3E3E3] truncate">{event.title}</span>
                    {event.recurrence && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#F2F6FC] dark:bg-[#282A2C] text-[#444746] dark:text-[#C4C7C5]">
                        {event.recurrence.frequency}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#5E5E5E] dark:text-[#8E918F]">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {event.allDay
                        ? eventDate(event).toLocaleDateString()
                        : `${eventDate(event).toLocaleDateString()} ${pad(eventDate(event).getHours())}:${pad(eventDate(event).getMinutes())}`}
                      {' · '}
                      {durationMinutes(event.duration)} min
                    </span>
                    {event.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {event.location}
                      </span>
                    )}
                    {event.participants.length > 0 && (
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {event.participants.map((p) => p.email).join(', ')}
                      </span>
                    )}
                  </div>
                  {event.description && (
                    <p className="mt-1 text-xs text-[#444746] dark:text-[#C4C7C5] line-clamp-2">{event.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(event)}
                    className="p-1.5 rounded-full text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10 text-xs"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(event)}
                    className="p-1.5 rounded-full text-[#444746] dark:text-[#C4C7C5] hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600"
                    title="Delete event"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {form && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <form
            onSubmit={submit}
            className="w-full max-w-lg bg-white dark:bg-[#1E1F20] rounded-2xl border border-[#E0E2E7] dark:border-[#333538] shadow-gmail-modal p-5 space-y-3 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#1F1F1F] dark:text-[#E3E3E3]">
                {form.id ? 'Edit event' : 'New event'}
              </h3>
              <button type="button" onClick={() => setForm(null)} className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10" aria-label="Close">
                <X className="w-4 h-4 text-[#444746] dark:text-[#C4C7C5]" />
              </button>
            </div>

            <label className="block text-xs text-[#444746] dark:text-[#C4C7C5]">
              Title
              <input
                autoFocus
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="mt-1 w-full h-9 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue"
              />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="block text-xs text-[#444746] dark:text-[#C4C7C5]">
                Date
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                  className="mt-1 w-full h-9 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue"
                />
              </label>
              <label className="block text-xs text-[#444746] dark:text-[#C4C7C5]">
                Start time
                <input
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm({ ...form, time: e.target.value })}
                  className="mt-1 w-full h-9 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue"
                />
              </label>
              <label className="block text-xs text-[#444746] dark:text-[#C4C7C5]">
                Duration (minutes)
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={form.minutes}
                  onChange={(e) => setForm({ ...form, minutes: Number(e.target.value) })}
                  className="mt-1 w-full h-9 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue"
                />
              </label>
              <label className="block text-xs text-[#444746] dark:text-[#C4C7C5]">
                Repeat
                <select
                  value={form.recurrence}
                  onChange={(e) => setForm({ ...form, recurrence: e.target.value as FormState['recurrence'] })}
                  className="mt-1 w-full h-9 px-2 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue"
                >
                  <option value="none">None</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </label>
            </div>

            {form.recurrence !== 'none' && (
              <label className="block text-xs text-[#444746] dark:text-[#C4C7C5]">
                Occurrences (blank = forever)
                <input
                  type="number"
                  min={1}
                  value={form.count}
                  onChange={(e) => setForm({ ...form, count: e.target.value })}
                  className="mt-1 w-full h-9 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue"
                />
              </label>
            )}

            <label className="block text-xs text-[#444746] dark:text-[#C4C7C5]">
              Location
              <input
                value={form.location}
                onChange={(e) => setForm({ ...form, location: e.target.value })}
                className="mt-1 w-full h-9 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue"
              />
            </label>

            <label className="block text-xs text-[#444746] dark:text-[#C4C7C5]">
              Invitees (comma separated local users)
              <input
                value={form.invitees}
                onChange={(e) => setForm({ ...form, invitees: e.target.value })}
                placeholder="bob@affinmail.local"
                className="mt-1 w-full h-9 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue"
              />
            </label>

            <label className="block text-xs text-[#444746] dark:text-[#C4C7C5]">
              Description
              <textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                rows={3}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue resize-none"
              />
            </label>

            <div className="flex items-center justify-between pt-1">
              {form.id ? (
                <button
                  type="button"
                  onClick={() => {
                    const existing = events.find((e) => e.id === form.id);
                    setForm(null);
                    if (existing) remove(existing);
                  }}
                  className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline"
                >
                  Delete
                </button>
              ) : (
                <span />
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setForm(null)}
                  className="h-9 px-4 rounded-full border border-[#E0E2E7] dark:border-[#333538] text-xs font-medium text-[#444746] dark:text-[#C4C7C5]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="h-9 px-4 rounded-full bg-gmail-blue text-white text-xs font-semibold disabled:opacity-60"
                >
                  {busy ? 'Saving…' : form.id ? 'Save' : 'Create'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
