{* AffinMail Hostaffin Client Area Interactive Template *}
<div class="affinmail-client-panel" style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin-bottom: 25px;">
  
  {* Top Action Banner *}
  <div style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); color: #ffffff; padding: 24px; border-radius: 12px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
    <div>
      <h2 style="margin: 0 0 6px 0; font-size: 22px; font-weight: 700; color: #ffffff;">AffinMail Business Workspace</h2>
      <p style="margin: 0; font-size: 14px; color: #94a3b8;">
        Domain: <strong style="color: #38bdf8;">{$domain}</strong> &nbsp;|&nbsp; 
        Storage Quota: <strong>{$diskQuotaMb} MB</strong> &nbsp;|&nbsp; 
        Max Attachment: <strong>{$maxAttachmentMb} MB</strong>
      </p>
    </div>
    <div>
      <a href="{$ssoUrl}" target="_blank" style="display: inline-flex; align-items: center; gap: 8px; background: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 8px; font-weight: 600; text-decoration: none; font-size: 14px; box-shadow: 0 2px 4px rgba(37,99,235,0.3);">
        <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
        </svg>
        Launch Webmail (1-Click SSO)
      </a>
    </div>
  </div>

  {* IP & Deliverability Badge *}
  {if $isDedicatedIp}
  <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 14px 18px; border-radius: 8px; margin-bottom: 20px; display: flex; align-items: center; gap: 12px;">
    <span style="background: #16a34a; color: white; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;">DEDICATED IP</span>
    <span style="font-size: 13px; color: #166534;">
      Your domain is assigned dedicated outbound IPv4: <strong>{$assignedIp}</strong> (rDNS: <code>{$rdnsHostname}</code>). Warm-up active.
    </span>
  </div>
  {else}
  <div style="background: #f8fafc; border: 1px solid #e2e8f0; padding: 14px 18px; border-radius: 8px; margin-bottom: 20px; display: flex; align-items: center; gap: 12px;">
    <span style="background: #475569; color: white; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 700;">SHARED POOL</span>
    <span style="font-size: 13px; color: #334155;">
      Outbound emails are dispatched via AffinMail's high-reputation shared cluster pool.
    </span>
  </div>
  {/if}

  {* DNS Table Card *}
  <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
    <h3 style="margin: 0 0 8px 0; font-size: 17px; font-weight: 600; color: #0f172a;">Required DNS Records for 100% Deliverability</h3>
    <p style="margin: 0 0 16px 0; font-size: 13px; color: #64748b;">
      Copy and publish these records at your DNS host (Cloudflare, Namecheap, cPanel, etc.) to pass SPF, DKIM, and DMARC verification:
    </p>

    <div style="overflow-x: auto;">
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
        <thead>
          <tr style="border-bottom: 2px solid #e2e8f0; background: #f8fafc; color: #475569;">
            <th style="padding: 10px 12px;">Record Type</th>
            <th style="padding: 10px 12px;">Host / Name</th>
            <th style="padding: 10px 12px;">Value / Content</th>
            <th style="padding: 10px 12px;">Priority</th>
            <th style="padding: 10px 12px; text-align: right;">Action</th>
          </tr>
        </thead>
        <tbody>
          {foreach from=$dnsRecords item=record}
          <tr style="border-bottom: 1px solid #f1f5f9;">
            <td style="padding: 12px;">
              <span style="background: #e0f2fe; color: #0369a1; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 11px;">
                {$record.type}
              </span>
            </td>
            <td style="padding: 12px; font-family: monospace; color: #0f172a;">{$record.name}</td>
            <td style="padding: 12px; font-family: monospace; color: #334155; word-break: break-all; max-width: 380px;">
              {$record.value}
            </td>
            <td style="padding: 12px; color: #64748b;">{$record.priority|default:'-'}</td>
            <td style="padding: 12px; text-align: right;">
              <button onclick="navigator.clipboard.writeText('{$record.value}'); alert('Record copied to clipboard!');" 
                      style="background: #f1f5f9; border: 1px solid #cbd5e1; padding: 4px 10px; border-radius: 6px; font-size: 12px; cursor: pointer; color: #334155;">
                Copy
              </button>
            </td>
          </tr>
          {/foreach}
        </tbody>
      </table>
    </div>
  </div>

</div>
