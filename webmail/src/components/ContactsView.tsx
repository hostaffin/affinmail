import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BookUser, Mail, Phone, Plus, RefreshCw, Search, Trash2, Building2, X, ArrowLeft } from 'lucide-react';
import {
  Contact,
  createContact,
  deleteContact,
  queryContacts,
  updateContact,
} from '../lib/collab';

interface ContactsViewProps {
  onNotify: (message: string, type?: 'error' | 'success' | 'info') => void;
}

type Draft = Omit<Contact, 'id' | 'addressBookId'> & { id?: string };

const EMPTY_DRAFT: Draft = {
  fullName: '',
  givenName: '',
  surname: '',
  emails: [],
  phones: [],
  organization: '',
  title: '',
  notes: '',
};

export const ContactsView: React.FC<ContactsViewProps> = ({ onNotify }) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (term?: string) => {
      setLoading(true);
      try {
        setContacts(await queryContacts(term));
      } catch (err) {
        onNotify(err instanceof Error ? err.message : 'Could not load contacts', 'error');
      } finally {
        setLoading(false);
      }
    },
    [onNotify]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const timer = setTimeout(() => load(search.trim() || undefined), 250);
    return () => clearTimeout(timer);
  }, [search, load]);

  const selected = useMemo(
    () => contacts.find((c) => c.id === selectedId) ?? null,
    [contacts, selectedId]
  );

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft) return;
    if (!draft.fullName.trim() && draft.emails.length === 0) {
      onNotify('Add a name or an email address', 'error');
      return;
    }
    try {
      if (draft.id) {
        const existing = contacts.find((c) => c.id === draft.id);
        await updateContact({ ...(existing as Contact), ...draft, id: draft.id });
        onNotify('Contact updated', 'success');
      } else {
        await createContact(draft);
        onNotify('Contact created', 'success');
      }
      setDraft(null);
      await load(search.trim() || undefined);
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not save contact', 'error');
    }
  };

  const remove = async (contact: Contact) => {
    if (!window.confirm(`Delete ${contact.fullName}?`)) return;
    try {
      await deleteContact(contact.id);
      setSelectedId(null);
      setContacts((prev) => prev.filter((c) => c.id !== contact.id));
      onNotify('Contact deleted', 'info');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Could not delete contact', 'error');
    }
  };

  const setList = (field: 'emails' | 'phones', raw: string) => {
    if (!draft) return;
    setDraft({ ...draft, [field]: raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean) });
  };

  return (
    <div className="flex-1 flex min-h-0 bg-white dark:bg-[#1E1F20]">
      {/* List */}
      <div
        className={`${
          draft || selected ? 'hidden md:flex' : 'flex'
        } w-full md:w-80 shrink-0 border-r border-[#F2F4F7] dark:border-[#333538] flex-col min-h-0`}
      >
        <div className="px-3 py-3 border-b border-[#F2F4F7] dark:border-[#333538] space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <BookUser className="w-5 h-5 stroke-[1.5] shrink-0 text-[#444746] dark:text-[#C4C7C5]" />
              <h2 className="text-base font-medium text-[#1F1F1F] dark:text-[#E3E3E3] truncate">Contacts</h2>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => load(search.trim() || undefined)}
                className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center rounded-md text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                title="Reload"
              >
                <RefreshCw className={`w-4 h-4 stroke-[1.5] ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setDraft({ ...EMPTY_DRAFT })}
                className="flex items-center gap-1.5 h-10 md:h-8 px-3 rounded-lg bg-gmail-blue hover:bg-gmail-blue-hover text-white text-xs font-medium transition-colors whitespace-nowrap"
              >
                <Plus className="w-4 h-4 stroke-[1.5]" />
                New contact
              </button>
            </div>
          </div>
          <div className="flex items-center h-9 px-2.5 rounded-lg bg-[#F2F6FC] dark:bg-[#282A2C]">
            <Search className="w-4 h-4 stroke-[1.5] text-[#5E5E5E] dark:text-[#8E918F] shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts"
              className="w-full ml-2 bg-transparent border-none outline-none text-xs text-[#1F1F1F] dark:text-[#E3E3E3]"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {contacts.length === 0 && !loading && (
            <p className="p-4 text-xs text-[#5E5E5E] dark:text-[#8E918F]">No contacts found.</p>
          )}
          {contacts.map((contact) => (
            <button
              key={contact.id}
              onClick={() => {
                setSelectedId(contact.id);
                setDraft(null);
              }}
              className={`w-full text-left px-3 py-3 min-h-12 border-b border-[#F2F4F7] dark:border-[#333538] transition-colors ${
                selectedId === contact.id
                  ? 'bg-[#D3E3FD] dark:bg-[#004A77]'
                  : 'hover:bg-[#F2F6FC] dark:hover:bg-[#282A2C]'
              }`}
            >
              <div className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3] truncate">{contact.fullName}</div>
              <div className="text-xs text-[#5E5E5E] dark:text-[#8E918F] truncate">
                {contact.emails[0] || contact.organization || 'No email'}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Detail / form */}
      <div className={`${draft || selected ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-h-0 min-w-0 overflow-y-auto`}>
        {draft ? (
          <form onSubmit={save} className="p-4 sm:p-5 space-y-3 max-w-xl w-full">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-[#1F1F1F] dark:text-[#E3E3E3]">
                {draft.id ? 'Edit contact' : 'New contact'}
              </h3>
              <button type="button" onClick={() => setDraft(null)} className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center rounded-md hover:bg-black/5 dark:hover:bg-white/10" aria-label="Close">
                <X className="w-4 h-4 stroke-[1.5] text-[#444746] dark:text-[#C4C7C5]" />
              </button>
            </div>
            {(
              [
                ['fullName', 'Full name'],
                ['givenName', 'First name'],
                ['surname', 'Last name'],
                ['organization', 'Organization'],
                ['title', 'Job title'],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className="block text-xs text-[#444746] dark:text-[#C4C7C5]">
                {label}
                <input
                  value={(draft[field] as string | undefined) ?? ''}
                  onChange={(e) => setDraft({ ...draft, [field]: e.target.value })}
                  className="mt-1 w-full h-9 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue"
                />
              </label>
            ))}
            <label className="block text-xs text-[#444746] dark:text-[#C4C7C5]">
              Emails (comma separated)
              <input
                value={draft.emails.join(', ')}
                onChange={(e) => setList('emails', e.target.value)}
                className="mt-1 w-full h-9 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue"
              />
            </label>
            <label className="block text-xs text-[#444746] dark:text-[#C4C7C5]">
              Phones (comma separated)
              <input
                value={draft.phones.join(', ')}
                onChange={(e) => setList('phones', e.target.value)}
                className="mt-1 w-full h-9 px-3 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue"
              />
            </label>
            <label className="block text-xs text-[#444746] dark:text-[#C4C7C5]">
              Notes
              <textarea
                value={draft.notes ?? ''}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                rows={4}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-[#E0E2E7] dark:border-[#333538] bg-transparent text-sm text-[#1F1F1F] dark:text-[#E3E3E3] outline-none focus:border-gmail-blue resize-none"
              />
            </label>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="h-9 px-4 rounded-lg border border-[#E0E2E7] dark:border-[#333538] text-xs font-medium text-[#444746] dark:text-[#C4C7C5]"
              >
                Cancel
              </button>
              <button type="submit" className="h-9 px-4 rounded-lg bg-gmail-blue hover:bg-gmail-blue-hover transition-colors text-white text-xs font-medium">
                {draft.id ? 'Save' : 'Create'}
              </button>
            </div>
          </form>
        ) : selected ? (
          <div className="p-4 sm:p-5 space-y-4 max-w-xl w-full">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <button
                  onClick={() => setSelectedId(null)}
                  className="md:hidden h-10 w-10 min-h-10 flex items-center justify-center rounded-full shrink-0 text-[#444746] dark:text-[#C4C7C5] hover:bg-black/5 dark:hover:bg-white/10"
                  title="Back to contacts"
                  aria-label="Back to contacts"
                >
                  <ArrowLeft className="w-5 h-5 stroke-[1.5]" />
                </button>
                <div className="w-12 h-12 rounded-full bg-[#0B57D0] dark:bg-[#A8C7FA] text-white dark:text-[#042B5C] text-lg font-medium flex items-center justify-center shrink-0">
                  {selected.fullName.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <h3 className="text-base font-medium text-[#1F1F1F] dark:text-[#E3E3E3] truncate">{selected.fullName}</h3>
                  {(selected.organization || selected.title) && (
                    <div className="flex items-center gap-1 text-xs text-[#5E5E5E] dark:text-[#8E918F]">
                      <Building2 className="w-3.5 h-3.5 stroke-[1.5]" />
                      <span className="truncate">
                        {[selected.title, selected.organization].filter(Boolean).join(' · ')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setDraft({ ...selected })}
                  className="h-10 md:h-8 px-3 rounded-lg border hover:bg-black/5 dark:hover:bg-white/5 transition-colors border-[#E0E2E7] dark:border-[#333538] text-xs font-medium text-[#444746] dark:text-[#C4C7C5]"
                >
                  Edit
                </button>
                <button
                  onClick={() => remove(selected)}
                  className="h-10 w-10 min-h-10 md:h-8 md:w-8 md:min-h-8 flex items-center justify-center rounded-md text-[#444746] dark:text-[#C4C7C5] hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                  title="Delete contact"
                >
                  <Trash2 className="w-4 h-4 stroke-[1.5]" />
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-[#E0E2E7] dark:border-[#333538] divide-y divide-[#F2F4F7] dark:divide-[#333538]">
              {selected.emails.map((email) => (
                <div key={email} className="flex items-center gap-2 px-3 py-2 min-h-12 text-xs text-[#1F1F1F] dark:text-[#E3E3E3] min-w-0">
                  <Mail className="w-3.5 h-3.5 stroke-[1.5] shrink-0 text-[#5E5E5E] dark:text-[#8E918F]" />
                  <a href={`mailto:${email}`} className="hover:underline truncate">{email}</a>
                </div>
              ))}
              {selected.phones.map((phone) => (
                <div key={phone} className="flex items-center gap-2 px-3 py-2 min-h-12 text-xs text-[#1F1F1F] dark:text-[#E3E3E3] min-w-0">
                  <Phone className="w-3.5 h-3.5 stroke-[1.5] shrink-0 text-[#5E5E5E] dark:text-[#8E918F]" />
                  <span className="truncate">{phone}</span>
                </div>
              ))}
              {selected.notes && (
                <div className="px-3 py-2 text-xs text-[#444746] dark:text-[#C4C7C5] whitespace-pre-wrap">
                  {selected.notes}
                </div>
              )}
              {selected.emails.length === 0 && selected.phones.length === 0 && !selected.notes && (
                <div className="px-3 py-2 text-xs text-[#5E5E5E] dark:text-[#8E918F]">No details saved.</div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-6">
            <p className="text-sm text-[#5E5E5E] dark:text-[#8E918F]">Select a contact to see details.</p>
          </div>
        )}
      </div>
    </div>
  );
};
